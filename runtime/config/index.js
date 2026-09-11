// @ts-nocheck
/**
 * 康养智能体 runtime — 配置加载
 *
 * 优先级:环境变量 > .env 文件 > 默认值。
 * 让 "官方安装后改配置即可用" 成为可能:
 *   1. cp .env.example .env
 *   2. 按需改 LLM endpoint / 端口 / RAG 路径
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 简单 .env 解析(不引入 dotenv 依赖,减少安装成本) */
export function loadEnvFile(file = path.join(ROOT, ".env")) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf-8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      val.startsWith('"') && val.endsWith('"') ||
      val.startsWith("'") && val.endsWith("'")
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

export const config = {
  root: ROOT,

  // LLM provider(默认连本地 OpenAI 兼容推理端点,vLLM/minimax)
  llm: {
    provider: str("HEALTHCARE_LLM_PROVIDER", "local"),
    baseUrl: str("HEALTHCARE_LLM_BASE_URL", "http://deepseek-v4-flash:8000/v1"),
    apiKey: str("HEALTHCARE_LLM_API_KEY", "none"),
    model: str("HEALTHCARE_LLM_MODEL", "minimax"),
    maxTokens: num("HEALTHCARE_LLM_MAX_TOKENS", 2048),
    thinking: str("HEALTHCARE_LLM_THINKING", "off"),
  },

  // 领域服务(guideline retrieval + calculator)
  domain: {
    baseUrl: str("HEALTHCARE_DOMAIN_URL", "http://127.0.0.1:8787"),
    ragDir: str("HEALTHCARE_RAG_DIR", path.join(ROOT, "data", "rag")),
  },

  // HTTP/SSE 服务
  server: {
    host: str("HEALTHCARE_SERVER_HOST", "127.0.0.1"),
    port: num("HEALTHCARE_SERVER_PORT", 4000),
  },

  // 专科医生自动生成
  specialists: {
    genModel: str("HEALTHCARE_SPECIALIST_MODEL", str("HEALTHCARE_LLM_MODEL", "minimax")),
    autoGenerate: str("HEALTHCARE_SPECIALIST_AUTOGEN", "false") === "true",
  },
};

export { ROOT };
