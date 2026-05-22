# P0-01 需求文档：Span 级分布式追踪 + Trace 调用链可视化

> **版本**: v1.1（评审后修订版）
> **日期**: 2026-04-29
> **状态**: 评审通过，待技术设计
> **优先级**: P0
> **参考**: 业界主流产品 Trace 调用链火焰图 / Langfuse Trace Tree

---

## 1. 背景与目标

### 1.1 背景

当前 AgentMonitor 的 `traces` 表是**扁平结构**，一条 trace 记录一次调用事件（如 LLM 调用、工具调用、消息），但 trace 之间缺乏**父子调用关系**。当 Agent 执行复杂链路时：

```
用户输入
  ├── Prompt 解析 (100ms)
  ├── LLM 调用 GPT-4 (2.5s, 1500 tokens)
  │     ├── 内部重试 1 (失败)
  │     └── 内部重试 2 (成功)
  ├── 工具调用: checkWeather (500ms)
  │     ├── HTTP 请求 (300ms)
  │     └── 数据解析 (200ms)
  └── 输出格式化 (50ms)
```

平台只能展示为 5 条平级记录，用户无法直观看出：
- 哪个环节耗时最长
- 调用层级关系
- 错误发生在哪个子环节

### 1.2 目标

引入 **Span 模型**，实现类似 OpenTelemetry 的分布式追踪能力：
1. **数据层**: 支持 Span 的嵌套、并行、父子关联
2. **SDK 层**: 开发者可用 `startSpan()` / `endSpan()` 或自动拦截包裹调用链
3. **API 层**: 支持按 trace_id 查询完整的 Span 树
4. **前端层**: Trace 详情页展示**调用链树状图 + Gantt 时间轴（MVP）**，火焰图作为 **P1 增强**

### 1.3 北极星指标（North Star Metrics）

| 指标 | 基准值 | 目标值 | 说明 |
|-----|--------|--------|------|
| **问题定位时间** | 无 Span 时需查看多条平级 trace + 日志，平均 5-10 分钟 | < 2 分钟 | 用户从发现异常到定位根因 Span 的平均时间 |
| **Trace 详情页停留时长** | 当前平均 45s（扁平列表浏览快但信息少） | > 90s | 反映可视化对用户的价值深度 |
| **Span 功能采纳率** | 0%（新功能） | > 40%（90 天内） | 启用 Span 追踪的活跃项目占比 |

### 1.4 行业差异化分析

| 维度 | AgentMonitor | Langfuse | LangSmith (OpenAI) | 业界主流产品 |
|-----|--------------|----------|-------------------|----------|
| **开源** | ✅ 完全开源 | ✅ 开源 | ❌ 闭源 | ❌ 闭源 |
| **自托管** | ✅ 轻量，SQLite/PostgreSQL | ✅ 需 Docker Compose | ❌ 仅云端 | ❌ 仅云端 |
| **接入成本** | 一行 `autoInstrument`，支持 wrap | 需修改代码埋点 | 需使用 LangChain | 需使用主流生态 |
| **数据隐私** | ✅ 数据完全本地 | ✅ 自托管可本地 | ❌ 数据上传 OpenAI | ❌ 数据上传字节 |
| **与评测联动** | ✅ 原生集成（同平台） | ❌ 需额外配置 | ❌ 仅 Trace | ❌ 需额外配置 |
| **Prompt 版本管理** | ✅ 原生集成 | ⚠️ 有限支持 | ⚠️ 有限支持 | ✅ 支持 |

**核心差异化**：AgentMonitor 是**开源 + 自托管 + 评测/Trace/Prompt 一体化**平台，适合对数据隐私敏感、希望一站式管理 Agent 全生命周期的团队。

---

## 2. 术语定义

| 术语 | 定义 |
|-----|------|
| **Trace** | 一次完整的请求/会话链路，由多个 Span 组成，共享同一个 `trace_id` |
| **Span** | 链路中的一个操作单元，有开始时间、持续时间、状态。Span 之间通过 `parent_span_id` 关联 |
| **Root Span** | Trace 中 `parent_span_id` 为空的 Span，代表链路入口 |
| **Span Tree** | 由 Root Span 及其所有子 Span 构成的树形结构 |
| **Trace ID** | 全局唯一标识一次完整链路（UUID） |
| **Span ID** | 全局唯一标识一个 Span（UUID） |

---

## 3. 用户故事

### US-1: 开发者手动标记 Span
> 作为 Agent 开发者，我可以在代码中用 `monitor.startSpan()` / `endSpan()` 包裹一段逻辑，使其在平台上显示为 Trace 树中的一个节点。

