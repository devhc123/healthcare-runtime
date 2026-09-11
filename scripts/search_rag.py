# -*- coding: utf-8 -*-
"""
康养智能体 runtime — Guideline Retrieval 检索器 (FAISS)

既可作为库调用(runtime 通过它检索), 也可作为 CLI:
  uv run python scripts/search_rag.py "胸痛的鉴别诊断" -k 5
"""
import argparse, json, os
import numpy as np
import faiss


def load(out_dir):
    index = faiss.read_index(os.path.join(out_dir, "index.faiss"))
    with open(os.path.join(out_dir, "docs.json"), "r", encoding="utf-8") as f:
        docs = json.load(f)
    meta = json.load(open(os.path.join(out_dir, "meta.json"), "r", encoding="utf-8"))
    return index, docs, meta


_MODEL_CACHE = {}


def _get_model(name):
    if name not in _MODEL_CACHE:
        from sentence_transformers import SentenceTransformer
        _MODEL_CACHE[name] = SentenceTransformer(name)
    return _MODEL_CACHE[name]


def search(out_dir, query, k=5, model_name="BAAI/bge-small-zh-v1.5", meta=None):
    index, docs, meta = load(out_dir)
    model = _get_model(model_name)
    qe = model.encode([query], normalize_embeddings=True)
    qe = np.asarray(qe, dtype="float32")
    dists, idxs = index.search(qe, k)
    results = []
    for d, i in zip(dists[0], idxs[0]):
        if i < 0 or i >= len(docs):
            continue
        doc = docs[i]
        results.append({
            "score": float(d),
            "id": doc["id"],
            "source": doc.get("source", ""),
            "title": doc["title"],
            "section": doc.get("section", ""),
            "text": doc["text"],
        })
    return results


def main():
    ap = argparse.ArgumentParser(prog="search_rag.py")
    ap.add_argument("query", nargs="+", help="搜索查询")
    ap.add_argument("--index", default="data/rag", help="RAG index 目录")
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("--model", default="BAAI/bge-small-zh-v1.5")
    ap.add_argument("--jsonlines", action="store_true")
    args = ap.parse_args()

    q = " ".join(args.query)
    results = search(args.index, q, args.k, args.model)
    if args.jsonlines:
        for r in results:
            print(json.dumps(r, ensure_ascii=False))
    else:
        for r in results:
            print(f"\n[score {r['score']:.3f}] {r['source']} | {r['title']}"
                  + (f" | {r['section']}" if r["section"] else ""))
            print(r["text"][:400].replace("\n", " "))
    print(f"\n# top {len(results)} hits for: {q}")


if __name__ == "__main__":
    main()
