// @ts-nocheck
/**
 * 康养智能体 runtime — 医生智能体(基于 @earendil-works/pi-agent-core 的 Agent)
 *
 * 一个 Doctor 就是一个 pi-core Agent 实例,配上:
 *  - systemPrompt(角色/专科定位)
 *  - tools(工具范围;全科医生拥有全部工具,专科医生可裁剪)
 *
 * `consultSpecialist` 工具是“子智能体/子任务”能力:在全科医生内部以子任务方式
 * 实例化一个专科 Agent,把患者问题交给它并回收结论。
 */
import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { buildModels } from "../core/llm.js";
import { makeSearchGuidelineTool } from "../tools/guideline_tools.js";
import { makeCalculateRiskTool } from "../tools/calculator_tools.js";

let _shared = null;
export function getSharedModels() {
  if (!_shared) _shared = buildModels();
  return _shared;
}

/**
 * 把一个 doctor spec(role/specialty/systemPrompt/tools)实例化成可运行的 DoctorAgent。
 */
export function createDoctorAgent(spec, opts = {}) {
  const { models, model } = getSharedModels();
  const tools = (spec.tools || ["search_guideline", "calculate_risk"])
    .map((name) => buildTool(name))
    .filter(Boolean);

  const systemPrompt = spec.systemPrompt ||
    `你是一名${spec.specialty || spec.role || "医生"}(\n${spec.roleDescription || ""})。请依据内置指南检索与确定性风险评分工具,结合专业知识给出严谨、负责的回答。所有结论需说明证据来源;涉及风险分层时请使用工具,不要自行心算。`;

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: (opts.thinkingLevel || "off"),
      tools,
      messages: opts.initialMessages || [],
    },
    streamFn: models.streamSimple.bind(models),
    toolExecution: opts.toolExecution || "sequential",
    convertToLlm: (msgs) => msgs.map((m) => m), // 标准消息直通
  });

  return {
    spec,
    tools,
    agent,
    async run(userText, hooks = {}) {
      const unsub = hooks.subscribe
        ? agent.subscribe(hooks.subscribe)
        : null;
      await agent.prompt(userText);
      if (unsub) unsub();
      return transcriptToText(agent.state.messages);
    },
    async consultSpecialist(specB, userText) {
      return runSpecialist(specB, userText);
    },
  };
}

export function buildTool(name) {
  switch (name) {
    case "search_guideline": return makeSearchGuidelineTool();
    case "calculate_risk": return makeCalculateRiskTool();
    default: return null;
  }
}

/**
 * 子智能体/子任务:实例化一个专科 Agent 并运行单个用户请求,返回其最终回答。
 */
export async function runSpecialist(spec, userText, opts = {}) {
  const doctor = createDoctorAgent(spec, opts);
  return {
    doctorId: spec.id || spec.specialty,
    ...(await doctor.run(userText, opts)),
  };
}

/** 生成一个“转诊/会诊”工具:全科医生可把问题交给指定专科医生。 */
export function makeConsultTool(getSpec) {
  return {
    name: "consult_specialist",
    label: "专科会诊",
    description:
      "把患者问题提交给一个专科医生(子智能体)进行会诊,返回该专科的结论与建议。当患者问题超出全科范围、或需要专科意见(如心内科、内分泌科)时使用。",
    parameters: Type.Object({
      specialty: Type.String({ description: "专科名称,如 '心血管内科'、'内分泌科'" }),
      question: Type.String({ description: "交予专科医生的问题(需包含必要临床信息)" }),
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (signal) signal.throwIfAborted?.();
      const spec = getSpec(params.specialty) || makeDefaultSpecialist(params.specialty);
      const result = await runSpecialist(spec, params.question, { thinkingLevel: "off" });
      const text = `【专科会诊:${result.doctorId}】\n${result.text || "(无结论)"}`;
      return { content: [{ type: "text", text }], details: { doctorId: result.doctorId } };
    },
  };
}

export function makeDefaultSpecialist(specialty) {
  return {
    id: specialSlug(specialty),
    role: "专科医生",
    specialty,
    roleDescription: `你是一名资深的${specialty}专科医生。请针对该专科范畴内的问题,结合指南检索与工具,给出专业、循证的诊断与治疗建议。`,
    tools: ["search_guideline", "calculate_risk"],
  };
}

export function specialSlug(s) {
  return String(s || "").trim() || "specialist-" + Math.random().toString(36).slice(2, 6);
}

export function transcriptToText(messages) {
  // 取最后一条 assistant 文本
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") {
      const parts = Array.isArray(m.content) ? m.content : [];
      const text = parts
        .filter((c) => c && c.type === "text")
        .map((c) => c.text)
        .join("");
      if (text) return text;
    }
  }
  return "";
}
