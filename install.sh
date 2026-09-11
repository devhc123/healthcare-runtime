#!/usr/bin/env bash
# 康养智能体 runtime — 一键安装脚本
# 用法: bash install.sh   (在 healthcare-runtime 目录下)
set -e
cd "$(dirname "$0")"

echo "== 康养智能体 runtime 安装 =="

# 1) Node 依赖
command -v node >/dev/null || { echo "[install] 需要 Node >= 22.19,请先安装"; exit 1; }
echo "[install] 安装 Node 依赖 (npm install)..."
npm install

# 2) Python 依赖(用于指南检索 + 风险评分;若已有可跳过)
if command -v python3 >/dev/null; then
  echo "[install] 检查 Python 领域依赖..."
  if ! python3 -c "import faiss, numpy, sentence_transformers" >/dev/null 2>&1; then
    echo "[install] 尝试安装 Python 依赖 (pip install faiss-cpu sentence-transformers numpy)..."
    # 优先用 uv(若可用)
    if command -v uv >/dev/null; then
      uv pip install faiss-cpu sentence-transformers numpy
    else
      python3 -m pip install --quiet faiss-cpu sentence-transformers numpy || true
    fi
  else
    echo "[install] Python 领域依赖已就绪"
  fi
fi

# 3) 引导(生成 .env / 注册表 / 检查索引)
node scripts/bootstrap.js

echo ""
echo "== 安装完成。下一步 =="
echo "  启动领域服务:  python scripts/service.py --rag data/rag   (另一个终端)"
echo "  交互问诊     :  npm run chat"
echo "  HTTP 服务    :  npm start"
