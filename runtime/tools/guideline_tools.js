// @ts-nocheck
/**
 * 康养智能体 runtime — Guideline retrieval 工具
 *
 * 把 Python 领域服务的 RAG 检索包装成 agent 工具。安全策略:
 *  - 只读, 无写权限
 *  - 返回的 content 附带来源(source/title/section)以便审计与溯源
 */
import { Type } from "typebox";
import { domainClient } from "../core/domain.js";

export function makeSearchGuidelineTool(client = domainClient) {
  return {
    name: "search_guideline",
    label: "检索临床指南",
    description:
      "检索内置的医学指南知识库(西氏内科学精要、UpToDate 主题),按相关性返回若干条带来源的片段。当需要查证诊断、治疗或风险分层的循证依据时使用。只读工具。",
    parameters: Type.Object({
      query: Type.String({ description: "检索查询,建议用医学关键词,如 '肺栓塞 诊断'" }),
      k: Type.Integer({ description: "返回条数", default: 5, minimum: 1, maximum: 10 }),
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (signal) signal.throwIfAborted?.();
      const data = await client.search(params.query, params.k || 5);
      const results = data.results || [];
      if (!results.length) {
        return {
          content: [{ type: "text", text: "未在指南知识库中找到相关条目。" }],
          details: { hits: 0, query: params.query },
        };
      }
      const text = results
        .map((r, i) =>
          `【${i + 1}】[score=${r.score.toFixed(3)}] ${r.source || ""} | ${r.title}` +
          (r.section ? ` | ${r.section}` : "") +
          `\n${r.text.slice(0, 1200)}`
        )
        .join("\n\n---\n\n");
      return {
        content: [{ type: "text", text }],
        details: { hits: results.length, query: params.query, sources: results.map((r) => r.title) },
      };
    },
  };
}
