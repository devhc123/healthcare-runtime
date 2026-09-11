// @ts-nocheck
/**
 * 康养智能体 runtime — 一键初始化脚本
 *
 * 目标:官方流程 = `npm install` 后跑一次 `node scripts/bootstrap.js` 即可用。
 * 做三件事(幂等):
 *   1. 若没有 .env,从 .env.example 复制;
 *   2. 确保专科医生注册表存在;
 *   3. 检查指南检索索引 / Python 依赖,给出或缺省地补齐。
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sys(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return "";
  }
}

function step(t, ok) {
  console.log(`[bootstrap] ${t} ${ok ? "OK" : "..."}`);
}

async function main() {
  console.log("== 康养智能体 runtime 一键安装 ==");

  // 1) .env
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile)) {
    copyFileSync(path.join(ROOT, ".env.example"), envFile);
    step("已生成 .env(默认配置即可运行)", true);
  } else {
    step("检测到已有 .env,跳过", true);
  }

  // 2) doctors registry
  const doctorsFile = path.join(ROOT, "runtime", "agents", "doctors.json");
  if (!existsSync(doctorsFile)) {
    mkdirSync(path.dirname(doctorsFile), { recursive: true });
    writeFileSync(doctorsFile, JSON.stringify([], null, 2));
    step("专科注册表已初始化", true);
  } else {
    step("检测到已有 doctors.json,跳过", true);
  }

  // 3) Node 依赖
  if (existsSync(path.join(ROOT, "node_modules", "@earendil-works", "pi-agent-core"))) {
    step("Node 依赖(node_modules)已就绪", true);
  } else {
    step("正在安装 Node 依赖 ...");
    console.log(sys("npm", ["install"]).split("\n").slice(-3).join("\n"));
  }

  // 4) Python 依赖(可选但推荐,用于 RAG + 评分)
  const pyOk = sys("python3", ["-c", "import faiss, numpy, sentence_transformers"]).includes("Error") ? false : true;
  step(`Python 领域依赖(faiss/sentence-transformers) ${pyOk ? "已安装" : "缺失(可选:uv pip install faiss-cpu sentence-transformers)"}`, pyOk);

  // 5) RAG 索引
  const ragIndex = path.join(ROOT, "data", "rag");
  const hasIndex = ["index.faiss", "docs.json", "meta.json"].every((f) =>
    existsSync(path.join(ragIndex, f))
  );
  if (hasIndex) {
    step("指南检索索引已存在", true);
  } else {
    console.log("[bootstrap] AI 指南检索索引不存在。");
    console.log("[bootstrap] 构建(需 GPU/pip, 也可稍后手动):  npm run build:rag");
    console.log("[bootstrap] 同时建议启动领域服务:            python scripts/service.py --rag data/rag");
  }

  console.log("\n完成!接下来:");
  console.log("  交互问诊 :  npm run chat    (或 node cli/main.js chat)");
  console.log("  HTTP服务 :  npm start       (或 node cli/main.js serve)");
  console.log(" 查看专科 :  node cli/main.js doctors");
}

main();
