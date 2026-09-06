# AgentMonitor Agent 应用开发者接入与评测差距——完整技术方案

> 文档状态：实施设计稿  
> 文档版本：v1.0  
> 日期：2026-08-23  
> 适用代码基线：当前工作区（master 与 1.0.4 比较阶段）  
> 目标读者：产品、后端、前端、SDK、测试、Agent 应用开发者

## 1. 文档目标与范围

本文解决的不是“再增加几个页面”，而是让 AgentMonitor 从功能原型变成 Agent 应用开发者可以独立完成接入、观测、样本发送、自动评分、问题定位和回归门禁的平台。

目标闭环如下：

~~~text
创建项目与凭据
  → 接入 SDK 或 Hook
  → 看到一条结构正确的 Agent Trace
  → 注册一个可执行 Agent Target
  → 导入并固化 DatasetVersion
  → 选择 EvaluatorSuiteVersion
  → 创建可重复执行的 Experiment
  → 异步运行 EvalRun
  → 查看每条样本的输出、评分理由和 Trace
  → 修复 Bad Case 并加入回归集
  → 在 CLI/CI 中设置质量门禁
~~~

本文聚焦功能需求和保证功能正确所必需的技术机制。高可用、容量规划、灾备、合规认证、精细性能优化等非功能需求暂不展开；鉴权范围、幂等、任务恢复和密钥引用仍纳入方案，因为没有这些能力，CLI、外部 Runner 和异步评测功能无法成立。

## 2. 总体结论

当前项目已经具备 Trace、Span、Session、Dataset、Evaluator、Experiment、Prompt、Playground、自动评测、告警、CLI 和三语言 SDK 的大量基础代码，但关键链路存在协议和领域模型断裂。最优先的不是扩展菜单，而是完成以下三个 P0：

1. 建立唯一的 Telemetry V2 协议，修复 Trace/Span ID、生命周期合并和并发上下文传播。
2. 建立通用 Agent Target 与 Experiment/Run 分离模型，使平台能够真实执行 HTTP Agent、本地 Agent 和 Prompt+模型，并由服务端统一评分。
3. 建立首次接入、真实 Playground、异步进度、Bad Case 和 CLI/CI 的开发者闭环，删除或隐藏模拟成功与占位功能。

统一后的核心领域关系为：

~~~text
Session
  └── TraceRun
        └── Span × N

DatasetVersion ───────────────┐
AgentTargetVersion ───────────┼── Experiment（不可变评测配方）
EvaluatorSuiteVersion ────────┘             │
                                            └── EvalRun × N
                                                   └── EvalRunItem × N
                                                          ├── TargetExecution
                                                          ├── EvalScore × N
                                                          └── TraceRun
~~~

## 3. 已验证的问题与差距清单

### 3.1 P0：Telemetry 与 SDK 正确性

