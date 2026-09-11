// @ts-nocheck
/**
 * 康养智能体 runtime — Risk Calculator 工具
 *
 * 调用确定性评分引擎(见 scripts/calcs.py),禁止 agent 心算临床分数。
 * 只读工具;输入在 Python 侧做 schema 校验与缺失值处理。
 */
import { Type } from "typebox";
import { domainClient } from "../core/domain.js";

const BOOL_MAP = {
  "true": true, "false": false, "1": true, "0": false, "yes": true, "no": false, "y": true, "n": false,
  "是": true, "否": false, "有": true, "无": false,
};

export function makeCalculateRiskTool(client = domainClient) {
  return {
    name: "calculate_risk",
    label: "计算临床风险评分",
    description:
      "调用确定性的、带版本的风险评分器(如 wells-dvt、heart、cha2ds2-vasc)计算风险分层。必须从病历/主诉中提取必要输入后再调用。只读工具。",
    parameters: Type.Object({
      calc_id: Type.Union(
        [
          Type.Literal("wells-dvt"),
          Type.Literal("heart-score"),
          Type.Literal("cha2ds2-vasc"),
        ],
        { description: "计算器 id: wells-dvt / heart-score / cha2ds2-vasc" }
      ),
      inputs: Type.Record(Type.String(), Type.Union([Type.Boolean(), Type.Number(), Type.String()]), {
        description: "计算的各项输入,布尔项传 true/false 或用中文 是/否,数值项传数字",
      }),
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (signal) signal.throwIfAborted?.();
      const normInputs = {};
      for (const [k, v] of Object.entries(params.inputs || {})) {
        if (typeof v === "boolean") normInputs[k] = v;
        else if (typeof v === "number") normInputs[k] = v;
        else if (typeof v === "string") {
          const low = v.trim().toLowerCase();
          if (low in BOOL_MAP) normInputs[k] = BOOL_MAP[low];
          else if (low !== "") normInputs[k] = v.trim();
        }
      }
      const data = await client.calculate(params.calc_id, normInputs);
      const r = data.result || data;
      const text = [
        `计算器: ${params.calc_id} (${r.version ? "v" + r.version : ""})`,
        `风险: ${r.risk}`,
        `评分: ${JSON.stringify(r.scores || {})}`,
        r.probability ? `概率: ${r.probability}` : "",
        r.note ? r.note : "",
        r.error ? `错误: ${r.error}` : "",
      ].filter(Boolean).join("\n");
      return {
        content: [{ type: "text", text }],
        details: { calc_id: params.calc_id, result: r },
      };
    },
  };
}
