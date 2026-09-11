# 康养智能体 Runtime (Healthcare Agent Runtime)

把 [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi) 作为通用 Agent 内核，
在其上加一层 **康养/医疗 profile**：内置 Guideline Retrieval(RAG)与确定性 Risk Calculator，
并原生支持 **全科医生(主入口) + 可配置/可自动生成的专科医生(子智能体、子任务)** 编排。

> 架构定位：`pi-agent-core` 是通用 runtime 内核；本工程提供医疗工具、医生角色、策略与检索——这正是 idea.log
> 里建议的 `clinical-agent-core`（一个很薄的、像 pi 一样简单的医疗 Agent Runtime）。

```
┌─────────────────────────────────────────────────────────────┐
│  cli/main.js  (chat / serve / doctors / setup)         │
│  cli/server.js (HTTP + SSE)                           │
└──────────────┬──────────────────────────────────────────────┘
               │  @earendil-works/pi-agent-core (Agent loop, tools, events)
┌──────────────▼──────────────────────────────────────────────┐
│  runtime/agents   全科医生 GP + 专科医生注册表 + 自动生成 │
│  runtime/tools    search_guideline / calculate_risk      │
│                    / consult_specialist(子智能体会诊)      │
│  runtime/core      llm 装配(pi-ai) + 域服务客户端      │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP (127.0.0.1:8787)
┌──────────────▼──────────────────────────────────────────────┐
│  scripts/service.py  Guideline RAG(FAISS) + 风险评分引擎 │
│  scripts/calcs.py   wells-dvt / heart / cha2ds2-vasc   │
│  scripts/build_rag.py 索引 ../task2(西氏内科学) ../task3(UpToDate)│
└─────────────────────────────────────────────────────────────┘
```

## 特性

1. **好安装** —— `bash install.sh` 或 `npm install && node scripts/bootstrap.js`，随后 `npm run chat` 即可用；
   通过 `.env`（已带默认值）即可切换 LLM 端点，不改代码。
2. **自带 Guideline Retrieval** —— 检索 `../task2` 的《西氏内科学精要》上下卷 PDF 与 `../task3` 的 UpToDate 主题；
   检索以工具 `search_guideline` 暴露给 Agent。
3. **Risk Calculator** —— 确定性、带版本、输入校验的评分引擎（`wells-dvt` / `heart` / `cha2ds2-vasc`），
   通过工具 `calculate_risk` 暴露，Agent 不心算临床分数。
4. **全科 + 专科医生** —— 全科医生为主入口，可发起 `consult_specialist` 专科会诊（子智能体/子任务）；
   专科医生可在 `runtime/agents/doctors.json` 配置，也可用 LLM **自动生成**（`/auto <专科>` 或 `POST /api/doctors`）。

## 快速开始

```bash
# 1) 安装(runtime 在 healthcare-runtime 目录下)
bash install.sh

# 2) 构建指南索引(需要 faiss/sentence-transformers;约几分钟)
npm run build:rag

# 3) 启动领域服务(另一个终端)
python scripts/service.py --rag data/rag

# 4) 交互问诊
npm run chat
```

> 如认识不到本地模型，编辑 `.env` 的 `HEALTHCARE_LLM_BASE_URL`（默认连 `http://deepseek-v4-flash:8000/v1` 的 minimax）。

## HTTP/SSE 服务

```bash
npm start          # 启动 http://127.0.0.1:4000
```

- `GET  /health`
- `GET  /api/doctors`             —— 列出医生
- `POST /api/doctors`             —— `{"add":{...}}` 或 `{"autoGenerate":"神经内科"}`
- `POST /api/chat`               —— GP 问诊（SSE），体 `{message, doctorId?}`
- `POST /api/consult`            —— 专科会诊（SSE），体 `{specialty, question}`

SSE 事件：`meta` / `text` / `tool` / `tool_done` / `done` / `error`。

## 命令行

```bash
node cli/main.js chat     # 交互问诊
node cli/main.js doctors  # 查看/管理专科
node cli/main.js serve    # HTTP/SSE
node cli/main.js setup    # 一键初始化
```

chat 内的指令：
`/doctors` 查看专科 · `/switch <专科>` 切换 · `/auto <专科>` 自动生成新专科医生 · `/new` 重置 · `/quit` 退出。

## 医生 / 子智能体

`runtime/agents/doctors.json` 为静态配置；每次启动若不存在会自动生成默认注册表（含全科+心内+内分泌+呼吸）。
专科医生拥有其专属 `systemPrompt` 与工具范围；全科医生额外持有 `consult_specialist` 用以发起子智能体会诊。

## 扩展「未来工具 / 更多评分器」

- **新增评分器**：在 `scripts/calcs.py` 加一个 `@register(...)` 函数即可自动出现在 `/calculators` 与 `calculate_risk`。
- **接入其它知识源 / 工具**：在 `scripts/service.py` 增加 endpoint，并在 `runtime/tools/` 写一个包装工具。

## 安全与责任说明

- Guideline/评分工具均为**只读**；确定性评分在服务端完成并带版本。
- 本 runtime 定位为康养/临床辅助，输出不能替代线下执业医师诊断，请勿据此作出独立诊疗决策。

## License

MIT（`pi-agent-core` 亦为 MIT）。
