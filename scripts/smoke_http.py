# -*- coding: utf-8 -*-
"""一次性验证 Node HTTP/SSE 康养服务:
spawn 领域服务 + node cli serve -> 测试 /health /api/doctors /api/chat(SSE) -> kill -> exit
单前台进程,避免 shell 后台交互。"""
import json, subprocess, sys, time, urllib.request, os

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
VENV = "/workspace/run-venv.sh"


def run(cmd, logf):
    return subprocess.Popen(
        ["bash", "-c", f"source {VENV} 2>/dev/null; cd {ROOT}; {cmd}"],
        stdout=open(logf, "w"), stderr=subprocess.STDOUT)


def http_get(url, timeout=20):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read().decode()


def http_post_sse(url, body, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()


def main():
    procs = []
    try:
        # 1) 领域服务(端口 8787) + 2) Node 服务(默认 4000)
        procs.append(run("python3 scripts/service.py --rag data/rag --port 8787", "data/svc.smoke.log"))
        time.sleep(5)
        procs.append(run("node cli/main.js serve", "data/node.smoke.log"))
        time.sleep(4)

        print("NODE /health:", http_get("http://127.0.0.1:4000/health").strip()[:80])
        docs = json.loads(http_get("http://127.0.0.1:4000/api/doctors"))
        print("NODE /api/doctors:", [d["id"] for d in docs["doctors"]])

        print("--- POST /api/chat (SSE, GP) ---")
        body = http_post_sse("http://127.0.0.1:4000/api/chat",
                            {"message": "你好,请用一句话介绍你是什么医生"}, timeout=180)
        print("  chat raw:", body[:800])

        print("--- POST /api/consult (SSE, specialist sub-agent) ---")
        body2 = http_post_sse("http://127.0.0.1:4000/api/consult",
                             {"specialty": "心血管内科",
                              "question": "65岁房颤患者,高血压+心衰,请评估卒中风险"}, timeout=200)
        ev2 = [ln.split("data: ",1)[1] for ln in body2.splitlines() if ln.startswith("data: ")]
        print("  consult events:", [j[:40] for j in ev2][:3], "... last:", ev2[-1][:120] if ev2 else None)

        print("--- POST /api/chat (tool-drive: ask GP to use HEART calc) ---")
        body3 = http_post_sse("http://127.0.0.1:4000/api/chat",
                             {"message": "请使用 HEART 评分工具评估: 病史中危2分,心电图非特异1分,年龄68岁2分,危险因素1个1分,肌钙蛋白正常0分"}, timeout=200)
        ev3 = [ln.split("data: ",1)[1] for ln in body3.splitlines() if ln.startswith("data: ")]
        tool_ev = [j for j in ev3 if '"name"' in j]
        print("  tool events:", tool_ev[:3])
        print("  done:", ev3[-1][:200] if ev3 else None)

        print("HTTP_E2E_OK")
        return 0
    except Exception as e:
        print("HTTP_E2E_FAIL:", repr(e))
        return 1
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(timeout=5)
            except Exception:
                p.kill()


if __name__ == "__main__":
    sys.exit(main())