**验收标准**:
- SDK 提供 `startSpan(name, options?)` 返回 SpanContext
- SDK 提供 `endSpan(spanContext, options?)` 结束 Span
- 未显式结束的 Span 在 session_end 时自动结束
- 支持设置 `attributes`（自定义 KV）和 `status`（success/error）

### US-2: 自动拦截生成 Span
> 作为开发者，我希望 SDK 的 `wrap()` 和 `autoInstrument` 自动创建 Span，而不需要手动修改代码。

**验收标准**:
- `monitor.wrap(fn)` 自动创建名为 `fn.name` 的 Span
- `autoInstrumentOpenAI` 创建的 LLM trace 内部包含子 Span（请求序列化、HTTP 发送、响应解析）
- `trackToolCall` 自动创建 Span

### US-3: 查询 Trace 调用链
> 作为平台用户，我可以在 Trace 详情页看到完整的调用链树。

**验收标准**:
- 后端 API `GET /api/v1/traces/:id/tree` 返回 Span 树 JSON
- 前端 Trace 详情页左侧展示**树状列表**（可折叠展开）
- 右侧展示**Gantt 时间轴**（MVP），火焰图作为 P1 增强
- 点击 Span 可查看详情：input/output/attributes/latency/status/**token 消耗/成本**

### US-4: 性能瓶颈定位
> 作为运维人员，我可以通过可视化时间轴快速定位耗时最长的 Span。

**验收标准**:
- Gantt 图按时间轴展示所有 Span，支持按 latency 排序
- 颜色编码：成功=绿色，错误=红色，警告=黄色
- 条形宽度 proportional to latency
- Hover 显示 Span 名称、耗时、状态、Token 消耗

---

## 4. 功能需求

### 4.1 数据库 Schema 变更

#### 新增 `spans` 表

```sql
CREATE TABLE spans (
  span_id         UUID PRIMARY KEY,         -- Span 唯一标识（由 SDK 生成）
  trace_id        UUID NOT NULL,             -- 所属 Trace
  parent_span_id  UUID REFERENCES spans(span_id), -- 父 Span
  name            TEXT NOT NULL,             -- Span 名称，如 "llm_call"
  trace_type      TEXT NOT NULL,             -- message / llm / tool_call / function / custom
  
  -- 时间
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  latency_ms      DOUBLE PRECISION,
  
  -- 数据（受 truncate 策略限制，见 5.3 节）
  input           JSONB,
  output          JSONB,
  attributes      JSONB,                     -- 自定义属性，如 { model: "gpt-4", temperature: 0.7 }
  
  -- 状态
  status          TEXT NOT NULL DEFAULT 'success', -- success / error / unset
  error           TEXT,
  
  -- 关联
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id      TEXT,
  
  -- 索引
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spans_trace_id ON spans(trace_id);
CREATE INDEX idx_spans_parent_span_id ON spans(parent_span_id);
CREATE INDEX idx_spans_project_id ON spans(project_id);
CREATE INDEX idx_spans_session_id ON spans(session_id);
CREATE INDEX idx_spans_started_at ON spans(started_at);
```

> **设计说明**: `span_id` 直接作为主键，不再保留冗余的 `id` 字段。SDK 负责生成 UUIDv4 的 `span_id`。

#### `traces` 表兼容升级

现有 `traces` 表数据需要迁移：
- 为每条现有 trace 生成 `trace_id`（可用 `session_id + timestamp` 派生，或新 UUID）
- 为每条现有 trace 生成 `span_id`（复用 trace.id）
- 设置 `parent_span_id = NULL`（现有 trace 全部视为 Root Span）

**迁移策略**: 零停机双写
1. 新增 `spans` 表
2. 代码同时写入 `traces` 和 `spans`（双写）
3. 后台任务将历史 `traces` 数据迁移到 `spans`
4. 前端查询切到 `spans` 表
5. 后续版本 deprecate `traces` 表

> **注意**: 现有 SDK `trace()` 方法需要内部包装为 Root Span 写入 `spans` 表，需配套 SDK 发版。

### 4.2 后端 API

#### 4.2.1 创建 Span（内部使用）

```
POST /api/v1/spans
Headers: X-API-Key: xxx
Body: {
  "traceId": "uuid",
  "parentSpanId": "uuid | null",
  "spanId": "uuid",
  "name": "llm_call",
  "traceType": "llm",
  "startedAt": "2026-04-29T10:00:00Z",
  "endedAt": "2026-04-29T10:00:02.5Z",
  "latencyMs": 2500,
  "input": { "model": "gpt-4", "messages": [...] },
  "output": { "choices": [...] },
  "attributes": { "model": "gpt-4", "temperature": 0.7 },
  "status": "success",
  "sessionId": "session_xxx"
}
```

#### 4.2.2 查询 Trace 树

```
GET /api/v1/traces/:traceId/tree
Headers: Authorization: Bearer <token>

Response: {
  "trace": { id, traceId, name, startedAt, endedAt, latencyMs, status },
  "spans": [
    {
      "spanId": "span-1",
      "name": "agent_run",
      "traceType": "function",
      "startedAt": "...",
      "endedAt": "...",
      "latencyMs": 5000,
      "status": "success",
      "tokens": { "prompt": 1200, "completion": 300, "total": 1500 },
      "costUsd": 0.045,
      "children": [
        {
          "spanId": "span-2",
          "name": "llm_call",
          "latencyMs": 2500,
          "status": "success",
          "tokens": { "prompt": 1000, "completion": 200, "total": 1200 },
          "costUsd": 0.036,
          "children": [...]
        }
      ]
    }
  ],
  "stats": {
    "totalSpans": 5,
    "totalLatencyMs": 5000,
    "totalTokens": { "prompt": 1200, "completion": 300, "total": 1500 },
    "totalCostUsd": 0.045,
    "errorCount": 0
  }
}
```

> **新增字段**: `tokens`（Token 消耗明细）和 `costUsd`（预估成本）在 Span 详情中强制展示。

#### 4.2.3 查询 Span 列表（平面）

```
GET /api/v1/traces/:traceId/spans
Query: ?limit=50&offset=0
Response: { "spans": [...] }
```

### 4.3 SDK 接口（TypeScript）

```typescript
interface SpanOptions {
  name: string;
  traceType?: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
}

interface SpanContext {
  spanId: string;
  traceId: string;
  name: string;
  startTime: number;
}

class AgentMonitor {
  // 创建新 Trace（含 Root Span）
  startTrace(name: string, options?: { traceId?: string; attributes?: Record<string, unknown> }): SpanContext;
  endTrace(traceId: string, options?: { status?: 'success' | 'error'; error?: string }): void;
  
  // 在现有 Trace 中创建子 Span
  startSpan(name: string, options?: SpanOptions): SpanContext;
  endSpan(spanContext: SpanContext, options?: { status?: 'success' | 'error'; error?: string; output?: unknown }): void;
  
  // 设置 Span 属性（如 token 消耗、模型名称）
  setSpanAttribute(spanContext: SpanContext, key: string, value: unknown): void;
  setSpanAttributes(spanContext: SpanContext, attributes: Record<string, unknown>): void;
  
  // 便捷方法：自动包裹函数
  withSpan<T>(name: string, fn: (span: SpanContext) => Promise<T>, options?: SpanOptions): Promise<T>;
}
```

**使用示例**:

```typescript
const root = monitor.startTrace('customer_service', { traceId: generateTraceId() });

try {
  await monitor.withSpan('intent_detection', async (span) => {
    const intent = detectIntent(input);
    return intent;
  });
  
  await monitor.withSpan('llm_call', async (span) => {
    const response = await openai.chat.completions.create({...});
    monitor.setSpanAttributes(span, {
      model: response.model,
      tokens_prompt: response.usage.prompt_tokens,
      tokens_completion: response.usage.completion_tokens,
      tokens_total: response.usage.total_tokens,
    });
    return response;
  });
  
  await monitor.withSpan('tool_call', async (span) => {
    const result = await checkWeather(city);
    return result;
  });
  
  monitor.endTrace(root.traceId, { status: 'success' });
} catch (error) {
  monitor.endTrace(root.traceId, { status: 'error', error: error.message });
}
```

### 4.4 前端可视化

#### 4.4.1 Trace 详情页布局（MVP）

```
┌─────────────────────────────────────────────────────────┐
│  Trace: customer_service          [Status: ✅ Success]  │
│  Duration: 5.2s | Trace ID: xxx | Session: xxx          │
│  Total Tokens: 1,500 | Cost: $0.045                     │
├─────────────────────────────────────────────────────────┤
│  [Gantt 时间轴]                                          │
│  agent_run       ██████████████████████████████████████ │
│  ├─intent_detec.  ██                                    │
│  ├─llm_call      ████████████                           │
│  │  ├─serialize   █                                     │
│  │  ├─http_req   ██████████                             │
│  │  └─deserialize █                                     │
│  ├─tool_call     ██                                     │
│  │  ├─http_req    █                                     │
│  │  └─parse       █                                     │
│  └─format_output  █                                     │
├─────────────────────────────────────────────────────────┤
│  [Span 树状列表]                    [Span 详情面板]      │
│  ▼ agent_run (5.2s)                  Name: llm_call     │
│    ▶ intent_detection (200ms)        Type: llm          │
│    ▼ llm_call (2.5s)                 Status: success    │
│      ▶ serialize (50ms)              Latency: 2500ms    │
│      ▶ http_request (2.2s)           Tokens: 1,200      │
│      ▶ deserialize (50ms)            Cost: $0.036       │
│    ▶ tool_call:checkWeather (500ms)  Model: gpt-4       │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

#### 4.4.2 Gantt 时间轴规格（MVP）

- **X 轴**: 时间轴（相对于 Trace 开始时间）
- **Y 轴**: Span 列表（按层级缩进，支持按 latency 排序）
- **颜色**:
  - 绿色 `#22c55e` = success
  - 红色 `#ef4444` = error
  - 灰色 `#9ca3af` = unset/in_progress
- **Hover Tooltip**: 显示名称、耗时、状态、Token 消耗、预估成本
- **Click**: 选中 Span，右侧展示详情面板
- **排序**: 默认按时间顺序，支持切换为按 latency 降序

**技术选型**:
- **MVP**: 基于 HTML/CSS 的 Gantt 条形图（实现成本低，满足核心诉求）
- **P1**: 升级为自研 SVG 火焰图（嵌套层级可视化，工作量更大）

#### 4.4.3 火焰图（P1 增强，非 MVP）

- **X 轴**: 时间轴（相对于 Trace 开始时间）
- **Y 轴**: 调用层级（嵌套深度）
- **颜色**: 同 Gantt 图
- **交互**: Hover、Click、缩放
- **实现**: 自研 SVG 渲染（需要与 Span 树列表联动交互）

### 4.5 数据隐私与安全

#### 4.5.1 PII 脱敏策略

| 场景 | 策略 | 配置 |
|-----|------|------|
| **Prompt 中的用户输入** | 可选脱敏：邮箱 → `***@***.com`，手机号 → `138****8888` | SDK `config.sanitizePII = true` |
| **API Key / Token** | 强制脱敏：只保留前 4 位和后 4 位 | 后端自动处理 |
| **信用卡号 / SSN** | 强制脱敏：全部替换为 `[REDACTED]` | 正则匹配自动处理 |

#### 4.5.2 敏感字段过滤

- SDK 提供 `sensitiveKeys` 配置，指定哪些字段不上报（如 `password`, `secret`, `api_key`）
- 后端写入 `spans` 表前，递归扫描 JSON 字段，命中 `sensitiveKeys` 的值为 `[FILTERED]`
- 默认敏感键列表：`password`, `secret`, `token`, `api_key`, `authorization`, `cookie`

#### 4.5.3 数据保留策略

| 环境 | 默认保留期 | 可配置 |
|-----|-----------|--------|
| 开发/测试 | 7 天 | ✅ |
| 生产 | 90 天 | ✅ |
| 企业合规 | 自定义（1-365 天） | ✅ |

- 后台定时任务清理过期 Span（软删除标记，物理删除延迟 7 天）
- 导出功能：支持将 Span 数据导出为 JSON/CSV 归档

---

## 5. 非功能需求

| 指标 | 要求 |
|-----|------|
| **延迟** | Span 创建 API P99 < 50ms |
| **查询** | Trace 树查询 P99 < 200ms（50 个 Span 以内） |
| **兼容性** | 现有 SDK `trace()` / `traceLLM()` 等方法继续工作，内部自动映射为 Root Span |
| **并发** | 支持同一 Trace 内并发 Span（如并行工具调用） |
| **存储** | spans 表单条记录 < 1MB（input/output 过大时按策略 truncate，见 5.3） |

### 5.1 SDK 双写兼容性

现有 SDK `trace()` 方法需要在 SDK 内部包装为 Root Span：
- `trace(name, fn)` → 内部调用 `startTrace(name)` → 执行 `fn` → `endTrace()`
- `traceLLM(options)` → 内部调用 `startSpan('llm_call', { traceType: 'llm' })` → 记录 input/output → `endSpan()`
- 确保旧版 SDK 用户无需修改代码即可在 `spans` 表中看到数据

### 5.2 大规模查询优化

- Trace 树查询后端使用递归 CTE（Common Table Expression）
- 前端 Gantt 图对超过 100 个 Span 的 Trace 启用虚拟滚动
- 超过 500 个 Span 的 Trace，API 返回前 500 个，提示"部分 Span 未加载"

### 5.3 数据 Truncate 策略

当单条 Span 的 `input` + `output` + `attributes` 序列化后超过 **512KB** 时：

1. **优先级**: 先 truncate `output`，再 truncate `input`，保留 `attributes`
2. **截断方式**: 字符串类型保留前 10,000 字符 + `"... [truncated, total: X chars]`；数组/对象保留前 50 个元素 + `{"_truncated": true, "total": X}`
3. **前端提示**: 详情面板中显示 ⚠️ "数据已截断，原始大小 X KB"
4. **完整数据**: 提供 `GET /api/v1/spans/:spanId/raw` 接口下载完整未截断数据（受权限控制）

---

## 6. 边界情况

| 场景 | 处理方案 |
|-----|---------|
| Span 未显式结束 | SDK `close()` / `endSession()` 时自动结束所有未关闭 Span |
| 循环引用（A 的 parent 是 B，B 的 parent 是 A） | 后端查询树时检测循环，最多递归 100 层 |
| 孤儿 Span（parent 不存在） | 视为 Root Span 处理 |
| 超大 Trace（1000+ Span） | 前端分页加载，Gantt 图启用虚拟滚动，超过 500 个提示未完全加载 |
| 并发同名 Span | 允许，用 span_id 区分 |
| input/output 含二进制数据 | 转为 Base64 字符串存储，超过 512KB 按 truncate 策略处理 |

---

## 7. 验收标准（Definition of Done）

- [ ] `spans` 表创建并建立索引（`span_id` 为主键）
- [ ] SDK `startSpan` / `endSpan` / `withSpan` / `setSpanAttribute` 可用，单元测试覆盖 ≥ 80%
- [ ] `wrap()` 和 `autoInstrument` 自动创建 Span，验证通过
- [ ] 现有 SDK `trace()` / `traceLLM()` 内部映射为 Root Span，Layer 4 回归测试通过
- [ ] 后端 API `GET /traces/:id/tree` 返回正确嵌套结构，含 `tokens` 和 `costUsd`
- [ ] 前端 Trace 详情页展示 Gantt 时间轴和 Span 树（MVP）
- [ ] Gantt 图可交互（hover、click、按 latency 排序）
- [ ] Span 详情面板强制展示 Token 消耗和预估成本
- [ ] PII 脱敏和敏感字段过滤功能可用
- [ ] 现有 traces 数据零丢失迁移
- [ ] Layer 4 回归测试全部通过
- [ ] 性能测试：100 Span 的 Trace 树查询 < 200ms

---

## 8. 依赖关系

| 依赖项 | 状态 |
|-------|------|
| 现有 trace 数据模型 | ✅ 已有 |
| 前端框架（React + Tailwind） | ✅ 已有 |
| WebSocket 实时推送 | ✅ 已有（P1 扩展广播 Span 事件） |
| PostgreSQL / SQLite | ✅ 已有 |
| SDK 双写改造 | 🔄 需发版 |

---

## 9. 风险评估

| 排名 | 风险 | 概率 | 影响 | 缓解措施 |
|-----|------|------|------|---------|
| 1 | 前端火焰图工作量膨胀导致延期 | 高 | 高 | **MVP 降级为 Gantt 图**，火焰图移至 P1 |
| 2 | SDK 双写改造引入兼容性 Bug | 中 | 高 | 增加 Layer 4 回归测试覆盖旧 SDK `trace()` 方法 |
| 3 | JSONB 大字段导致查询性能下降 | 中 | 中 | 对 input/output 启用 TOAST 压缩（PostgreSQL）或分表存储 |
| 4 | 用户已有 Langfuse，迁移动力不足 | 中 | 高 | 提供差异化价值（评测联动 + 自托管轻量），规划一键导入工具 |
| 5 | Span 树并发写入导致数据不一致 | 低 | 高 | 后端 tree 查询增加循环引用检测 + 超时保护 |

---

## 10. 后续规划

| 阶段 | 内容 | 依赖 |
|-----|------|------|
| **P0-01** (当前) | Span 模型 + Gantt 可视化 | - |
| **P0-02** | LLM-as-a-Judge 评估器 | 依赖 P0-01 Span 数据 |
| **P0-03** | Dashboard 统计图表 | 依赖 P0-01 Span 数据 |
| **P1-01** | 火焰图升级 | 依赖 P0-01 前端框架 |
| **P1-02** | WebSocket 实时 Span 推送 | 依赖 P0-01 后端 API |

---

> **下一步**: 进入技术设计阶段，输出《P0-01 技术设计文档》。
