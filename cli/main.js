#!/usr/bin/env node
// @ts-nocheck
/**
 * 康养智能体 runtime — 命令行入口
 *
 *   healthcare-runtime chat    —— 交互式医生问诊(GP 为主,可转诊/会诊/自动生成专科)
 *   healthcare-runtime serve   —— 启动 HTTP/SSE 服务
 *   healthcare-runtime doctors —— 查看/添加/自动生成专科医生
 *   healthcare-runtime setup   —— 一键初始化(.env + doctors + RAG 提示)
 */
import readline from "node:readline";
import { createDoctorAgent, transcriptToText } from "../runtime/agents/doctor.js";
import { loadDoctors, getDoctor, ensureDoctorsFile } from "../runtime/agents/registry.js";
import { autoGenerateSpecialist } from "../runtime/agents/generate.js";
import { config } from "../runtime/config/index.js";
import { startServer } from "./server.js";

function gpSpec() {
  const arr = loadDoctors();
  return arr.find((d) => d.id === "general-practitioner") || arr[0];
}

async function runChat() {
  ensureDoctorsFile();
  const doctors = {};
  let active = { id: gpSpec().id, obj: gpSpec() };
  doctors[active.id] = createDoctorAgent(active.obj);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("康养智能体 runtime —— 医生问诊");
  console.log(`当前医生: ${active.obj.specialty} (${active.obj.role})`);
  console.log("指令: /doctors 查看专科 | /switch <专科> | /auto <专科> | /new 重置 | /quit 退出\n");

  const prompt = () =>
    rl.question(`[${active.obj.specialty}] 你> `, async (line) => {
      const raw = line.trim();
      if (!raw) return prompt();
      if (raw.startsWith("/quit")) return rl.close();
      if (raw.startsWith("/new")) {
        for (const d of Object.values(doctors)) d.agent.reset();
        return prompt();
      }
      if (raw.startsWith("/doctors")) {
        console.log("\n专科医生列表:");
        for (const d of loadDoctors()) {
          console.log(`  ${d.id}  ${d.specialty}  — ${d.description || ""}`);
        }
        return prompt();
      }
      if (raw.startsWith("/switch ")) {
        const name = raw.slice(8).trim();
        const spec = getDoctor(name);
        if (!spec) return console.log(`未找到专科 ${name},用 /doctors 查看`), prompt();
        active = { id: spec.id, obj: spec };
        if (!doctors[spec.id]) doctors[spec.id] = createDoctorAgent(spec);
        console.log(`已切换到: ${spec.specialty}`);
        return prompt();
      }
      if (raw.startsWith("/auto ")) {
        const name = raw.slice(6).trim();
        console.log(`正在自动生成专科: ${name} ...`);
        try {
          const spec = await autoGenerateSpecialist(name);
          console.log(`已生成专科医生: ${spec.specialty} (${spec.id})`);
          doctors[spec.id] = createDoctorAgent(spec);
        } catch (e) {
          console.log("生成失败:", String(e));
        }
        return prompt();
      }

      const doc = doctors[active.id];
      const unsub = doc.agent.subscribe((ev) => {
        if (ev.type === "tool_execution_start") {
          process.stdout.write(`\n[工具] ${ev.toolName} ... `);
        } else if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
          process.stdout.write(ev.assistantMessageEvent.delta);
        }
      });
      try {
        await doc.agent.prompt(raw);
      } catch (e) {
        console.log("\n[错误]", String(e));
      }
      unsub();
      process.stdout.write("\n\n");
      return prompt();
    });
  prompt();

  rl.on("close", () => {
    process.stdout.write("\n再见,请注意:本工具为康养辅助,不能替代线下执业医师诊断。\n");
    process.exit(0);
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "serve": {
      const { startServer } = await import("./server.js");
      const srv = await startServer();
      console.log(`HTTP/SSE 服务已启动: http://${config.server.host}:${config.server.port}`);
      console.log(`  GET  /health`);
      console.log(`  GET/POST /api/doctors`);
      console.log(`  POST /api/chat    (SSE)`);
      console.log(`  POST /api/consult (SSE —— 专科会诊子任务)`);
      break;
    }
    case "chat":
      return runChat();
    case "doctors": {
      ensureDoctorsFile();
      for (const d of loadDoctors()) {
        console.log(`- ${d.id} | ${d.specialty} | tools=${(d.tools || []).join(",")}`);
        if (d.roleDescription) console.log(`    ${d.roleDescription}`);
      }
      break;
    }
    case "setup":
      console.log("康养智能体 runtime 初始化:");
      console.log("  1) 如需自定义 LLM/端口,请 cp .env.example .env 并修改(可选)");
      console.log("  2) 构建指南检索索引: npm run build:rag   (可选,已存在则跳过)");
      console.log("     或运行 Python 检索/评分服务:  python scripts/service.py");
      ensureDoctorsFile();
      console.log("  3) 专科注册表已就绪; 用 `healthcare-runtime chat` 或 `npm start` 开始使用");
      break;
    default:
      console.log(
        "用法:\n" +
        "  healthcare-runtime chat   交互式医生问诊\n" +
        "  healthcare-runtime serve  启动 HTTP/SSE 服务\n" +
        "  healthcare-runtime doctors 查看/管理专科医生\n" +
        "  healthcare-runtime setup  一键初始化"
      );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
