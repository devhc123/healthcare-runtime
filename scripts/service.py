# -*- coding: utf-8 -*-
"""
康养智能体 runtime — Python 领域服务 (Guideline retrieval + Risk Calculator)

用一个零依赖的 stdlib HTTP 服务器暴露:
  GET  /health
  GET  /calculators            -> 计算器注册表
  POST /calculate             -> 确定性风险评分  {"calc_id","inputs":{...}}
  POST /search               -> Guideline 检索      {"query","k"}

Node 端 agent 通过这些 endpoint 作为工具调用本服务。

用法:
  uv run python scripts/service.py --rag data/rag --host 127.0.0.1 --port 8787
"""
import argparse, json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import search_rag
import calcs


class Handler(BaseHTTPRequestHandler):
    rag_dir = "data/rag"
    model = "BAAI/bge-small-zh-v1.5"

    def log_message(self, fmt, *args):
        sys.stderr.write("[svc] %s\n" % (fmt % args))

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "service": "healthcare-runtime-domain",
                                   "rag": self.rag_dir})
        if self.path == "/calculators":
            return self._send(200, {"calculators": calcs.list_calculators()})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            return self._send(400, {"error": "bad request: %s" % e})

        if self.path == "/search":
            query = data.get("query") or ""
            k = int(data.get("k") or 5)
            try:
                results = search_rag.search(self.rag_dir, query, k, self.model)
                return self._send(200, {"results": results})
            except Exception as e:
                return self._send(500, {"error": str(e)})

        if self.path == "/calculate":
            calc_id = data.get("calc_id")
            inputs = data.get("inputs") or {}
            try:
                result = calcs.calculate(calc_id, inputs)
                return self._send(200, {"calc_id": calc_id, "result": result})
            except KeyError as e:
                return self._send(404, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})

        return self._send(404, {"error": "not found"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rag", default="data/rag")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    Handler.rag_dir = args.rag
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[svc] healthcare-runtime domain service on http://{args.host}:{args.port}  rag={args.rag}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[svc] bye")


if __name__ == "__main__":
    main()
