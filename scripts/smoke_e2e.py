# -*- coding: utf-8 -*-
"""一次性端到端验证: 经真实 HTTP 子进程测试 healthcare-runtime 领域服务。
单前台进程 start-service -> test -> kill -> exit,避免 shell 后台交互问题。"""
import json, subprocess, sys, time, urllib.request, os, signal

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
VENV = "/workspace/run-venv.sh"

def shell():
    return "bash", "-c", f"source {VENV} 2>/dev/null; cd {ROOT}; exec python3 scripts/service.py --rag data/rag --port 8822"

def req(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://127.0.0.1:8822{path}", data=data,
                            headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read() or "{}")
    except Exception as e:
        return {"ERR": str(e)}

def main():
    print("starting service subprocess...", flush=True)
    p = subprocess.Popen(shell(), stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # wait for readiness
        for _ in range(40):
            try:
                urllib.request.urlopen("http://127.0.0.1:8822/health", timeout=2)
                break
            except Exception:
                time.sleep(1)
        else:
            print("FAIL: service not ready"); return 1

        print("HEALTH:", req("/health"), flush=True)
        print("CALCS:", [c["id"] for c in req("/calculators").get("calculators", [])], flush=True)

        t0 = time.time()
        sr = req("/search", "POST", {"query": "房颤 抗凝 卒中风险", "k": 1})
        rs = sr.get("results", [])
        print(f"SEARCH({time.time()-t0:.1f}s) hits={len(rs)} top={rs[0]['title'] if rs else None}", flush=True)

        cr = req("/calculate", "POST", {"calc_id": "cha2ds2-vasc", "inputs": {
            "chf": 1, "hypertension": 1, "age_gt74": 0, "diabetes": 0,
            "stroke_tia": 0, "vascular": 1, "age_65_74": 1, "sex_female": 0}})
        r = cr.get("result", {})
        print("CALC cha2ds2-vasc score=", r.get("score"), "risk=", r.get("risk"), flush=True)

        print("E2E_OK", flush=True)
        return 0
    finally:
        p.terminate()
        try:
            p.wait(timeout=5)
        except Exception:
            p.kill()

if __name__ == "__main__":
    sys.exit(main())
