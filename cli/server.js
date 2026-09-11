// @ts-nocheck
/**
 * 康养智能体 runtime — HTTP/SSE 服务
 *
 * 用 Node 内置 http 模块(零额外依赖)暴露:
 *   GET  /health
 *   GET  /api/doctors
 *   POST /api/doctors       {add:{...}} 或 {autoGenerate:{specialty}}
 *   POST /api/chat          {message, doctorId?}  -> SSE 流式(GP / 指定医生)
 *   POST /api/consult       {specialty, question}    -> SSE 流式(专科会诊子任务)
 *
 * 所有 /api/chat 与 /api/consult 通过 Server-Sent Events 实时推送:
 *   event: text | tool | done | error
 */
import http from "node:http";
import { createDoctorAgent, getSharedModels } from "../runtime/agents/doctor.js";
import { loadDoctors, getDoctor, upsertDoctor } from "../runtime/agents/registry.js";
import { autoGenerateSpecialist } from "../runtime/agents/generate.js";
import { config } from "../runtime/config/index.js";

function getSpec(doctorId) {
  if (!doctorId || doctorId === "general-practitioner") {
    const arr = loadDoctors();
    return arr.find((d) => d.id === "general-practitioner") || arr[0];
  }
  return getDoctor(doctorId) || loadDoctors()[0];
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamAgent(agentCore, message, res) {
  const unsub = agentCore.agent.subscribe((ev) => {
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      sse(res, "text", { delta: ev.assistantMessageEvent.delta });
    } else if (ev.type === "tool_execution_start") {
      sse(res, "tool", { name: ev.toolName, args: ev.args });
    } else if (ev.type === "tool_execution_end") {
      sse(res, "tool_done", { name: ev.toolName, isError: ev.isError });
    }
  });
  try {
    await agentCore.agent.prompt(message);
  } finally {
    unsub();
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

export async function startServer(host = config.server.host, port = config.server.port) {
  getSharedModels();

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    const [path, _q] = url.split("?");

    if (req.method === "GET" && path === "/health") {
      return sendJson(res, 200, { ok: true, service: "healthcare-runtime" });
    }
    if (req.method === "GET" && path === "/api/doctors") {
      return sendJson(res, 200, { doctors: loadDoctors() });
    }

    if (req.method === "POST") {
      if (path === "/api/doctors") {
        try {
          const body = await readBody(req);
          if (body.autoGenerate) {
            const spec = await autoGenerateSpecialist(body.autoGenerate);
            return sendJson(res, 200, { created: spec });
          }
          if (body.add) {
            upsertDoctor(body.add);
            return sendJson(res, 200, { ok: true, doctors: loadDoctors() });
          }
          return sendJson(res, 400, { error: "need {add} or {autoGenerate}" });
        } catch (e) {
          return sendJson(res, 500, { error: String(e) });
        }
      }

      if (path === "/api/chat" || path === "/api/consult") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        try {
          const body = await readBody(req);
          const message = body.message || body.question;
          const doctorId = path === "/api/chat" ? body.doctorId : undefined;
          const spec = path === "/api/consult"
            ? (getDoctor(body.specialty) || { id: body.specialty, role: "专科医生", specialty: body.specialty, tools: ["search_guideline", "calculate_risk"] })
            : getSpec(doctorId);
          const doctor = createDoctorAgent(spec);
          sse(res, "meta", { doctor: spec.id || spec.specialty });
          await streamAgent(doctor, message, res);
          const final = doctor.agent.state.messages
            .filter((m) => m.role === "assistant")
            .map((m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === "text").map((c) => c.text).join("") : ""))
            .join("\n");
          sse(res, "done", { text: final });
        } catch (e) {
          sse(res, "error", { error: String(e) });
        }
        res.end();
        return;
      }
    }

    return sendJson(res, 404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}
