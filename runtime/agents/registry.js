// @ts-nocheck
/**
 * 康养智能体 runtime — 医生注册表(全科 + 专科)
 *
 * - 全科医生(general-practitioner)为默认入口,拥有全部工具并可发起专科会诊。
 * - 专科医生可:
 *     A) 在 doctors.json 中静态配置(install 即用)
 *     B) 通过 `doctors add` 或 auto-gen 由 LLM 自动生成(systemPrompt/工具范围)
 *
 * 让“可配置、可自主生成的专科医生”成为内置一等公民。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config/index.js";

const DOCTORS_FILE = path.join(ROOT, "runtime", "agents", "doctors.json");

const DEFAULT_DOCTORS = [
  {
    id: "general-practitioner",
    role: "全科医生",
    specialty: "全科医学",
    description: "健康咨询、疾病筛查、慢病管理、常见病初诊、风险评估",
    roleDescription:
      "作为一名全科医生,你负责患者的首诊、健康评估、慢病管理与综合风险管理。" +
      "当超出全科能力范围或需要专科意见时,应主动发起专科会诊(consult_specialist)。",
    tools: ["search_guideline", "calculate_risk", "consult_specialist"],
  },
  {
    id: "cardiologist",
    role: "专科医生",
    specialty: "心血管内科",
    description: "冠心病、心衰、心律失常、高血压、房颤卒中风险评估",
    roleDescription:
      "作为一名心内科专科医生,重点处理胸痛、心悸、心衰、高血压、房颤等。" +
      "评估房颤卒中风险时可选用 CHA2DS2-VASc 评分,评估 ACS 时用 HEART 评分。",
    tools: ["search_guideline", "calculate_risk"],
  },
  {
    id: "endocrinologist",
    role: "专科医生",
    specialty: "内分泌科",
    description: "糖尿病、甲状腺疾病、代谢综合征、骨质疏松",
    roleDescription:
      "作为一名内分泌专科医生,处理糖尿病、甲状腺、代谢及骨质疏松等内分泌代谢疾病。" +
      "基于指南检索给出诊疗与生活方式干预建议。",
    tools: ["search_guideline", "calculate_risk"],
  },
  {
    id: "respiratory",
    role: "专科医生",
    specialty: "呼吸内科",
    description: "哮喘、慢阻肺、肺炎、肺栓塞(可配合 Wells/DVT 评估)、睡眠呼吸暂停",
    roleDescription:
      "作为一名呼吸内科专科医生,处理咳嗽、气促、哮喘、COPD、肺栓塞等。" +
      "疑似 DVT/PE 时可结合风险评估工具与指南检索。",
    tools: ["search_guideline", "calculate_risk"],
  },
];

export function loadDoctors() {
  if (existsSync(DOCTORS_FILE)) {
    try {
      const arr = JSON.parse(readFileSync(DOCTORS_FILE, "utf-8"));
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {
      // 损坏则回退默认
    }
  }
  return DEFAULT_DOCTORS;
}

export function saveDoctors(arr) {
  writeFileSync(DOCTORS_FILE, JSON.stringify(arr, null, 2), "utf-8");
  return arr;
}

export function ensureDoctorsFile() {
  if (!existsSync(DOCTORS_FILE)) saveDoctors(DEFAULT_DOCTORS);
  return loadDoctors();
}

export function getDoctor(specialtyOrId) {
  const docs = loadDoctors();
  const q = String(specialtyOrId || "").trim();
  return docs.find(
    (d) =>
      d.id === q ||
      d.specialty === q ||
      d.role === q ||
      (d.description || "").includes(q)
  );
}

/** 添加/覆盖一个医生。 */
export function upsertDoctor(spec) {
  const docs = loadDoctors();
  const i = docs.findIndex((d) => d.id === spec.id);
  if (i >= 0) docs[i] = { ...docs[i], ...spec };
  else docs.push(spec);
  return saveDoctors(docs);
}