| 编号 | 问题 | 当前证据 | 直接影响 | 解决方案摘要 |
|---|---|---|---|---|
| TEL-01 | Span 开始和结束使用同一 ID 两次 POST，但结束数据被数据库忽略 | [sdk/src/index.ts](../sdk/src/index.ts#L723)、[sdk/src/index.ts](../sdk/src/index.ts#L758)、[backend/src/services/span.ts](../backend/src/services/span.ts#L60) | Span 长期为未结束，无输出、耗时和错误 | 改为 Telemetry Event + 幂等 Upsert；end 必须合并终态字段 |
| TEL-02 | SDK trace 和后端 trace 服务都写根 Span，且 SDK 为 traceId/spanId 分别随机生成 | [sdk/src/index.ts](../sdk/src/index.ts#L170)、[sdk/src/index.ts](../sdk/src/index.ts#L186) | 重复根节点、孤立 Span、树结构错误 | 只允许一个根 Span；V1 路由适配 V2，不再双写 |
| TEL-03 | TypeScript TraceData 没有正式暴露 traceId/spanId/parentSpanId | [sdk/src/types.ts](../sdk/src/types.ts#L43) | Agent 无法显式关联跨服务、评测和现有上下文 | V2 类型公开 TraceContext，支持 inject/extract |
| TEL-04 | TypeScript 通过进程级 spanStack 扫描“当前 Span” | [sdk/src/index.ts](../sdk/src/index.ts#L67)、[sdk/src/index.ts](../sdk/src/index.ts#L844) | Promise 并发时不同请求可能串树 | Node 使用 AsyncLocalStorage；浏览器使用显式 Context |
| TEL-05 | Python 同样使用全局 span_stack | [sdk-python/agentmonitor/client.py](../sdk-python/agentmonitor/client.py#L59)、[sdk-python/agentmonitor/client.py](../sdk-python/agentmonitor/client.py#L397) | asyncio Task 之间上下文污染 | 使用 contextvars.ContextVar；线程池提供 copy_context |
| TEL-06 | Python LangChain Callback 绕过序列化层直接写 snake_case Buffer | [sdk-python/agentmonitor/langchain_callback.py](../sdk-python/agentmonitor/langchain_callback.py#L64) | 与后端 camelCase 契约不一致，可能 400 或字段丢失 | Callback 只能调用公开 startSpan/endSpan API |
| TEL-07 | Go 依赖全局 spanStack，而非 context.Context | [sdk-go/agentmonitor/client.go](../sdk-go/agentmonitor/client.go#L36)、[sdk-go/agentmonitor/client.go](../sdk-go/agentmonitor/client.go#L233) | goroutine 并发链路无法可靠传播 | context.Context 成为唯一隐式传播源 |
| TEL-08 | Go Eino 使用独立 EinoSpanContext 且重复定义 bufferSpan | [sdk-go/agentmonitor/eino_middleware.go](../sdk-go/agentmonitor/eino_middleware.go#L11)、[sdk-go/agentmonitor/eino_middleware.go](../sdk-go/agentmonitor/eino_middleware.go#L174)、[sdk-go/agentmonitor/client.go](../sdk-go/agentmonitor/client.go#L780) | 类型分裂、适配器不可可靠 Flush，甚至存在编译冲突风险 | Eino 适配器只调用统一 Span Handle，不定义内部 Buffer 类型 |
| TEL-09 | startSession 主要维护本地状态，endSession 不能保证服务端 Session 真正关闭 | [sdk/src/index.ts](../sdk/src/index.ts#L209) | Session 可能长期 active | 增加 session.start/session.end 事件或明确 Session API |
| TEL-10 | Trace、Span、Feedback 的重试与缓冲行为不一致 | [sdk/src/index.ts](../sdk/src/index.ts#L837) | 网络波动时产生半条链路 | 所有事件进入同一有界可靠队列，使用 eventId 幂等 |
| TEL-11 | 内部数据库 id、trace_id、span_id 语义混用 | [backend/src/db/sqlite.ts](../backend/src/db/sqlite.ts#L582) | 页面跳转、评测关联、跨服务传播容易传错 ID | 外部只使用 W3C traceId/spanId；数据库 id 永不暴露为追踪上下文 |

### 3.2 P0：评测闭环正确性

| 编号 | 问题 | 当前证据 | 直接影响 | 解决方案摘要 |
|---|---|---|---|---|
| EVAL-01 | 前端创建实验提交 model_config 快照，而执行器要求 target_model_config_id 或 prompt_id | [frontend/src/pages/EvaluationPage.tsx](../frontend/src/pages/EvaluationPage.tsx#L206)、[backend/src/services/evaluation-runner.ts](../backend/src/services/evaluation-runner.ts#L25) | 页面创建的实验可保存但无法执行 | P0 先修字段；V2 用 targetVersionId 取代模型快照 |
| EVAL-02 | 执行器直接选择项目第一个评估器 | [backend/src/services/evaluation-runner.ts](../backend/src/services/evaluation-runner.ts#L35) | 用户选择无效，结果不可复现 | 引入 Evaluator Suite，并锁定 evaluatorVersionId |
| EVAL-03 | 快速评测向导显示评估器，但丢弃 evaluatorId | [frontend/src/components/evaluation/EvalWizard.tsx](../frontend/src/components/evaluation/EvalWizard.tsx#L44)、[frontend/src/components/evaluation/EvalWizardStep3.tsx](../frontend/src/components/evaluation/EvalWizardStep3.tsx#L55) | 评测口径与 UI 不一致 | 向导提交 suiteVersionId 或明确 evaluator bindings |
| EVAL-04 | 实验定义和一次执行共用同一条 Experiment 记录 | [backend/src/db/sqlite.ts](../backend/src/db/sqlite.ts#L330) | 无法重复运行、比较 Git/Prompt/Agent 版本或保存运行历史 | 拆分 Experiment、EvalRun、EvalRunItem、EvalScore |
| EVAL-05 | start 路由在请求内等待整批执行完成 | [backend/src/routes/evaluation.ts](../backend/src/routes/evaluation.ts#L621) | 请求阻塞，刷新丢进度，无法稳定取消和恢复 | 返回 202 + 持久化数据库 Worker |
| EVAL-06 | 外部脚本在客户端自行 exact match 并提交 score | [backend/src/services/evaluation.ts](../backend/src/services/evaluation.ts#L1285) | 平台无法保证评分版本和统一口径 | Runner 只上传原始输出；服务端执行锁定 Suite |
| EVAL-07 | Target 接收 promptVersionId 但执行时未按版本加载 | [backend/src/services/evaluation-target.ts](../backend/src/services/evaluation-target.ts#L23)、[backend/src/services/evaluation-target.ts](../backend/src/services/evaluation-target.ts#L32) | 历史实验不能复现 | TargetVersion 必须锁定并实际读取 PromptVersion |
| EVAL-08 | Prompt 自动回归可创建没有合法 Target 的实验 | [backend/src/routes/prompts.ts](../backend/src/routes/prompts.ts#L151) | 自动回归启动即失败 | Prompt 发布前创建 prompt_model TargetVersion，再创建 Run |
| EVAL-09 | 自动评测 trigger 只更新时间戳 | [backend/src/services/evaluation.ts](../backend/src/services/evaluation.ts#L1075) | 页面显示可触发，实际没有评分 | 实现定时 Run 和 Trace Sampling 两种真实任务；完成前隐藏入口 |
| EVAL-10 | Result 同时保存 Target 输出和单个评分 | [backend/src/db/sqlite.ts](../backend/src/db/sqlite.ts#L350) | 无法表达一条样本多个评估器及评估器错误 | 拆为 RunItem.targetOutput 和 EvalScore × N |
| EVAL-11 | DatasetVersion 使用整包 item_data，缺少稳定逐样本快照 | [backend/src/db/sqlite.ts](../backend/src/db/sqlite.ts#L264) | 版本对比和 case 级回归不稳定 | 增加 dataset_version_items 与 caseKey/contentHash |
| EVAL-12 | 后端已有轨迹评测入口，但前端没有清晰入口 | [backend/src/routes/traces.ts](../backend/src/routes/traces.ts#L704) | 开发者无法从 Trace 快速验证轨迹 | Trace 详情加入快速评测、加入数据集、重放入口 |

### 3.3 P0：Prompt、Playground、Provider 与开发者体验

| 编号 | 问题 | 当前证据 | 直接影响 | 解决方案摘要 |
|---|---|---|---|---|
| DX-01 | Playground 单次运行和对比在前端写入模拟输出 | [frontend/src/pages/PromptsPage.tsx](../frontend/src/pages/PromptsPage.tsx#L220)、[frontend/src/pages/PromptsPage.tsx](../frontend/src/pages/PromptsPage.tsx#L242) | 用户把伪结果误认为真实模型结果 | 删除模拟分支，统一调用 Target invoke/compare |
| DX-02 | 只有零散 SDK 文档，没有“创建 Key→发送测试 Trace→诊断 Hook”向导 | [docs/SDK-QUICKSTART.md](./SDK-QUICKSTART.md) | 首次接入依赖读源码和人工排错 | 新增可恢复 Onboarding 与 integration-status API |
| DX-03 | README 明确标注 API 文档待完善 | [README.md](../README.md#L69) | 外部开发者缺少稳定接口契约 | 发布 OpenAPI、协议 Schema、示例 Agent 和错误码文档 |
| DX-04 | 后端 Model Client 只实现 OpenAI-compatible /chat/completions，UI 却展示原生 Anthropic 等 Provider | [backend/src/services/llm-client.ts](../backend/src/services/llm-client.ts#L25)、[frontend/src/constants/modelProviders.ts](../frontend/src/constants/modelProviders.ts#L27) | 配置看似可选但调用失败 | 引入 Provider Adapter；UI 只显示已实现并通过契约测试的 Provider |
| DX-05 | Prompt 版本有存储，但缺少运行时 resolve/deployment 能力 | [backend/src/db/sqlite.ts](../backend/src/db/sqlite.ts#L389) | Agent 代码不能稳定按环境读取已发布版本 | 增加 prompt_deployments 和 Runtime API/SDK Cache |
| DX-06 | 核心页面错误大量停留在 console | 现有页面通用实现 | 用户不知道保存、执行或映射为什么失败 | 统一 API Error、字段错误、Toast、重试和执行日志 |
| DX-07 | Trace 页面只能展示数据，不能判断埋点是否完整 | 现有 Trace 列表与详情 | “已上报”被误认为“正确接入” | 增加 Hook 完整度与 instrumentation health |
| DX-08 | Prompt、Target、Experiment、Trace、Dataset 缺少双向链接 | 现有资源页面分散 | 排查 Bad Case 需要手工复制 ID | 所有 RunItem 保存版本与 traceId，详情页提供互跳 |

### 3.4 P0：认证、CLI 与自动化

| 编号 | 问题 | 当前证据 | 直接影响 | 解决方案摘要 |
|---|---|---|---|---|
| AUTH-01 | 评测路由主要使用用户 JWT，中长期 Runner/CI 没有合适凭据 | [backend/src/middleware/auth.ts](../backend/src/middleware/auth.ts#L10)、[backend/src/middleware/apikey.ts](../backend/src/middleware/apikey.ts#L10) | CI 必须伪装成人登录或直接失败 | 增加项目级 Service Token 与 scopes |
| CLI-01 | CLI 把 API Key 当 Bearer JWT，且 project_id 硬编码 default | [cli/src/commands/eval.ts](../cli/src/commands/eval.ts#L15) | CLI 无法可靠调用多项目评测 | profile 保存 baseUrl/projectId/token，API 从凭据推断项目 |
| CLI-02 | package bin 指向 dist/index.js，但 src 缺少正式入口 | [cli/package.json](../cli/package.json#L6) | 安装后命令不可稳定执行 | 增加 src/index.ts、构建校验和命令集成测试 |
| CLI-03 | CLI 缺少 run→wait→gate 完整流程 | [cli/src/commands](../cli/src/commands) | 无法作为 CI 质量门禁 | 增加 eval run/wait/report/gate、Runner 模式与退出码 |

### 3.5 P1/P2：当前应明确降级或后置的功能

| 编号 | 问题 | 处理原则 |
|---|---|---|
| CONT-01 | 告警规则主要依赖内存 Map，通知以控制台为主 | P1 持久化规则和执行记录，提供 Webhook；完成前标记实验性 |
| CONT-02 | 断点功能当前更接近“条件快照”，并非真正远程暂停/继续 Agent | P0 改名为条件快照；远程控制通道作为 P2 |
| CONT-03 | 自动在线评测没有 Trace 去重和来源快照 | P1 引入 trace_replay Target 与 auto_eval_sources |
| CONT-04 | 多 Agent handoff、RAG groundedness、复杂轨迹评分尚未形成统一协议 | 基于 Telemetry Link、Evaluator Suite 在 P2 扩展，不能另起一套数据模型 |

## 4. 目标架构

### 4.1 两条独立但可关联的数据流

~~~text
观测数据流

Agent 应用
  → SDK / Framework Adapter / Custom Hook
  → POST /api/v2/telemetry/batch
  → TelemetryIngestService
  → trace_runs + spans + sessions
  → Trace Explorer / Integration Health

评测数据流

UI / CLI / CI / Scheduler
  → Experiment
  → EvalRun（202 queued）
  → Evaluation Worker
  → Target Adapter
       ├── prompt_model
       ├── http_agent
       ├── external_runner
       └── trace_replay
  → Target 原始输出 + traceId
  → Evaluator Suite
  → EvalScore × N
  → 聚合 / Gate / Report / Bad Case / Baseline Compare
~~~

两条流通过 runId、runItemId、datasetItemId 和 traceId 双向关联。Telemetry 上报失败不应使 Agent 业务失败；Target 执行失败则必须在 EvalRun 中作为明确的 execution error 展示，不能伪装成质量低分。

### 4.2 核心设计原则

1. 一个 Trace 只有一个 traceId 和一个根 Span；SDK 与后端不得双写不同根节点。
2. Experiment 是不可变评测配方，EvalRun 是某次执行；已完成 Run 永不重新变回 running。
3. Dataset、Target、Evaluator Suite、Prompt 都以不可变版本参与运行。
4. 外部 Runner 只执行 Agent 并上传原始结果，最终评分始终由平台锁定版本执行。
5. 所有长任务异步化，Start API 只负责创建 Run 并返回 202。
6. 所有公共 JSON 字段统一 camelCase；数据库列保持 snake_case；V1 兼容层负责转换。
7. 所有外部请求使用明确的 idempotencyKey/eventId；重试不得制造重复 Span、RunItem 或 Score。
8. 模拟输出、静默 fallback 和“只更新时间戳”的占位功能不得以成功状态暴露给用户。

## 5. Telemetry V2 协议

### 5.1 对象与 ID 语义

| 对象 | 语义 | ID 规则 |
|---|---|---|
| Session | 一段多轮用户会话，可包含多个 Agent Run | 业务可传；平台可生成 |
| TraceRun | 一次完整 Agent 执行 | W3C traceId：32 位小写十六进制 |
| Span | Agent、LLM、Tool、Retriever 等执行步骤 | W3C spanId：16 位小写十六进制 |
| Event | start/end/瞬时事件的传输单元 | UUID v7，负责幂等 |
| Link | fan-out、异步任务、多 Agent handoff 等非父子关系 | traceId + spanId |
| 数据库 id | 平台内部资源主键 | 不参与跨服务传播 |

跨服务使用 W3C Trace Context：

~~~http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: agentmonitor=...
baggage: agentmonitor.session_id=sess_123,agentmonitor.run_item_id=ri_123
~~~

API Key、Prompt 内容、用户输入和大对象禁止进入 baggage。

### 5.2 统一事件 Envelope

~~~ts
interface TelemetryEvent {
  schemaVersion: '2.0';
  eventId: string;
  eventType:
    | 'session.start'
    | 'session.end'
    | 'trace.start'
    | 'trace.end'
    | 'span.start'
    | 'span.end'
    | 'span.event'
    | 'feedback.created'
    | 'sample.completed';
  occurredAt: string;              // RFC3339 UTC
  sequence?: number;

  resource: {
    serviceName: string;
    serviceVersion?: string;
    environment?: string;
    sdkName: string;
    sdkVersion: string;
    agentName?: string;
    agentVersion?: string;
  };

  context: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    sessionId?: string;
    userId?: string;
    experimentId?: string;
    runId?: string;
    runItemId?: string;
    datasetId?: string;
    datasetItemId?: string;
  };

  payload: Record<string, unknown>;
}
~~~

Span Kind 固定为：agent、chain、llm、tool、retriever、reranker、planner、decision、guardrail、memory、handoff、workflow、task、custom。

状态固定为：unset、ok、error、cancelled、timeout。V1 的 success 在兼容层映射为 ok。

### 5.3 Span 开始与结束示例

~~~json
{
  "schemaVersion": "2.0",
  "eventId": "019172aa-87de-7fd8-982f-cfeb2d166534",
  "eventType": "span.start",
  "occurredAt": "2026-08-23T08:00:00.123Z",
  "resource": {
    "serviceName": "refund-agent",
    "serviceVersion": "1.4.0",
    "environment": "staging",
    "sdkName": "agentmonitor-js",
    "sdkVersion": "2.0.0"
  },
  "context": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7",
    "parentSpanId": "3ff9a07b52ed4c31",
    "sessionId": "sess_123",
    "runId": "run_123",
    "runItemId": "ri_123"
  },
  "payload": {
    "name": "queryOrder",
    "kind": "tool",
    "input": { "orderId": "123" },
    "attributes": {
      "tool.name": "order_query",
      "tool.call_id": "call_789"
    }
  }
}
~~~

~~~json
{
  "schemaVersion": "2.0",
  "eventId": "019172aa-8d56-72d2-bbca-7aa31304e940",
  "eventType": "span.end",
  "occurredAt": "2026-08-23T08:00:01.523Z",
  "resource": {
    "serviceName": "refund-agent",
    "sdkName": "agentmonitor-js",
    "sdkVersion": "2.0.0"
  },
  "context": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7"
  },
  "payload": {
    "status": "ok",
    "endedAt": "2026-08-23T08:00:01.523Z",
    "durationMs": 1400,
    "output": { "status": "paid" },
    "attributes": { "retry.count": 0 }
  }
}
~~~

错误必须是结构化对象：

~~~json
{
  "type": "ToolTimeoutError",
  "code": "UPSTREAM_TIMEOUT",
  "message": "order service timed out",
  "stack": "...",
  "retryable": true
}
~~~

LLM 标准属性至少包括：

~~~text
gen_ai.system
gen_ai.request.model
gen_ai.response.model
gen_ai.request.temperature
gen_ai.request.max_tokens
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.usage.total_tokens
gen_ai.response.finish_reason
gen_ai.response.id
gen_ai.cost.usd
gen_ai.time_to_first_token_ms
gen_ai.stream.chunk_count
prompt.id
prompt.version_id
~~~

### 5.4 Ingest API

~~~http
POST /api/v2/telemetry/batch
Authorization: Bearer <service-token>
Content-Type: application/json
~~~

~~~json
{
  "events": [
    { "schemaVersion": "2.0", "eventId": "...", "eventType": "trace.start" }
  ]
}
~~~

返回逐项状态：

~~~json
{
  "accepted": [
    { "eventId": "evt_1", "status": "stored" },
    { "eventId": "evt_2", "status": "duplicate" }
  ],
  "rejected": [
    {
      "eventId": "evt_3",
      "code": "INVALID_PARENT",
      "message": "parentSpanId has invalid format",
      "retryable": false
    }
  ],
  "requestId": "req_123"
}
~~~

HTTP 语义：整批格式错误为 400；凭据无效为 401；部分事件失败仍返回 200 并列出 rejected；429/503 带 Retry-After。SDK 仅重试网络错误、429、5xx 和 retryable=true 的事件，并沿用原 eventId。

### 5.5 Start/End 幂等合并规则

数据库唯一键：

~~~text
trace_runs: UNIQUE(project_id, trace_id)
spans: UNIQUE(project_id, trace_id, span_id)
telemetry_event_receipts: PRIMARY KEY(project_id, event_id)
~~~

合并规则：

| 到达顺序 | 最终行为 |
|---|---|
| start → end | 插入开始字段，再合并终态字段 |
| end → start | end 可创建占位记录；后到 start 只补缺失开始字段 |
| start → start | eventId 相同视为重复；不同 eventId 只补缺失字段 |
| start → end → end | 使用 sequence 或 occurredAt 选择较新终态，保留冲突审计 |
| 子 Span → 父 Span | 允许先落子 Span；不使用立即父外键阻塞乱序 |

关键约束：

- startedAt 取最早有效值，endedAt 取最晚有效值。
- durationMs 在时间完整时由服务端重算；SDK 原值可放入 attributes。
- ok/error/cancelled/timeout 不得被后到的 start 降级为 unset。
- input、output、error、usage 和 attributes 按字段合并，不整行覆盖为空。
- 当前 span 服务中的 INSERT OR IGNORE / DO NOTHING 必须替换为真正 Upsert。

### 5.6 可靠发送与采样

三语言 SDK 统一为：

~~~text
应用线程
  → 内存有界队列
  → 后台 Batch Worker
  → /api/v2/telemetry/batch
  → eventId 幂等
~~~

规则：

- Trace、Span、Message、Feedback、Sample 使用同一队列。
- 同一 Span 的 start 必须先于 end 入队。
- 429/5xx 指数退避加 jitter；协议 4xx 进入 onDroppedEvent，不无限重试。
- Buffer 满策略显式配置为 dropOldest、dropNewest 或 block，默认 dropOldest 并累计 droppedCount。
- flush 等待当前批次完成；shutdown 停止接收、自动关闭未结束 Span、flush 并返回结果。
- Browser 在 pagehide/visibilitychange 时使用 sendBeacon 或 keepalive 尽力发送尾批次。
- 采样在根 Trace 创建时决定并向子 Span 传播，不允许每个 Span 独立采样。
- 评测样本、人工反馈和错误 Trace 可以强制保留。

## 6. SDK 与 Hook 技术方案

### 6.1 Hook 应留在哪些位置

| Hook 点 | 应放置的位置 | 必须记录 |
|---|---|---|
| agent.start/end/error | Agent 对外 run/invoke/chat 的最外层边界 | 输入、输出、Agent 版本、Session、最终状态 |
| llm.start/end/error | 每次真正调用模型 Provider 的适配层 | messages/prompt、模型、参数、usage、TTFT、finish reason |
| tool.start/end/error | Tool Registry 或工具调用包装器 | toolName、callId、参数、结果、错误、重试次数 |
| retrieval.start/end/error | Retriever/Search/Vector Store 适配层 | query、topK、文档 ID、分数、引用 |
| decision | 路由、规划、条件分支作出选择之后 | 候选项、选择结果、理由、规则/模型版本 |
| handoff.start/end | 多 Agent 转交边界 | sourceAgent、targetAgent、交接内容、Link |
| guardrail.checked | 输入/输出安全校验之后 | 规则、结果、拦截原因 |
| sample.completed | 一条评测样本的 Agent 执行完成处 | runId、runItemId、rawOutput、traceId、usage |
| feedback.created | 用户或人工审核提交处 | rating、label、comment、关联 traceId |

Hook 必须放在“真正发生动作的边界”，而不是仅放在页面请求入口。比如 LLM Hook 应在 Provider Adapter 包装真实 API 调用，Tool Hook 应在工具执行器，而不是仅根据最终文本猜测发生过工具调用。

### 6.2 平台无关 Hook 契约

~~~ts
interface AgentHook {
  onEvent(event: AgentHookEvent): void | Promise<void>;
}

interface HookContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId?: string;
  experimentId?: string;
  runId?: string;
  runItemId?: string;
  datasetItemId?: string;
  agentName: string;
  agentVersion?: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

type AgentHookEvent =
  | AgentStartEvent
  | AgentEndEvent
  | AgentErrorEvent
  | LlmStartEvent
  | LlmEndEvent
  | LlmErrorEvent
  | ToolStartEvent
  | ToolEndEvent
  | ToolErrorEvent
  | RetrievalStartEvent
  | RetrievalEndEvent
  | RetrievalErrorEvent
  | DecisionEvent
  | HandoffEvent
  | GuardrailEvent
  | FeedbackEvent
  | SampleCompletedEvent;
~~~

实现约束：

- Hook 默认 fail-open，上报失败不得中断 Agent 主流程。
- 支持 CompositeHook，同时发送 AgentMonitor、业务日志和审计系统。
- start 返回 Handle；end 只能使用原 Handle，不得重新生成 ID。
- Handle.end 幂等，第二次调用返回同一结果或记录 SDK 警告。
- Hook 允许显式传 Context，不能只依赖“全局当前 Span”。
- 测试环境可设置 hookErrorMode=throw，生产默认 ignore/log。

### 6.3 TypeScript API

~~~ts
const monitor = AgentMonitor.init({
  apiKey: process.env.AGENTMONITOR_TOKEN!,
  baseUrl: 'https://monitor.example.com',
  serviceName: 'order-agent',
  serviceVersion: '1.4.0',
  environment: 'staging'
});

const result = await monitor.withTrace(
  {
    name: 'refundAgent.run',
    kind: 'agent',
    sessionId,
    input,
    attributes: {
      'evaluation.run_id': runId,
      'evaluation.run_item_id': runItemId
    }
  },
  async (trace) => {
    return trace.withSpan(
      { name: 'queryOrder', kind: 'tool', input: { orderId: input.orderId } },
      () => queryOrder(input.orderId)
    );
  }
);

await monitor.shutdown({ timeoutMs: 5000 });
~~~

Node 使用 AsyncLocalStorage。浏览器包不得依赖 Node 模块，应拆为 core、node、web 入口并提供 withContext。fetch/http 插件负责 traceparent 注入和提取。

### 6.4 Python API

~~~python
async with monitor.trace(
    "refundAgent.run",
    kind="agent",
    input=input_data,
    session_id=session_id,
) as trace:
    async with trace.span(
        "queryOrder",
        kind="tool",
        input={"orderId": input_data["orderId"]},
    ) as span:
        order = await query_order(input_data["orderId"])
        span.set_output(order)

await monitor.shutdown()
~~~

Python 使用 ContextVar 隔离 asyncio Task，同时支持同步/异步 Context Manager 和 Decorator。所有框架 Callback 经过 SDK Core 的 camelCase 序列化，不得直接 append Buffer；异步版本不得在事件循环中调用阻塞 requests。

### 6.5 Go API

~~~go
ctx, trace := monitor.StartTrace(ctx, agentmonitor.TraceOptions{
    Name:      "refundAgent.run",
    Kind:      agentmonitor.KindAgent,
    SessionID: sessionID,
    Input:     input,
})
defer trace.EndFromError(&err)

ctx, span := monitor.StartSpan(ctx, agentmonitor.SpanOptions{
    Name:  "queryOrder",
    Kind:  agentmonitor.KindTool,
    Input: map[string]any{"orderId": input.OrderID},
})
order, err := queryOrder(ctx, input.OrderID)
span.End(agentmonitor.EndOptions{Output: order, Error: err})
~~~

context.Context 是唯一隐式传播源；StartSpan 必须返回派生后的 ctx。使用私有 typed key，配置可选布尔值使用 Option Pattern，Shutdown(ctx) 返回 flush 错误。Eino、HTTP、gRPC 适配器只能调用公开 Start/End API。

### 6.6 框架适配器顺序

P0：

- TypeScript：OpenAI Chat Completions、Responses、Streaming、LangChain.js/LangGraph、fetch、Express/Fastify/Next.js。
- Python：OpenAI 同步/异步/流式、LangChain/LangGraph、FastAPI/Starlette、httpx/aiohttp。
- Go：Eino、net/http、OpenAI Go、gRPC Unary/Stream Interceptor。

P1：Anthropic、Vercel AI SDK、LlamaIndex、CrewAI、AutoGen、MCP Client、Gin/Hertz/Fiber。

每个适配器必须测试正常、异常、超时、取消、重试、流式 TTFT、Tool Call、父子 Span、并行分支和重复注册。

### 6.7 跨语言 Contract Test

仓库新增：

~~~text
telemetry-schema/
  event.schema.json
  fixtures/
    trace-start.json
    nested-spans.json
    span-end-before-start.json
    llm-stream.json
    error.json
    sample-completed.json
~~~

TypeScript、Python、Go 都必须生成事件、通过同一 JSON Schema、与 Golden Fixture 比较、发给同一个 Contract Test Server，并验证最终 Trace Tree 一致。

## 7. 首次接入与埋点诊断

### 7.1 Onboarding 五步向导

新增 /onboarding，状态保存到服务端或 localStorage，并以 projectId 为隔离键：

1. 创建或选择项目：名称、环境、Agent 类型、使用目标。
2. 创建凭据：区分 Ingestion Token 与 Runner/CI Token。
3. 选择语言与框架：生成当前项目可执行的初始化和 Hook 示例。
4. 发送测试事件：等待根 Trace、LLM Span、Tool/Retrieval Span。
5. 展示诊断结果：打开示例 Trace、创建 Target、从 Trace 建数据集、运行首个评测。

向导不能只判断“收到一条 Trace”，必须判断其结构是否足以支持 Agent 调试和轨迹评测。

### 7.2 Integration Status API

~~~http
GET /api/v2/projects/:projectId/integration-status
~~~

~~~json
{
  "connected": true,
  "lastEventAt": "2026-08-23T10:00:00Z",
  "traceCount": 3,
  "detectedSdk": {
    "language": "typescript",
    "version": "2.0.0",
    "frameworks": ["langgraph"]
  },
  "hooks": {
    "agent": true,
    "llm": true,
    "tool": false,
    "retrieval": false,
    "decision": false
  },
  "fieldCompleteness": {
    "parentSpanId": 0.92,
    "tokenUsage": 0.68,
    "promptVersion": 0.40,
    "agentVersion": 1.0
  },
  "warnings": [
    {
      "code": "MISSING_TOOL_SPAN",
      "message": "检测到工具调用结果，但没有 Tool Span",
      "documentationUrl": "/docs/hooks/tool"
    }
  ],
  "sampleTraceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
~~~

状态计算基于最近一段时间的 Span Kind 和字段覆盖率，不依赖 SDK 主动声称“已安装 Hook”。前端消费 WebSocket 新 Trace 事件，并以该接口轮询兜底。

验收标准：新用户不读源码，10 分钟内可创建凭据、运行示例、看到 Trace，并能区分后端不可达、凭据错误、已连接但 Hook 不完整三类问题。

## 8. Agent Target 统一被测对象

### 8.1 Target 类型

| 类型 | 用途 | 谁执行 Agent | 典型场景 |
|---|---|---|---|
| prompt_model | 平台托管 Prompt + 模型调用 | AgentMonitor Worker | Prompt 开发、模型对比 |
| http_agent | 调用开发者已部署的 Agent HTTP API | AgentMonitor Worker | 测试/公网环境 Agent |
| external_runner | Runner 在本地或内网拉取样本 | 开发者 Runner | 私网工具、复杂工作流、本地分支 |
| trace_replay | 不重新执行 Agent，直接评分历史 Trace | AgentMonitor Worker | 线上 Trace 抽样评测 |

Playground 和 Experiment 必须使用同一个 Target Adapter Registry，禁止各自实现一套调用逻辑。

### 8.2 Target 与不可变版本

~~~ts
interface AgentTarget {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  type: 'prompt_model' | 'http_agent' | 'external_runner' | 'trace_replay';
  currentVersionId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AgentTargetVersion {
  id: string;
  targetId: string;
  versionNumber: number;
  targetType: AgentTarget['type'];
  invocationConfig: Record<string, unknown>;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  sourceRevision?: {
    agentVersion?: string;
    gitCommit?: string;
    gitBranch?: string;
    image?: string;
    framework?: string;
  };
  createdAt: string;
}
~~~

每次修改连接方式、PromptVersion、ModelConfig、映射或代码版本都创建新 TargetVersion。Experiment 只引用 targetVersionId，不引用可变 Target 主表。

### 8.3 HTTP Agent 配置

~~~json
{
  "method": "POST",
  "url": "https://agent.example.com/v1/eval/invoke",
  "authentication": {
    "type": "bearer",
    "secretRef": "secret_target_123"
  },
  "headers": {
    "X-Agent-Eval": "AgentMonitor"
  },
  "timeoutMs": 60000,
  "asyncMode": false,
  "requestTemplate": {
    "input": "{{sample.input}}",
    "expected": "{{sample.expected}}",
    "metadata": "{{sample.metadata}}",
    "runId": "{{run.id}}",
    "runItemId": "{{runItem.id}}"
  },
  "outputPath": "/output",
  "traceIdPath": "/traceId",
  "usagePath": "/metrics/tokenUsage"
}
~~~

模板只支持白名单变量和 JSON Pointer，不执行 JavaScript eval。Authorization 等敏感 Header 只保存 secretRef，读取接口不返回明文。

### 8.4 HTTP Agent 标准调用协议

平台请求：

~~~http
POST /v1/eval/invoke
Authorization: Bearer <configured-target-secret>
Content-Type: application/json
X-AgentMonitor-Run-Id: run_123
X-AgentMonitor-Run-Item-Id: ri_123
X-AgentMonitor-Request-Id: req_123
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
~~~

~~~json
{
  "protocolVersion": "1.0",
  "requestId": "req_123",
  "run": {
    "id": "run_123",
    "experimentId": "exp_123"
  },
  "sample": {
    "id": "dvi_123",
    "caseKey": "refund-order-001",
    "input": {
      "messages": [
        { "role": "user", "content": "帮我申请订单 123 的退款" }
      ],
      "variables": { "orderId": "123" }
    },
    "expected": {
      "answerContains": ["退款", "提交"],
      "expectedTools": ["get_order", "create_refund"]
    },
    "metadata": { "category": "refund" }
  },
  "context": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "sessionId": "eval_run_123_refund-order-001",
    "timeoutMs": 60000
  }
}
~~~

成功响应：

~~~json
{
  "protocolVersion": "1.0",
  "requestId": "req_123",
  "status": "success",
  "output": { "answer": "退款申请已经提交" },
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "sessionId": "session_456",
  "artifacts": {
    "toolCalls": [
      { "name": "get_order", "arguments": { "orderId": "123" } },
      { "name": "create_refund", "arguments": { "orderId": "123" } }
    ]
  },
  "metrics": {
    "latencyMs": 1830,
    "tokenUsage": {
      "inputTokens": 380,
      "outputTokens": 92,
      "totalTokens": 472
    }
  },
  "metadata": { "agentVersion": "1.4.0" }
}
~~~

失败响应：

~~~json
{
  "protocolVersion": "1.0",
  "requestId": "req_123",
  "status": "error",
  "error": {
    "code": "TOOL_EXECUTION_FAILED",
    "message": "refund service unavailable",
    "retryable": true
  }
}
~~~

如果 Agent 返回 202，平台提供一次性 callback URL/token；requestId + executionId 保证回调幂等。P0 可以先完成同步 HTTP 和 external_runner，异步 callback 放 P1。

### 8.5 Target 验证

~~~http
POST /api/v2/evaluation/targets/:targetId/verify
POST /api/v2/evaluation/target-versions/:versionId/test-invoke
~~~

验证结果必须同时展示：连通性、协议版本、请求映射、原始响应、标准化响应、output 是否命中、traceId 是否命中、真实耗时和错误详情。只有验证成功的版本才能在新 Experiment 中默认选择；允许管理员显式强制使用，但 UI 必须显示警告。

### 8.6 External Runner

本地或内网 Agent 采用“平台分配任务、Runner 执行、平台评分”的模式：

~~~text
CLI 使用 Service Token 创建/加入 EvalRun
  → claim RunItem + leaseToken
  → 本地调用 Agent
  → heartbeat 续租
  → 上传 rawOutput/traceId/usage
  → 服务端执行 Evaluator Suite
  → Runner 继续 claim
~~~

Runner API：

~~~http
POST /api/v2/evaluation/runner-sessions
POST /api/v2/evaluation/runs/:runId/items/claim
POST /api/v2/evaluation/run-items/:runItemId/heartbeat
POST /api/v2/evaluation/run-items/:runItemId/target-result
POST /api/v2/evaluation/run-items/:runItemId/fail
POST /api/v2/evaluation/runner-sessions/:sessionId/close
~~~

Claim 响应：

~~~json
{
  "items": [
    {
      "runItemId": "ri_123",
      "leaseToken": "lease_123",
      "leaseExpiresAt": "2026-08-23T10:01:30Z",
      "sample": {
        "caseKey": "refund-order-001",
        "input": {},
        "expected": {},
        "metadata": {}
      },
      "traceContext": {
        "traceparent": "00-..."
      }
    }
  ]
}
~~~

上传结果必须携带 leaseToken 和 idempotencyKey。租约过期后项目可重新分配；旧 Runner 的迟到提交返回 LEASE_EXPIRED，不覆盖新执行结果。

CLI 可以通过 STDIO NDJSON 调用用户适配器。stdout 只允许协议 JSON，业务日志写 stderr：

~~~json
{"type":"invoke","requestId":"req_1","sample":{"caseKey":"case_1","input":{"query":"你好"}},"context":{"traceId":"..."}}
{"type":"result","requestId":"req_1","status":"success","output":{"answer":"你好"},"traceId":"..."}
~~~

## 9. 评测领域模型与数据库

### 9.1 最终领域模型

~~~text
AgentTarget 1 ── N AgentTargetVersion
Dataset 1 ── N DatasetVersion 1 ── N DatasetVersionItem
Evaluator 1 ── N EvaluatorVersion
EvaluatorSuite 1 ── N EvaluatorSuiteVersion 1 ── N SuiteMember

Experiment
  ├── datasetVersionId
  ├── targetVersionId
  └── evaluatorSuiteVersionId

Experiment 1 ── N EvalRun
EvalRun 1 ── N EvalRunItem
EvalRunItem 1 ── N EvalScore
EvalRunItem 0..1 ── 1 TraceRun
~~~

### 9.2 新增和调整的核心表

#### agent_targets

| 列 | 说明 |
|---|---|
| id | 内部主键 |
| project_id | 项目隔离 |
| name / description | 展示信息 |
| target_type | prompt_model/http_agent/external_runner/trace_replay |
| current_version_id | 默认版本指针，不供历史 Experiment 跟随 |
| enabled | 是否允许新建 Run |
| created_by/created_at/updated_at | 审计字段 |

约束：UNIQUE(project_id, name)。

#### agent_target_versions

| 列 | 说明 |
|---|---|
| id / target_id / version_number | 版本身份 |
| target_type | 版本创建时的类型快照 |
| invocation_config | URL、PromptVersion、ModelConfig、Runner 协议等 |
| input_mapping/output_mapping | JSON Pointer 映射 |
| source_revision | agentVersion、gitCommit、image、framework |
| created_by/created_at | 不可变审计字段 |

约束：UNIQUE(target_id, version_number)。版本行创建后禁止 UPDATE，只允许新版本。

#### dataset_version_items

| 列 | 说明 |
|---|---|
| id / dataset_version_id | 快照身份 |
| dataset_item_id | 可选指向工作副本原始项 |
| case_key | 版本间稳定的业务键 |
| input_data / expected_data / context_data | 结构化样本 |
| fields / metadata / tags | 扩展字段 |
| content_hash | 去重和变更识别 |
| ordinal | 稳定顺序 |

约束：UNIQUE(dataset_version_id, case_key)。DatasetVersion 提交后所有快照行不可修改。

#### evaluator_suites / evaluator_suite_versions / evaluator_suite_members

Suite 主表保存名称；SuiteVersion 保存 aggregation_config；Member 保存 evaluator_version_id、alias、weight、required、pass_threshold、ordinal。约束 UNIQUE(suite_version_id, alias)。

#### evaluation_experiments

最终字段：

~~~text
id, project_id, name, description
dataset_version_id
target_version_id
evaluator_suite_version_id
default_run_config
default_gate_config
lifecycle_status
created_by, created_at, updated_at
~~~

Experiment 不再保存 running/completed、startedAt、summary 或某次输出。

#### evaluation_runs

~~~text
id, project_id, experiment_id, run_number
trigger_type, trigger_ref
baseline_run_id, retry_of_run_id
status, status_reason
requested_by, idempotency_key
source_revision, config_snapshot, gate_snapshot
summary, gate_result
queued_at, started_at, completed_at, cancel_requested_at
created_at, updated_at
~~~

约束：UNIQUE(experiment_id, run_number)、UNIQUE(project_id, idempotency_key)。

#### evaluation_run_items

~~~text
id, run_id, dataset_version_item_id, case_key
status, phase, attempt_count
lease_owner, lease_token_hash, lease_expires_at
input_snapshot, expected_snapshot
target_output, target_error
trace_id, session_id
latency_ms, token_usage, cost
started_at, completed_at, created_at, updated_at
~~~

约束：UNIQUE(run_id, dataset_version_item_id)。索引至少覆盖 status+lease_expires_at、run_id+status、trace_id。

#### evaluation_scores

~~~text
id, run_item_id, evaluator_version_id, evaluator_alias
status, score, passed, label, reasoning
details, error, raw_output
latency_ms, token_usage
created_at, completed_at
~~~

约束：UNIQUE(run_item_id, evaluator_version_id)。同一评估器内部重试只能更新同一 Score 或保存到 attempt 子表，不能增加重复最终分数。

#### evaluation_run_events

持久化 status_changed、progress、target_completed、evaluator_completed、item_completed、run_completed、run_failed 等事件。约束 UNIQUE(run_id, sequence)，用于页面刷新后回放、WebSocket 乱序保护和执行日志。

#### 其他新增表

- trace_runs：一条 Trace 一行，UNIQUE(project_id, trace_id)。
- telemetry_event_receipts：eventId 幂等收据。
- prompt_deployments：project + prompt + environment → promptVersionId。
- service_tokens：项目级自动化凭据与 scopes。
- runner_sessions：Runner 在线状态和能力。
- auto_eval_sources：taskId + sourceType + sourceId 唯一，防止同一 Trace 重复抽样。

### 9.3 Dataset 样本标准

~~~json
{
  "caseKey": "refund-order-001",
  "input": {
    "messages": [
      { "role": "user", "content": "帮我申请订单 123 的退款" }
    ],
    "variables": { "orderId": "123" }
  },
  "expected": {
    "answerContains": ["退款", "提交"],
    "expectedTools": [
      { "name": "get_order", "arguments": { "orderId": "123" } },
      { "name": "create_refund" }
    ]
  },
  "context": {
    "locale": "zh-CN"
  },
  "metadata": {
    "category": "refund",
    "priority": "P0",
    "tags": ["order", "tool-call"]
  },
  "source": {
    "type": "trace",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
  }
}
~~~

P0 兼容现有字符串 input/expected；读取层将字符串包装为 JSON scalar。P1 的导入向导支持 JSONL、JSON、CSV，必须先预览字段映射、空输入、重复 caseKey、非法 JSON 和预计成功/跳过/失败数量，再提交版本。

## 10. Evaluator 与 Evaluator Suite

### 10.1 统一评估器接口

~~~ts
interface EvaluationContext {
  sample: {
    input: unknown;
    expected?: unknown;
    context?: unknown;
    metadata?: Record<string, unknown>;
  };
  target: {
    output?: unknown;
    error?: StructuredError;
    traceId?: string;
    latencyMs?: number;
    tokenUsage?: TokenUsage;
  };
  trace?: TraceTree;
}

interface EvaluatorResult {
  status: 'completed' | 'failed';
  score?: number;                 // 统一到 0..1
  passed?: boolean;
  label?: string;
  reasoning?: string;
  dimensions?: Record<string, number>;
  details?: Record<string, unknown>;
  error?: StructuredError;
}

interface EvaluatorAdapter {
  evaluate(context: EvaluationContext, config: unknown): Promise<EvaluatorResult>;
}
~~~

### 10.2 评估器类型

P0：exact_match、contains、regex、json_schema、token_overlap、llm_judge、latency_threshold、token_cost_threshold。

P1：embedding_similarity、tool_trajectory、rag_groundedness、trajectory_llm_judge、http_custom、human_review。

当前“similarity”如果只是词重叠，应明确命名为 token_overlap，不能暗示语义向量相似度。LLM Judge 必须锁定 modelConfigId 和 Prompt/规则版本；Judge 调用失败返回 evaluator failed，禁止静默回退启发式评分。

### 10.3 Suite 配置

~~~json
{
  "aggregation": {
    "method": "weightedAverage",
    "itemPassThreshold": 0.75,
    "requiredEvaluatorPolicy": "allPass",
    "evaluatorErrorPolicy": "failItem"
  },
  "members": [
    {
      "evaluatorVersionId": "eval_accuracy_v3",
      "alias": "accuracy",
      "weight": 0.5,
      "required": true,
      "passThreshold": 0.8
    },
    {
      "evaluatorVersionId": "eval_safety_v2",
      "alias": "safety",
      "weight": 0.3,
      "required": true,
      "passThreshold": 1.0
    },
    {
      "evaluatorVersionId": "eval_tool_v1",
      "alias": "toolTrajectory",
      "weight": 0.2,
      "required": false,
      "passThreshold": 0.7
    }
  ]
}
~~~

### 10.4 聚合规则

对于成功完成的评估器：

~~~text
itemScore = Σ(weight_i × score_i) / Σ(weight_i)

itemPassed =
  itemScore >= itemPassThreshold
  AND 每个 required evaluator 均 passed
~~~

评估器错误策略可配置：failItem、exclude、zeroScore、stopRun。默认 failItem，但报告必须把“Agent 质量不通过”和“评估器基础设施错误”分开计数。

Run 汇总至少包括：总数、完成数、质量通过/失败、Target 错误、Evaluator 错误、平均/中位分、各评估器通过率、P50/P95 延迟、Token/成本、失败原因分布。

### 10.5 Gate 与基线

基线比较按 caseKey 对齐，分类为 regressed、improved、unchanged、added、removed。Gate 示例：

~~~json
{
  "conditions": [
    { "metric": "passRate", "operator": ">=", "value": 0.90 },
    { "metric": "passRateDelta", "operator": ">=", "value": -0.01 },
    { "metric": "evaluator.safety.passRate", "operator": "=", "value": 1.0 },
    { "metric": "executionErrorRate", "operator": "<=", "value": 0.02 }
  ]
}
~~~

人工校准后的报告使用 calibrated 值优先，但必须同时保留自动分数、校准人、原因和时间。Bad Case 查询不能只依据原始 passed 字段。

## 11. 异步评测执行引擎

### 11.1 Run 状态机

~~~text
created
   ↓ start
queued
   ↓ worker prepare
preparing
   ↓
running ─────────────→ cancellation_requested
   ↓                            ↓
aggregating                  cancelled
   ↓
completed

queued / preparing / running / aggregating
   └────────────────────────→ failed
~~~

允许操作：

| 状态 | 操作 |
|---|---|
| created | start、delete |
| queued/preparing | cancel |
| running | cancel、查看进度 |
| failed/cancelled/completed | clone、compare、创建 retry Run |

已完成 Run 不得改回 running。用户点击“重试失败项”时创建一个新 Run，设置 retryOfRunId，并只复制 target_failed/evaluation_failed/error 的样本；Worker 内部的瞬时自动重试仍属于原 RunItem 的 attempt。

### 11.2 RunItem 状态机

~~~text
queued
  ↓ claim
target_running
  ├── target_failed
  ↓
target_completed
  ↓
evaluating
  ├── evaluation_failed
  ↓
completed

任意未结束状态 → cancelled
~~~

phase 单独保存 target/evaluation/aggregation，使 Worker 崩溃后可以从已完成阶段恢复。例如 Target 已成功但 Evaluator 进程退出，恢复时不能重复调用 Agent，只补做 Score。

### 11.3 Start、Cancel 与 Retry API

~~~http
POST /api/v2/evaluation/experiments/:experimentId/runs
Idempotency-Key: ci-build-382
~~~

~~~json
{
  "triggerType": "ci",
  "baselineRunId": "run_previous",
  "sourceRevision": {
    "gitCommit": "63cd9ba",
    "gitBranch": "pull/82"
  },
  "overrides": {
    "sample": { "mode": "tags", "tags": ["smoke"] },
    "targetConcurrency": 4
  }
}
~~~

返回：

~~~http
HTTP/1.1 202 Accepted
Location: /api/v2/evaluation/runs/run_123
~~~

~~~json
{
  "runId": "run_123",
  "status": "queued"
}
~~~

取消只写 cancelRequestedAt。Worker 在 claim 前、Target 调用后、每个 Evaluator 前检查取消标记；已经发出的远程 HTTP 调用尽力 Abort，但无法撤回时其迟到结果不能覆盖 cancelled 终态。

### 11.4 数据库队列

P0 先实现 EvaluationQueue 接口和数据库版本，不强制引入 Redis/BullMQ：

~~~ts
interface EvaluationQueue {
  enqueueRun(runId: string): Promise<void>;
  claimItem(workerId: string, leaseSeconds: number): Promise<ClaimedRunItem | null>;
  heartbeat(runItemId: string, leaseToken: string): Promise<void>;
  completeTarget(runItemId: string, result: TargetResult): Promise<void>;
  completeScore(runItemId: string, evaluatorVersionId: string, result: EvaluatorResult): Promise<void>;
  failPhase(runItemId: string, phase: string, error: StructuredError): Promise<void>;
  requeueExpiredLeases(now: Date): Promise<number>;
}
~~~

PostgreSQL claim 使用 FOR UPDATE SKIP LOCKED；SQLite 使用单条带 status 条件的 UPDATE 和短事务。SQLite 模式默认单 Worker，避免写锁竞争；这不改变领域接口，后续可以替换 Redis/PG Queue。

Worker 行为：

1. 原子 claim 一条 queued RunItem，写 leaseOwner、leaseTokenHash、leaseExpiresAt。
2. 调用 Target Adapter，按 targetTimeoutMs、targetRetries 和 retryable 执行。
3. 原子保存 rawOutput、traceId、usage、latency，并将 phase 切到 evaluation。
4. 按 SuiteMember 顺序或配置的并发执行 Evaluator，逐条 Upsert Score。
5. 聚合 Item；最后一条完成时通过原子检查触发 Run aggregation。
6. 持久化 RunEvent，再广播 WebSocket/SSE。
7. 定时扫描过期租约，仅重新排队非终态 Item。

### 11.5 进度事件

~~~json
{
  "type": "evaluation.run.progress",
  "projectId": "project_123",
  "runId": "run_123",
  "sequence": 18,
  "timestamp": "2026-08-23T10:00:00Z",
  "data": {
    "status": "running",
    "completed": 18,
    "total": 100,
    "passed": 12,
    "failed": 4,
    "targetErrors": 1,
    "evaluatorErrors": 1,
    "currentCaseKey": "refund-order-018"
  }
}
~~~

WebSocket 只负责实时推送，不是真相来源。页面用 sequence 拒绝乱序消息，断线或刷新后从 GET /runs/:id 和 GET /runs/:id/events?afterSequence= 补全。

### 11.6 Trace 等待策略

轨迹评估器依赖 SDK 上报的 Span，Target HTTP 响应可能早于 Telemetry 入库。RunConfig 增加：

~~~json
{
  "tracePolicy": {
    "required": true,
    "waitTimeoutMs": 10000,
    "pollIntervalMs": 500,
    "onMissing": "failEvaluator"
  }
}
~~~

只评文本的 Suite 不等待 Trace；包含 required tool_trajectory 的 Suite 在超时后产生明确 TRACE_NOT_AVAILABLE evaluator error，不能自动用 HTTP response artifacts 冒充完整轨迹。

## 12. 完整 REST API 设计

所有 V2 API：

- 使用 camelCase JSON。
- 项目由用户当前上下文或 Service Token 推断；body 中即使携带 projectId 也必须校验资源归属。
- 错误统一为 error.code、error.message、error.details、requestId。
- 创建 Run、上传 Target Result、Telemetry Event 支持幂等。

### 12.1 Telemetry 与接入

~~~text
POST /api/v2/telemetry/batch
GET  /api/v2/projects/:projectId/integration-status
GET  /api/v2/traces/:traceId
GET  /api/v2/traces/:traceId/spans
POST /api/v2/traces/:traceId/dataset-items
POST /api/v2/traces/:traceId/quick-evaluation
~~~

### 12.2 Target

~~~text
POST   /api/v2/evaluation/targets
GET    /api/v2/evaluation/targets
GET    /api/v2/evaluation/targets/:targetId
PATCH  /api/v2/evaluation/targets/:targetId
DELETE /api/v2/evaluation/targets/:targetId
POST   /api/v2/evaluation/targets/:targetId/versions
GET    /api/v2/evaluation/targets/:targetId/versions
GET    /api/v2/evaluation/target-versions/:versionId
POST   /api/v2/evaluation/target-versions/:versionId/verify
POST   /api/v2/evaluation/target-versions/:versionId/test-invoke
~~~

### 12.3 Dataset

~~~text
POST   /api/v2/evaluation/datasets
GET    /api/v2/evaluation/datasets
GET    /api/v2/evaluation/datasets/:datasetId
PATCH  /api/v2/evaluation/datasets/:datasetId
DELETE /api/v2/evaluation/datasets/:datasetId
POST   /api/v2/evaluation/datasets/:datasetId/items:batch
PATCH  /api/v2/evaluation/datasets/:datasetId/items/:itemId
DELETE /api/v2/evaluation/datasets/:datasetId/items/:itemId
POST   /api/v2/evaluation/datasets/:datasetId/import:preview
POST   /api/v2/evaluation/datasets/:datasetId/import:commit
GET    /api/v2/evaluation/datasets/:datasetId/export
POST   /api/v2/evaluation/datasets/:datasetId/versions
GET    /api/v2/evaluation/datasets/:datasetId/versions
GET    /api/v2/evaluation/dataset-versions/:versionId/items
~~~

### 12.4 Evaluator 与 Suite

~~~text
POST   /api/v2/evaluation/evaluators
GET    /api/v2/evaluation/evaluators
GET    /api/v2/evaluation/evaluators/:evaluatorId
PATCH  /api/v2/evaluation/evaluators/:evaluatorId
DELETE /api/v2/evaluation/evaluators/:evaluatorId
POST   /api/v2/evaluation/evaluators/:evaluatorId/versions
GET    /api/v2/evaluation/evaluators/:evaluatorId/versions
POST   /api/v2/evaluation/evaluator-versions/:versionId/test
GET    /api/v2/evaluation/evaluator-templates

POST   /api/v2/evaluation/suites
GET    /api/v2/evaluation/suites
GET    /api/v2/evaluation/suites/:suiteId
PATCH  /api/v2/evaluation/suites/:suiteId
DELETE /api/v2/evaluation/suites/:suiteId
POST   /api/v2/evaluation/suites/:suiteId/versions
GET    /api/v2/evaluation/suites/:suiteId/versions
POST   /api/v2/evaluation/suite-versions/:versionId/test
~~~

### 12.5 Experiment 与 Run

~~~text
POST   /api/v2/evaluation/experiments
GET    /api/v2/evaluation/experiments
GET    /api/v2/evaluation/experiments/:experimentId
PATCH  /api/v2/evaluation/experiments/:experimentId
DELETE /api/v2/evaluation/experiments/:experimentId
POST   /api/v2/evaluation/experiments/:experimentId/validate
POST   /api/v2/evaluation/experiments/:experimentId/runs
GET    /api/v2/evaluation/experiments/:experimentId/runs

GET    /api/v2/evaluation/runs/:runId
POST   /api/v2/evaluation/runs/:runId/cancel
POST   /api/v2/evaluation/runs/:runId/retry
POST   /api/v2/evaluation/runs/:runId/clone
GET    /api/v2/evaluation/runs/:runId/progress
GET    /api/v2/evaluation/runs/:runId/events
GET    /api/v2/evaluation/runs/:runId/items
GET    /api/v2/evaluation/run-items/:runItemId
POST   /api/v2/evaluation/run-items/:runItemId/rerun
GET    /api/v2/evaluation/runs/:runId/report
GET    /api/v2/evaluation/runs/:runId/bad-cases
GET    /api/v2/evaluation/runs/:runId/export
POST   /api/v2/evaluation/runs:compare
~~~

Experiment validate 必须检查：DatasetVersion 非空、TargetVersion 完整且归属同项目、Suite 至少一个 Member、Judge 模型可用、输入映射能解析样本、required 轨迹评估器的 Telemetry 策略可满足。

RunItem 列表支持 status、passed、caseKey、tag、evaluatorAlias、scoreMin、scoreMax、errorCode、cursor、limit。

### 12.6 Runner、Prompt Runtime 与 Token

~~~text
POST /api/v2/evaluation/runner-sessions
POST /api/v2/evaluation/runs/:runId/items/claim
POST /api/v2/evaluation/run-items/:runItemId/heartbeat
POST /api/v2/evaluation/run-items/:runItemId/target-result
POST /api/v2/evaluation/run-items/:runItemId/fail

GET  /api/v2/runtime/prompts/:key
POST /api/v2/runtime/prompts/:key/render

POST   /api/v2/service-tokens
GET    /api/v2/service-tokens
DELETE /api/v2/service-tokens/:tokenId
~~~

### 12.7 标准错误码

| 类别 | 错误码示例 |
|---|---|
| 鉴权 | INVALID_TOKEN、INSUFFICIENT_SCOPE、PROJECT_MISMATCH |
| 配置 | INVALID_MAPPING、TARGET_NOT_VERIFIED、EMPTY_DATASET_VERSION、EVALUATOR_MODEL_MISSING |
| 运行 | INVALID_STATE_TRANSITION、RUN_CANCELLED、LEASE_EXPIRED、LEASE_TOKEN_INVALID |
| Target | TARGET_TIMEOUT、TARGET_PROTOCOL_ERROR、TARGET_OUTPUT_NOT_FOUND、TARGET_UNAVAILABLE |
| Evaluator | EVALUATOR_TIMEOUT、EVALUATOR_INVALID_OUTPUT、TRACE_NOT_AVAILABLE、JUDGE_MODEL_ERROR |
| Telemetry | INVALID_TRACE_ID、INVALID_SPAN_ID、INVALID_PARENT、PAYLOAD_TOO_LARGE、UNSUPPORTED_SCHEMA_VERSION |

## 13. Prompt Runtime、Playground 与模型 Provider

### 13.1 Prompt 生命周期

PromptVersion 创建后不可修改，生命周期建议为：

~~~text
draft → evaluated → approved → active → archived
~~~

prompt_deployments 保存 projectId + promptId + environment 到 promptVersionId 的映射。发布只移动 deployment 指针，不覆盖版本内容。

Runtime API：

~~~http
GET /api/v2/runtime/prompts/refund-agent?environment=production
If-None-Match: "prompt-version-etag"
~~~

返回 content、variablesSchema、modelDefaults、promptId、promptVersionId、etag。SDK 支持 ETag Cache 和明确的 cache TTL，并在 LLM Span 自动写 prompt.id/prompt.version_id。

### 13.2 Prompt Target 必须精确执行版本

prompt_model TargetVersion 同时锁定 promptVersionId 和 modelConfigId。Target Adapter 的执行顺序：

1. 按 promptVersionId 查询不可变内容，而不是读取 prompt.currentVersionId。
2. 校验变量 Schema，渲染 Prompt。
3. 按 modelConfigId 选择 Provider Adapter。
4. 调用真实模型，记录 LLM Span。
5. 返回 output、usage、latency、traceId 和所有版本 ID。

这直接修复当前 promptVersionId 传入但未被使用的问题。

### 13.3 真实 Playground

Playground 不再直接面向 modelConfig，而是面向 targetVersionId：

~~~http
POST /api/v2/playground/invoke
POST /api/v2/playground/compare
~~~

~~~json
{
  "targetVersionId": "target_v12",
  "input": { "query": "查询订单并退款" },
  "metadata": { "source": "playground" }
}
~~~

~~~json
{
  "runId": "play_123",
  "output": { "answer": "退款已提交" },
  "latencyMs": 1300,
  "tokenUsage": { "inputTokens": 300, "outputTokens": 60 },
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "targetVersionId": "target_v12"
}
~~~

compare 接收两个及以上 targetVersionId，并行执行后返回独立成功/失败项；一个 Target 失败不能把其他结果伪装为整体成功。前端必须删除当前模拟输出和本地循环拼装结果。

Playground 结果可执行：保存为 DatasetItem、设为 expected、打开 Trace、应用一个 EvaluatorVersion、生成 PromptVersion、保存为对比 Run。

### 13.4 Provider Adapter

~~~ts
interface ModelProviderAdapter {
  provider: string;
  validateConfig(config: ModelConfig): ValidationResult;
  invoke(request: ModelRequest, config: ModelConfig): Promise<ModelResponse>;
  stream?(request: ModelRequest, config: ModelConfig): AsyncIterable<ModelChunk>;
  listModels?(config: ModelConfig): Promise<ModelDescriptor[]>;
}
~~~

至少分开：OpenAICompatibleAdapter、AnthropicAdapter。UI Provider Registry 由后端 capabilities 接口驱动，只显示实现了 validate+invoke 并通过契约测试的 Provider。不能因为 API Key 表单相似就把原生 Anthropic 请求发送到 /chat/completions。

### 13.5 Prompt 优化闭环

~~~text
选择失败 Run/Bad Cases
  → 归纳失败原因
  → 生成候选 PromptVersion
  → 展示 Diff
  → 在选中案例创建小型试跑 Run
  → 执行完整回归 Run
  → Gate 通过
  → 人工批准并移动 deployment
~~~

优化结果不得直接覆盖 active Prompt，也不得在没有 TargetVersion、DatasetVersion 和 SuiteVersion 的情况下自动创建不可执行实验。

## 14. 前端产品与实现方案

### 14.1 信息架构

~~~text
开始使用
  └── 接入向导

开发
  ├── 被测目标
  ├── Prompt
  └── Playground

测试
  ├── 数据集
  ├── 评估器
  └── 实验

观测
  ├── Trace
  ├── Session
  ├── 条件快照
  └── 告警

分析
  ├── 质量
  ├── 成本
  ├── 决策
  └── 用户反馈

设置
  ├── 项目
  ├── API/Service Token
  ├── 模型配置
  └── Runner
~~~

推荐路由：

~~~text
/onboarding
/targets
/targets/new
/targets/:targetId
/datasets
/datasets/:datasetId
/evaluators
/evaluators/:evaluatorId
/experiments
/experiments/new
/experiments/:experimentId
/runs/:runId
/runs/:runId/bad-cases
/runs/compare
/prompts
/prompts/:promptId
/playground
/traces
/traces/:traceId
/sessions/:sessionId
/snapshots
~~~

旧 /evaluation 和 /prompts?tab= 保留重定向。

### 14.2 新建实验六步向导

1. 选择 Dataset + DatasetVersion：显示样本数、字段完整度和标签分布。
2. 选择 Target + TargetVersion：显示验证状态、Agent/Prompt/模型/Git 版本。
3. 选择 Evaluator SuiteVersion：显示 Member、权重、required 和 Judge 模型。
4. 运行配置：并发、超时、重试、标签过滤、sample limit、trace wait。
5. 基线与 Gate：选择 baselineRunId 和门禁条件。
6. Preflight：调用 Experiment validate，展示预计 Target 调用数、Judge 调用数和所有阻塞项；通过后创建 Run。

前端不再提交 model_config 快照或仅显示 evaluatorName，必须提交版本 ID。

### 14.3 Run 详情

五个 Tab：

- 概览：版本快照、状态、Gate、通过率、错误率、分数、延迟、Token/成本和基线差异。
- 实时结果：样本、状态、总分、各评估器、延迟、Token、Trace、操作。
- Bad Cases：输入、期望、实际输出、各评分理由、Target/Evaluator 错误、版本和 Trace。
- 对比：按 caseKey 展示改进、持平、退化、新增和删除。
- 执行日志：Target 请求阶段、重试、租约、Judge 失败、取消和 Worker 事件。

页面刷新后通过 Run API 恢复状态；WebSocket 只优化实时性。

### 14.4 Bad Case 工作台

操作闭环：

1. 查看输入、context、expected、rawOutput、每个 Evaluator 的 score/reasoning。
2. 打开关联 Trace，并高亮失败 Tool/LLM/Retrieval Span。
3. 标注根因：Prompt、模型、工具、检索、业务数据、Evaluator 误判、未知。
4. 编辑 expected 时创建 Dataset 工作副本变更，不修改历史 DatasetVersion。
5. 加入回归数据集并提交新版本。
6. 使用该样本和锁定 TargetVersion 打开 Playground。
7. 修改 Prompt 产生候选版本，单案例创建 child Run。
8. 通过后启动全量回归并比较 baseline。

### 14.5 Trace 详情增强

在现有 Gantt、Span Tree、Span Detail 上增加：

- Instrumentation Health：缺失 Kind、parentSpanId、usage、PromptVersion、AgentVersion。
- Agent Loop：Observation → Decision → Action → Tool Result。
- Prompt/模型/Agent/Git 版本。
- Tool 参数、结果、重试；Retrieval query、文档 ID、分数与引用。
- 实验、RunItem、DatasetItem 双向链接。
- 顶部动作：加入数据集、快速评测、Playground 重放、创建条件快照。

当前“断点”如果没有真正的远程暂停/恢复控制通道，应先改名为条件快照，避免误导开发者。

### 14.6 前端工程结构

~~~text
frontend/src/features/
  onboarding/
  targets/
  datasets/
  evaluators/
  experiments/
  prompts/
  playground/
  traces/
  snapshots/
~~~

每个 feature 包含 api.ts、types.ts、queries.ts、mutations.ts、routes、components、tests。服务端状态建议由 TanStack Query 管理；Zustand 只保存登录态、当前项目、全局 UI 偏好和 WebSocket 连接状态。

统一 UI 状态：Loading Skeleton、Empty State、Error State、Retry、成功 Toast、字段级错误。后端错误不得只 console.error。

## 15. Service Token、CLI 与 CI

### 15.1 凭据模型

区分：

- 用户 JWT：浏览器中的用户交互。
- Ingestion Token：SDK 写 Telemetry。
- Runner/CI Service Token：读取 Dataset/Experiment、创建 Run、claim 样本、上传 Target Result、读报告。

Service Token scopes：

~~~text
telemetry:write
prompts:read
datasets:read
targets:read
targets:invoke
evaluation:run
evaluation:read
evaluation:result:write
~~~

Token 创建时返回一次明文，数据库只保存 hash、prefix、scopes、projectId、expiresAt、lastUsedAt。项目从 Token 推断，CLI 不再硬编码 default。

### 15.2 CLI 配置

新增正式 src/index.ts 和配置 profile：

~~~yaml
version: 1
currentProfile: staging
profiles:
  staging:
    baseUrl: https://monitor.example.com
    projectId: project_123
    tokenEnv: AGENTMONITOR_TOKEN
~~~

本地 Agent 配置：

~~~yaml
version: 1
target:
  name: order-agent-local
  type: external_runner
  protocol: stdio_ndjson
  command:
    - python
    - eval_adapter.py
  timeoutMs: 60000
runner:
  concurrency: 4
  environment:
    allow:
      - OPENAI_API_KEY
      - ORDER_SERVICE_URL
~~~

### 15.3 CLI 命令

~~~bash
agentmonitor init
agentmonitor doctor
agentmonitor trace test

agentmonitor target register -f agentmonitor.yaml
agentmonitor target test target_123 -f sample.json

agentmonitor dataset validate cases.jsonl
agentmonitor dataset push cases.jsonl --dataset customer-service

agentmonitor eval run experiment_123 --json
agentmonitor eval wait run_123
agentmonitor eval watch run_123
agentmonitor eval report run_123 --output report.json --junit report.xml
agentmonitor eval gate run_123 --min-pass-rate 0.90 --max-regression 0.01
agentmonitor eval retry run_123 --failed-only

agentmonitor runner start --run run_123 --target order-agent-local
~~~

退出码：0=Run 完成且 Gate 通过；1=质量 Gate 未通过；2=参数/配置错误；3=Target/Runner 错误；4=平台 API/鉴权错误；130=用户取消。

### 15.4 CI 示例

~~~yaml
- name: Run Agent evaluation
  env:
    AGENTMONITOR_BASE_URL: ${{ secrets.AGENTMONITOR_BASE_URL }}
    AGENTMONITOR_TOKEN: ${{ secrets.AGENTMONITOR_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    npx agentmonitor eval run exp_customer_service \
      --local \
      --wait \
      --baseline latest:main \
      --junit artifacts/agent-eval.xml \
      --output artifacts/agent-eval.json \
      --min-pass-rate 0.90 \
      --max-regression 0.01
~~~

PR 输出必须包含当前通过率、基线变化、回归 caseKey、required Evaluator 状态、Agent/Prompt/Dataset/Suite 版本和平台 Run 链接。

## 16. 自动评测、告警与条件快照

### 16.1 定时离线回归

Scheduler 对到期任务原子加锁，然后调用与 UI 相同的 POST Experiment Runs 服务，不另写执行逻辑：

~~~json
{
  "mode": "scheduledExperiment",
  "experimentId": "exp_123",
  "schedule": "0 2 * * *",
  "baselineStrategy": "latestSuccessful",
  "enabled": true
}
~~~

任务执行记录必须保存 createdRunId、startedAt、completedAt、status、error、nextRunAt。当前只更新 last_run_at/next_run_at 的实现必须替换；替换前 UI 标注“尚未启用”或隐藏触发按钮。

### 16.2 在线 Trace 抽样评测

~~~json
{
  "mode": "traceSampling",
  "filter": {
    "environment": "production",
    "kind": "agent",
    "status": "ok",
    "tags": ["customer-service"]
  },
  "sampling": {
    "strategy": "random",
    "maxCount": 100
  },
  "suiteVersionId": "suite_v3",
  "schedule": "0 * * * *"
}
~~~

流程：查询未被该任务处理的 Trace → 创建 trace_replay Run → 每条 Trace 创建 RunItem → 执行 Suite → 更新报告。auto_eval_sources 使用 taskId + sourceType + sourceId 唯一约束去重。

### 16.3 告警

P1 将规则从内存迁移到 alert_rules、alert_rule_runs、alert_notifications。触发源可以是 Run Gate、在线 Trace 评测、错误率或成本阈值。至少实现站内和 Webhook；通知失败必须显示 failed 并可重试，不能只 console.log。

### 16.4 条件快照与远程调试边界

P0：把现有 breakpoint 明确命名为 conditional snapshot，支持按 span kind、tool name、error code、latency 和 attributes 匹配，保存输入/输出/变量快照，并可跳转 Trace、加入数据集、在 Playground 重放。

P2 真正远程断点需要 Agent 与平台之间的双向控制协议、pause token、租约、resume/abort/step 命令和超时安全释放。在该协议完成前，产品不得宣称可以远程单步执行线上 Agent。

## 17. 后端与前端代码重构边界

### 17.1 后端模块

~~~text
backend/src/modules/
  telemetry/
    domain/
    ingest/
    repositories/
    routes/
    schemas/

  evaluation/
    domain/
      target.ts
      dataset.ts
      evaluator.ts
      suite.ts
      experiment.ts
      run.ts
      state-machine.ts
    repositories/
    targets/
      prompt-model-target.ts
      http-agent-target.ts
      external-runner-target.ts
      trace-replay-target.ts
    evaluators/
      exact-match.ts
      contains.ts
      regex.ts
      json-schema.ts
      token-overlap.ts
      llm-judge.ts
      tool-trajectory.ts
    services/
      experiment-service.ts
      run-service.ts
      target-invoker.ts
      evaluator-engine.ts
      aggregation-service.ts
      scheduler-service.ts
    workers/
      run-orchestrator.ts
      item-worker.ts
      scheduler-worker.ts
    routes/

  prompts/
  auth/
~~~

现有文件迁移原则：

- evaluation-target.ts 变为 Target Adapter Registry，并首先修复 PromptVersion 精确加载。
- evaluation-runner.ts 由持久化 Worker 取代，不再选择 evaluators[0]。
- evaluation.ts 大文件拆为 repository/domain/service。
- routes/evaluation.ts 拆分为 targets、datasets、evaluators、suites、experiments、runs、runners。
- trace.ts/span.ts 的 V1 写路径改为 Telemetry V2 Adapter。
- llm-client.ts 改为 Provider Adapter Registry。

### 17.2 数据库迁移目录

~~~text
backend/src/db/migrations/
  manifest.ts
  sqlite/
    0001_schema_migrations.sql
    0010_telemetry_v2.sql
    0020_targets.sql
    0030_dataset_versions.sql
    0040_evaluator_suites.sql
    0050_evaluation_runs.sql
    0060_service_tokens.sql
    0070_prompt_deployments.sql
  postgres/
    0001_schema_migrations.sql
    0010_telemetry_v2.sql
    ...
~~~

SQLite 与 PostgreSQL 使用同一迁移编号和语义，方言 SQL 分开。当前 SQLite 启动时的 columnExists + ALTER TABLE 和 PostgreSQL schema.sql 不能继续各自演化。每次迁移必须支持 fresh database、当前版本升级和重复启动无副作用。

### 17.3 前端 Feature 拆分

大型页面逐步迁移到 features 目录，但不要求一次性重写 UI。优先从新 Target、Onboarding、Run Detail 使用新结构；旧 EvaluationPage 只做兼容读取并最终重定向。

### 17.4 共享契约

建议新增 packages/contracts，包含：

- Telemetry JSON Schema。
- OpenAPI 生成的 V2 REST 类型。
- Run/RunItem 状态和合法迁移。
- Target HTTP 协议 Schema。
- Runner NDJSON Schema。
- 标准错误码。

后端运行时校验、前端类型、CLI 和测试 Fixture 都从契约生成或引用，避免手写四份不同接口。

## 18. 数据迁移与 V1 兼容

### 18.1 Phase 0：建立迁移基础设施

1. 新增 schema_migrations。
2. 给 SQLite/PostgreSQL 建立同编号 migration runner。
3. 在 CI 中同时测试空库和当前库升级。
4. 在任何回填前生成备份和迁移统计，但不删除旧表。

### 18.2 Phase 1：新增 V2 表，不改变旧 API

新增 trace_runs、telemetry_event_receipts、agent_targets、agent_target_versions、dataset_version_items、evaluator_suites、evaluator_suite_versions、evaluator_suite_members、evaluation_runs、evaluation_run_items、evaluation_scores、evaluation_run_events、service_tokens、runner_sessions、prompt_deployments、auto_eval_sources。

### 18.3 Phase 2：回填

1. 每个没有版本的 Dataset 生成 v1，拆解旧 item_data 到 dataset_version_items。
2. 每个 Evaluator 生成或确认 EvaluatorVersion。
3. 每个旧 Experiment 生成 prompt_model TargetVersion：优先使用 prompt_id + prompt_version_id + target_model_config_id；仅有 model_config 时创建 legacy config，并标记 inferred。
4. 旧 Experiment 没有 Evaluator 绑定时，把历史执行器实际采用的项目首个 Evaluator 固化到迁移 Suite，并标记 migration.inferred=true，不能继续动态选择。
5. 每个旧 Experiment 生成 V2 Experiment 和一个 legacy EvalRun。
6. 旧 evaluation_results 拆为 RunItem.targetOutput 和一条 EvalScore。
7. 保留 legacy_id 或映射表，支持历史 URL 跳转。
8. 旧 traces 回填到 trace_runs；无法确定根节点的记录标记 legacyRootInferred。

### 18.4 Phase 3：兼容写入

- POST /api/v1/traces 和 /spans 转换为 V2 Event，服务端只写一次。
- POST /api/v1/evaluation/experiments/:id/start 内部创建 V2 Run，立即返回兼容字段和 runId。
- V1 外部 result API 只在迁移期保留；上传的客户端 score 标记 untrusted，不参与新报告，服务端重算。
- 旧前端读取 V1 View，新的 Target/Run 页面只用 V2。
- V1 响应加入 Deprecation 与 Sunset 提示，但不在首个版本删除。

### 18.5 Phase 4：切换默认路径

新项目默认使用 V2；旧项目提供显式升级入口。确认历史数量、通过率、平均分、Trace 树和 URL 映射一致后，停止旧写入。旧表继续只读一个版本周期，再单独评审删除。

### 18.6 回滚原则

每个 Phase 使用功能开关，不通过删除 V2 表回滚。写入切换前保留旧读取 View；若新 Worker 故障，停止 claim 新任务并允许回到 V1 只读，而不是把已完成 Run 逆向改写为旧 Experiment 状态。

## 19. 立即修复清单（架构实施前的 Truth Repair）

以下修复应先进入当前分支，防止继续产生误导数据：

| 顺序 | 修复 | 验收 |
|---|---|---|
| 1 | span create 改 Upsert，end 合并 output/status/endedAt/duration/error | start→end 最终一条完整 Span |
| 2 | SDK/后端取消 Trace 根 Span 双写，显式传 traceId/spanId | 每条 Trace 恰好一个根节点 |
| 3 | TS AsyncLocalStorage、Python ContextVar、Go context.Context | 100 并发调用不串 Trace |
| 4 | endSession 走真实 session.end | 正常/异常退出均可关闭 Session |
| 5 | EvaluationPage 提交 target_model_config_id/prompt IDs/run_config | 页面新建实验可真实执行 |
| 6 | EvalWizard 保存 evaluatorId；Runner 不再取第一个 Evaluator | 用户选择与执行结果一致 |
| 7 | evaluation-target 按 promptVersionId 加载 | 修改当前 Prompt 后历史 Run 结果可复现 |
| 8 | start 路由先返回 202；最小 DB Worker 执行 | 刷新后可恢复进度 |
| 9 | 删除 Playground 模拟输出，调用真实后端 | 结果含真实 traceId 和 provider error |
| 10 | Prompt 自动回归必须创建合法 Target/版本绑定 | 自动回归不再生成 targetless 实验 |
| 11 | 自动评测未实现前隐藏 trigger 成功提示 | 用户不会收到假成功 |
| 12 | CLI 修复入口、Token、projectId、run/wait | 安装后的命令可跑通一个真实实验 |
| 13 | UI 只展示已实现 Provider | 不再允许必然失败的配置 |
| 14 | 所有核心错误进入页面和 Run Event | 无需打开 Console 才能定位失败 |

## 20. 测试与 E2E 验证方案

项目已经使用 Vitest 和 Playwright，应延续现有工具，不引入第二套 E2E 框架。

### 20.1 单元测试

Telemetry：

- start/end/乱序/重复 eventId 合并。
- Terminal 状态不能被 start 覆盖。
- attributes、usage、error 字段合并。
- W3C ID 和 traceparent inject/extract。
- Buffer 重试、drop 策略、shutdown。

SDK 并发：

- Node 100 个 Promise.all。
- Python 100 个 asyncio Task + 线程池。
- Go 100 个 goroutine。
- 验证每棵树只有自己的 Span。

Evaluation：

- Target mapping 与 outputPath。
- Run/RunItem 每个合法和非法状态迁移。
- 重试和 retryable 判定。
- Suite 权重、required、error policy。
- PromptVersion 精确加载。
- caseKey 基线对齐和 Gate。
- 人工校准后的 Bad Case 计算。

### 20.2 Contract Test

Mock HTTP Agent 覆盖：同步成功、4xx、429、5xx、超时、非法 JSON、响应映射失败、异步 callback、重复 callback、Trace ID 回传。

Mock Model Provider 覆盖：OpenAI-compatible 正常/流式/Tool Call/错误，Anthropic 原生格式，Judge 返回非法 JSON。测试不能访问真实付费模型。

Runner NDJSON 覆盖：多条输入、stdout 协议与 stderr 日志分离、子进程崩溃、单样本超时、CLI 中断、网络恢复续传和重复上传。

### 20.3 后端集成测试

1. Ingest root + children + session.end，查询得到正确树。
2. span.end 先于 start，最终仍完整。
3. 两个 Worker 不会 claim 同一 RunItem。
4. Worker 崩溃后租约到期重入队。
5. Target 成功、Evaluator 阶段崩溃，恢复时不重复调用 Target。
6. 重复 target-result 不产生重复 Score。
7. running Run 取消后不再 claim 新 Item。
8. retry failed 创建新 Run 且只包含错误 Item。
9. 最后一项完成只聚合一次。
10. Service Token scopes 和跨项目访问被正确拒绝。
11. Scheduled Experiment 创建真实 Run。
12. Trace Sampling 去重。

### 20.4 前端 Playwright E2E

必须新增或重写以下用户旅程：

1. 新用户 → 项目 → Ingestion Token → TS SDK 测试 Trace → 接入成功。
2. 只有根 Span 时提示 LLM/Tool Hook 缺失。
3. 创建 HTTP Target → Verify → 真实输出与 traceId。
4. 从 Trace 创建 DatasetItem → 预览 → 提交 DatasetVersion。
5. 创建两个 Evaluator → 提交 SuiteVersion → 单样本试评。
6. 六步创建 Experiment，确认三个版本 ID 均保存。
7. 启动 20 条样本 Run，看到逐条进度，刷新后恢复。
8. Target timeout 与 quality fail 分别显示，不混为同一种失败。
9. Bad Case 展示所有 Evaluator 理由和关联 Trace。
10. 从 Bad Case 打开 Playground，创建 Prompt 候选版本并单条重跑。
11. 全量回归与 baseline 比较显示 regressed/improved case。
12. 取消 Run 后状态稳定为 cancelled。
13. External Runner claim/heartbeat/complete 后平台统一评分。
14. CLI Gate 未通过返回 1，并生成 JSON/JUnit。
15. 定时任务创建新 Run；同一 Trace 不重复在线评测。

### 20.5 迁移测试

SQLite 与 PostgreSQL 分别覆盖：

- 空数据库直接升级。
- 当前最新版数据库升级。
- 只包含旧 Dataset/Experiment/Result 的数据库升级。
- 同一迁移重复执行无副作用。
- 迁移前后旧报告的样本数、通过数和平均分对应。
- V1 兼容接口可读取迁移数据。
- 新 V2 Run 不污染旧表。

### 20.6 测试数据与确定性

新增三个参考 Agent：

- prompt-model-agent：使用 Mock Provider，输出完全确定。
- http-refund-agent：支持成功、工具失败、超时和 traceparent。
- local-runner-agent：Node/Python NDJSON Adapter。

每个 Fixture 固定 caseKey、PromptVersion、TargetVersion、SuiteVersion 和随机种子。LLM Judge 测试使用 Mock Judge 输出，避免 E2E 因真实模型波动失败。

### 20.7 发布阻断条件

下列任一失败则不能启用新路径：

- start/end 不能稳定合并。
- 并发 Trace 串树。
- Experiment 没有锁定三个版本。
- 外部 Runner 可以上传客户端 score 并覆盖平台结果。
- Run 刷新后丢失进度。
- PromptVersion 未被精确加载。
- Playground 仍存在模拟成功。
- Service Token 可越权访问其他项目。
- migration fresh/upgrade 任一数据库失败。

## 21. 实施顺序与可独立合并的变更单元

建议按依赖拆为以下 PR/任务包，而不是按页面并行堆功能：

### PR-01：迁移基础设施

- schema_migrations。
- SQLite/PostgreSQL 同编号迁移 Runner。
- fresh/upgrade 测试。

### PR-02：Telemetry Schema 与 Span Upsert

- event.schema.json 和 fixtures。
- /api/v2/telemetry/batch。
- event receipts、trace_runs、Span Upsert。
- V1 /traces、/spans 适配器。

### PR-03：三语言 Context 与可靠队列

- TS AsyncLocalStorage。
- Python ContextVar。
- Go context.Context/Eino 修复。
- 统一 Buffer、flush、shutdown、contract tests。

### PR-04：Onboarding 与 Integration Health

- integration-status。
- 语言/框架示例。
- 测试 Trace 与诊断 UI。

### PR-05：Target 领域与 prompt_model

- Target/Version 表和 API。
- PromptVersion 精确执行。
- 旧 ModelConfig 包装为兼容 Target。

### PR-06：http_agent 与真实 Playground

- HTTP Adapter、mapping、verify/test。
- Playground invoke/compare 统一 Target。
- 删除模拟输出。

### PR-07：DatasetVersionItem 与 Evaluator Suite

- 逐样本快照和 caseKey。
- Suite/Version/Member。
- Evaluator test 与聚合规则。

### PR-08：Experiment/Run 分离

- Run、RunItem、Score、RunEvent。
- validate/start 202。
- 报告兼容读取。

### PR-09：数据库 Worker

- claim/lease/heartbeat/recovery。
- cancel、自动 retry、新 retry Run。
- WebSocket 进度与轮询恢复。

### PR-10：External Runner、Service Token 与 CLI

- Scopes。
- runner session/claim/result。
- CLI 入口、profile、run/wait/gate/JUnit。

### PR-11：Run Detail 与 Bad Case

- 六步向导。
- 实时结果、日志、Trace 链接。
- 单条重跑、加入回归集、baseline compare。

### PR-12：Prompt Runtime 与回归发布

- prompt_deployments、Runtime API、SDK Cache。
- Prompt 优化候选→试跑→全量 Gate→发布。

### PR-13：自动评测与告警

- Scheduled Run。
- Trace Sampling。
- 持久化 Alert Rule/Webhook。

每个 PR 必须包含迁移、服务端测试、前端或 SDK 测试、文档和兼容行为，不允许先合并“看起来成功”的 UI 占位。

## 22. 分级范围

### P0：达到 Agent 开发者可用

- Telemetry V2、Span Upsert、正确上下文传播。
- Onboarding 与埋点诊断。
- Target + Version，支持 prompt_model、http_agent、external_runner。
- DatasetVersionItem 和 Evaluator Suite。
- Experiment/Run/RunItem/Score 分离。
- 持久化异步 Worker、取消、恢复、失败项新 Run。
- 真实 Playground、PromptVersion 精确执行。
- Run Detail、Bad Case、Trace 双向链接。
- Service Token 和 CLI run/wait/gate。
- V1 兼容迁移和完整 E2E。

### P1：形成日常优化闭环

- JSONL/CSV 导入导出和复杂字段映射。
- Baseline case 级 Diff、JUnit、人工校准。
- Prompt Runtime/deployment。
- Trace Sampling 与定时回归。
- HTTP 异步 callback。
- Tool trajectory、RAG groundedness。
- 告警持久化和 Webhook。

### P2：复杂 Agent 平台能力

- 多 Agent Handoff Link 和拓扑。
- 自定义 HTTP/本地 Evaluator。
- 真正远程断点控制。
- 对抗样本生成、审批流、Target/Prompt 发布联动。
- OTel Exporter/Receiver 和更广泛框架生态。

## 23. 最终验收标准（Definition of Done）

只有同时满足以下条件，才可以称为“Agent 应用开发者能够顺利使用”：

1. 新用户 10 分钟内完成项目、Token、SDK/Hook 和第一条完整 Trace。
2. 一次 Agent Run 只有一个根 Span，所有 Span 终态正确；100 并发请求不串树。
3. 开发者无需修改 AgentMonitor 后端代码即可配置一个任意 HTTP Agent。
4. 内网 Agent 可通过一条 Runner 命令领取样本、上传原始输出，并由平台统一评分。
5. 每次 Run 锁定 DatasetVersion、TargetVersion、EvaluatorSuiteVersion，可复现。
6. Start 返回 202，页面刷新后进度、日志和结果不丢失，并支持取消和失败项新 Run。
7. 一个样本支持多个 Evaluator，评分、错误和 required 条件分别展示。
8. Bad Case 同时显示 input、expected、rawOutput、评分理由、版本和 Trace，可加入回归集并单条重跑。
9. Prompt/Playground 所有显示结果都来自真实 Target 调用，不存在模拟成功。
10. CLI/CI 能 run、wait、report、gate；质量回归与基础设施错误使用不同退出码。
11. Scheduled Run 和 Trace Sampling 真正创建 Run，不再只更新时间戳。
12. SQLite、PostgreSQL fresh/upgrade、V1 compatibility、SDK contract 和核心 Playwright E2E 全部通过。
13. UI 中没有已知不可执行 Provider、targetless 实验或伪“远程断点”入口。
14. 所有核心失败在 UI/RunEvent/CLI 中可见，不要求开发者打开浏览器 Console 或服务器日志才能知道原因。

## 24. 实施决策摘要

| 决策 | 选择 | 原因 |
|---|---|---|
| 是否重写现有技术栈 | 否，沿用 Fastify、React、现有数据库抽象 | 核心问题是协议和领域边界，不是框架能力 |
| P0 是否引入 Redis | 否，先抽象 Queue 并使用数据库 Worker | 先完成可验证闭环，避免基础设施先行 |
| Experiment 是否代表一次运行 | 否 | 可重复运行和版本对比要求独立 EvalRun |
| 外部 Runner 是否可上传最终 score | 否 | 必须保证平台统一评分版本与口径 |
| Trace 是否继续由 /traces 和 /spans 双写 | 否 | 一个 Telemetry Event 流和一个 Upsert Read Model |
| Prompt/Target/Evaluator/Dataset 是否锁定版本 | 是 | 结果复现和基线比较的前提 |
| WebSocket 是否是真相来源 | 否 | RunEvent/数据库为真相，WebSocket 只做实时推送 |
| 未完成的自动评测/模拟 Playground 是否继续展示 | 否 | 禁止把占位行为当作产品成功状态 |
| 现有 V1 是否立即删除 | 否 | 使用 Adapter、回填和只读兼容渐进迁移 |

这套方案完成 P0 后，AgentMonitor 才具备一条真实、可复现、可调试、可自动化的开发者主路径；后续的在线评测、多 Agent、告警和高级调试都应在该协议与领域模型之上扩展，不能再建立平行数据结构。
