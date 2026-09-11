// @ts-nocheck
/**
 * 康养智能体 runtime — 领域服务客户端
 *
 * 封装对 Python 领域服务(Guideline retrieval + Risk Calculator)的 HTTP 调用,
 * 被 agent 工具复用。失败抛错,由工具层/agent loop 捕获并作为 isError 反馈给模型。
 */
import { config } from "../config/index.js";

export class DomainClient {
  constructor(baseUrl = config.domain.baseUrl, fetchImpl = globalThis.fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async _post(path, body, timeoutMs = 60000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`domain service returned non-JSON: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        throw new Error(data.error || `domain service error ${res.status}`);
      }
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  async search(query, k = 5) {
    return this._post("/search", { query, k });
  }

  async calculate(calcId, inputs) {
    return this._post("/calculate", { calc_id: calcId, inputs });
  }

  async calculators() {
    const res = await this.fetchImpl(this.baseUrl + "/calculators");
    if (!res.ok) throw new Error("failed to list calculators");
    return res.json();
  }
}

export const domainClient = new DomainClient();
