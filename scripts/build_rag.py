# -*- coding: utf-8 -*-
"""
康养智能体 runtime — Guideline Retrieval 索引构建器 (FAISS)

用法:
  uv run python scripts/build_rag.py --sources ../task2 ../task3 --out data/rag \
      --model BAAI/bge-small-zh-v1.5

步骤:
  1. 从 task2 的两个《西氏内科学精要》PDF 抽取正文、清洗、分块
  2. 从 task3 的 UpToDate.zip 解析 topics 并分块
  3. 用 sentence-transformer 编码 -> FAISS IndexFlatIP 索引
  4. 输出 data/rag/{index.faiss,docs.json,meta.json}
"""
import argparse, json, os, re, html, zipfile, glob, statistics
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

SKIP_CLASSES = {
    "disclosureLink", "policy", "contributor_credentials",
    "licenseLink", "headingEndMark", "graphic", "nowrap",
}
from html.parser import HTMLParser


class TopicParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.cur_para = []
        self.skip_depth = 0
        self.in_heading = False
        self.heading_level = None

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        cls = attr.get("class", "")
        if any(c in SKIP_CLASSES for c in cls.split()):
            if tag in ("a", "span", "div"):
                self.skip_depth += 1
        if tag in ("script", "style"):
            self.skip_depth += 1
        if "headingAnchor" in cls:
            self.in_heading = True
        for c in ("h1", "h2", "h3", "h4", "h5", "h6"):
            if c in cls.split():
                self.in_heading = True
                self.heading_level = c
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.in_heading = True
            self.heading_level = tag

    def handle_endtag(self, tag):
        if self.in_heading and tag == "p":
            if self.heading_level is None:
                self.heading_level = "h1"
        if self.in_heading and tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.in_heading = False
        if self.skip_depth > 0 and tag in ("a", "span", "div", "script", "style"):
            self.skip_depth = max(0, self.skip_depth - 1)

    def handle_data(self, data):
        if self.skip_depth > 0:
            return
        s = data.strip()
        if not s:
            return
        if self.in_heading:
            self.cur_para.append(("h", self.heading_level or "h1", s))
            self.in_heading = False
            self.heading_level = None
        else:
            self.cur_para.append(("t", None, s))


