// @ts-nocheck
/**
 * 康养智能体 runtime — 专科医生自动生成(auto-generate)
 *
 * 给定一个专科领域,用 LLM 生成该专科医生的 systemPrompt / 描述 / 适用工具/ 常见主诉,
 * 并写入注册表。这样“可自主生成的专科医生”无需手写,一句话即可长出。
 */
import { Type } from "typebox";
import { getSharedModels, transcriptToText } from "./doctor.js";
import { specialSlug } from "./doctor.js";
import { upsertDoctor } from "./registry.js";

const SYSTEM = `你是一名医院人事/专科规划助手。用户会给你一个专科名称,以及可选的患者需求。
请为该专科生成一位专科医生的注册信息,严格输出一个 JSON(不要 markdown):
{
  "id": "英文短id(如 cardiologist)",
  "role": "专科医生",
  "specialty": "专科名称",
  "description": "一句话说明该专科覆盖的疾病/症状范围",
  "roleDescription": "给该专科医生 agent 的 system prompt 片段(第一人称,说明职责、重点病种、常用风险评分工具),80-150字",
  "tools": ["search_guideline","calculate_risk"],
  "commonPresentations": ["常见主诉示例1","示例2","示例3"]
}
只返回上述 JSON。`;

export async function autoGenerateSpecialist(input) {
  const { models, model } = getSharedModels();
  const msgs = [
    { role: "user", content: `专科名称: ${input}`, timestamp: Date.now() },
  ];
  const stream = await models.streamSimple(model, {
    systemPrompt: SYSTEM,
    messages: msgs,
  });
  let out = "";
  for await (const ev of stream) {
    if (ev.type === "assistant_message_event" && ev.assistantMessageEvent.type === "text_delta") {
      out += ev.assistantMessageEvent.delta;
    }
  }
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  const spec = JSON.parse(json);
  spec.id = specialSlug(spec.id || spec.specialty);
  spec.roleDescription = spec.roleDescription || spec.description || "";
  spec.tools = Array.isArray(spec.tools) && spec.tools.length ? spec.tools : ["search_guideline", "calculate_risk"];
  upsertDoctor(spec);
  return spec;
}
