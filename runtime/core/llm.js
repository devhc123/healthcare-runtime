// @ts-nocheck
/**
 * 康养智能体 runtime — LLM provider 装配
 *
 * 基于 @earendil-works/pi-ai,把可配置的 OpenAI 兼容端点(local vLLM / 云 API)
 * 注册为一个 Provider,并用 createModels() 包装成 Agent 需要的 models/streamFn。
 *
 * 见 ../config —— 通过环境变量即可在不改代码的情况下切换模型端点。
 */
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { config } from "../config/index.js";

export function buildProvider() {
  const baseUrl = config.llm.baseUrl;
  const modelId = config.llm.model;
  const apiKey = process.env.HEALTHCARE_LLM_API_KEY === "" ||
                 process.env.HEALTHCARE_LLM_API_KEY === "none" ||
                 process.env.HEALTHCARE_LLM_API_KEY === undefined
                 ? undefined : process.env.HEALTHCARE_LLM_API_KEY;

  const auth = {
    apiKey: {
      name: "LLM API key",
      login: async () => ({ type: "api_key", key: apiKey || "local" }),
      resolve: async ({ credential, signal }) => {
        signal?.throwIfAborted?.();
        const key = credential?.key || apiKey || "local";
        return { auth: { apiKey: key }, source: "config" };
      },
    },
  };

  const model = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "local",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: config.llm.maxTokens,
    compat: {
      debug: false,
      headers: undefined,
      provider: "openai-completions",
    },
  };

  const provider = createProvider({
    id: "local",
    name: "Local OpenAI-compatible (vLLM)",
    baseUrl,
    auth,
    models: [model],
    api: openAICompletionsApi(),
  });

  const models = createModels();
  (models).setProvider(provider);
  return { models, provider, model };
}

export function buildModels() {
  const { models, model } = buildProvider();
  const resolved = models.getModel("local", model.id) || model;
  return {
    models,
    model: resolved,
    streamFn: models.streamSimple.bind(models),
  };
}