def clean_citations(text):
    text = re.sub(r"\s*\[\d+(?:[-–,]\d+)*\]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_up_to_date_article(obj):
    body = obj.get("body", "")
    p = TopicParser()
    p.feed(body)
    lines = []
    cur = []
    for kind, level, s in p.cur_para:
        if kind == "t":
            cur.append(s)
        else:
            if cur:
                lines.append(("p", " ".join(cur)))
                cur = []
            lines.append(("h", level, s))
    if cur:
        lines.append(("p", " ".join(cur)))
    out = []
    for line in lines:
        if len(line) == 2:
            kind, text = line
        else:
            kind, level, text = line
        text = clean_citations(text)
        if not text:
            continue
        out.append(text if kind == "p" else "H:" + str(kind).upper() + " " + text)
    return out


def extract_task2_pdfs(sources):
    """从 task2 的《西氏内科学精要》上下卷抽取分块记录。"""
    import pymupdf
    recs = []
    pdfs = []
    for src in sources:
        pdf_dir = os.path.join(src, "*.pdf")
        for f in glob.glob(pdf_dir):
            b = os.path.basename(f)
            if "西氏" in b or "内科学" in b:
                pdfs.append(f)
    pdfs = sorted(set(pdfs))
    for p in sorted(pdfs):
        doc = pymupdf.open(p)
        name = os.path.basename(p)
        pages = []
        for i in range(doc.page_count):
            t = doc.load_page(i).get_text("text")
            t = re.sub(r"\n?Downloaded by \[.*?permission\.\n?", "\n", t, flags=re.DOTALL)
            pages.append(t)
        text = "\n".join(pages)
        # 分块
        lines = text.split("\n")
        chunks = []
        cur = []
        cur_len = 0
        chapter = ""
        for ln in lines:
            s = ln.strip()
            if re.fullmatch(r"\d{1,4}", s):
                continue
            if re.search(r"第\s*\d+\s*章", s):
                chapter = s
            if re.fullmatch(r"[A-Za-z0-9 \.\-–—:：()（）/%]+", s) and len(s) < 30:
                continue
            cur.append(s)
            cur_len += len(s)
            if cur_len >= 2200:
                chunks.append("\n".join(cur))
                cur = []
                cur_len = 0
        if cur and cur_len > 200:
            chunks.append("\n".join(cur))
        for ci, c in enumerate(chunks):
            if len(c.strip()) < 200:
                continue
            recs.append({
                "source": "西氏内科学精要",
                "doc": name,
                "id": f"{name}_{ci}",
                "title": name,
                "section": chapter,
                "text": c,
            })
        print(f"  task2 {name}: chunks={len(chunks)}", flush=True)
    return recs


def extract_task3_topics(sources):
    """从 task3 的 UpToDate.zip 解析 topics 并分块。"""
    recs = []
    zips = []
    for src in sources:
        z = os.path.join(src, "UpToDate.zip")
        if os.path.exists(z):
            zips.append(z)
    if not zips:
        return recs
    z = zipfile.ZipFile(zips[0])
    names = [n for n in z.namelist()
             if n.startswith("UpToDate/d/topics/") and n.endswith(".js")]
    done = 0
    for n in sorted(names):
        try:
            raw = z.read(n).decode("utf-8", "ignore")
            obj = json.loads(raw[raw.index("{"):])
        except Exception:
            continue
        title = obj.get("title", "")
        lines = parse_up_to_date_article(obj)
        if len(lines) < 3:
            continue
        text = "\n".join(lines)
        tid = os.path.basename(n).replace(".js", "")
        # 按 H: 分块
        blocks = []
        cur = []
        cur_len = 0
        heading = ""
        for ln in lines:
            if ln.startswith("H:"):
                if cur:
                    blocks.append((heading, cur))
                heading = ln[2:].strip()
                cur = []
                cur_len = 0
                continue
            cur.append(ln)
            cur_len += len(ln)
            if cur_len >= 2600:
                blocks.append((heading, cur))
                cur = []
                cur_len = 0
        if cur:
            blocks.append((heading, cur))
        for ci, (hd, body) in enumerate(blocks):
            txt = "\n".join(body)
            if len(txt) < 120:
                continue
            recs.append({
                "source": "UpToDate",
                "doc": title,
                "id": f"utd_{tid}_{ci}",
                "title": title,
                "section": hd or "",
                "text": txt,
            })
        done += 1
    recs = recs
    print(f"  task3 UpToDate: parsed topics={done} chunks={len(recs)}", flush=True)
    return recs


def resolve_sources(args_sources):
    """把 --sources 给出的相对路径解析到真实存在的目录。"""
    got = [s for s in (args_sources or []) if os.path.isdir(s)]
    if got:
        return got
    # 回退: 尝试常见相对位置(基于脚本所在目录向上找)
    base = os.path.dirname(os.path.abspath(__file__))
    for cand in [
        os.path.join(base, "..", "..", "task2"), os.path.join(base, "..", "..", "task3"),
        os.path.join(base, "..", "task2"), os.path.join(base, "..", "task3"),
    ]:
        # 需要 dir 存在, 并包含目标(带西氏 PDF 或 UpToDate.zip)
        if os.path.isdir(cand):
            yields_pdf = glob.glob(os.path.join(cand, "*.pdf"))
            yields_zip = os.path.exists(os.path.join(cand, "UpToDate.zip"))
            if yields_pdf or yields_zip:
                got.append(cand)
    return list(dict.fromkeys(got))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", nargs="+", default=None)
    ap.add_argument("--out", default="data/rag")
    ap.add_argument("--model", default="BAAI/bge-small-zh-v1.5")
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--max-docs", type=int, default=8000,
                   help="cap number of docs (default 8000, fits sandbox memory)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    sources = resolve_sources(args.sources)
    print("sources:", sources, flush=True)
    task2_recs = extract_task2_pdfs(sources)
    task3_recs = extract_task3_topics(sources)

    # 去重(按 title+text 前 50 字符)
    seen = set()
    docs = []
    for r in task2_recs + task3_recs:
        key = (r["title"], r["text"][:50])
        if key in seen:
            continue
        seen.add(key)
        docs.append(r)

    # 抽样封顶:等距抽样以保留覆盖度(demo 索引可装进沙箱内存)
    if len(docs) > args.max_docs:
        idxs = [int(round(i * (len(docs) - 1) / (args.max_docs - 1)))
                for i in range(args.max_docs)]
        docs = [docs[i] for i in idxs]

    meta = {"model": args.model, "dim": None, "n_docs": len(docs),
            "sources": {"task2": len(task2_recs), "task3": len(task3_recs)}}

    model = SentenceTransformer(args.model)
    texts = [d["text"] for d in docs]
    emb = model.encode(texts, normalize_embeddings=True,
                     show_progress_bar=True, batch_size=args.batch)
    emb = np.asarray(emb, dtype="float32")
    meta["dim"] = emb.shape[1]

    index = faiss.IndexFlatIP(emb.shape[1])
    index.add(emb)
    faiss.write_index(index, os.path.join(args.out, "index.faiss"))

    with open(os.path.join(args.out, "docs.json"), "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False)
    with open(os.path.join(args.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    chs = [len(d["text"]) for d in docs]
    print(f"RAG_DONE n_docs={meta['n_docs']} dim={meta['dim']} "
          f"median_chars={int(statistics.median(chs)) if chs else 0}")
    print("out ->", args.out)


if __name__ == "__main__":
    main()
