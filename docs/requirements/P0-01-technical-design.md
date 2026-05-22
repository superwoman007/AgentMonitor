# P0-01 技术设计文档：Span 级分布式追踪 + Trace 调用链可视化

> **对应需求**: P0-01-span-trace-visualization.md v1.1
> **版本**: v1.1（评审后修订版）
> **日期**: 2026-04-30
> **状态**: 评审通过，待TDD实现

---

## 1. 架构总览

### 1.1 系统边界

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AgentMonitor                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐ │
│  │   SDK-TS    │    │  SDK-Python │    │   SDK-Go    │    │  OTel    │ │
│  │  (Browser/  │    │  (sync+async│    │  (context)  │    │ Collector│ │
│  │   Node.js)  │    │  support)   │    │             │    │          │ │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └────┬─────┘ │
│         │                  │                  │                │       │
│         └──────────────────┴──────────────────┘                │       │
│                            │ HTTP POST /api/v1/traces         │       │
│                            │ HTTP POST /api/v1/spans (new)    │       │
│         ┌──────────────────┴──────────────────┐               │       │
│         ▼                                      ▼               ▼       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Fastify Backend                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │  Auth    │  │ API Key  │  │  Traces  │  │     Spans      │  │   │
│  │  │Middleware│  │Middleware│  │  Routes  │  │    Routes      │  │   │
│  │  └──────────┘  └──────────┘  └────┬─────┘  └───────┬────────┘  │   │
│  │                                   │                │            │   │
│  │  ┌────────────────────────────────┴────────────────┴────────┐   │   │
│  │  │                      Services Layer                        │   │   │
│  │  │  trace.ts (兼容层)    span.ts (新)    snapshot.ts         │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  │                                   │                             │   │
│  │  ┌────────────────────────────────┴────────────────────────┐    │   │
│  │  │                    Database Layer                         │    │   │
│  │  │   SQLite (better-sqlite3)  /  PostgreSQL (pg pool)       │    │   │
│  │  │   traces 表 ──(双写)──>  spans 表 (新)                    │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│         │                                   │                           │
│         │ WebSocket /ws                     │ REST GET /api/v1/...      │
│         ▼                                   ▼                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    React + Vite Frontend                         │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │   │
│  │  │ TraceList  │  │SpanTreeList│  │GanttChart  │  │SpanDetail │ │   │
│  │  │  (现有)    │  │  (新组件)  │  │  (新组件)  │  │ (新组件)  │ │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └───────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 设计原则

1. **向后兼容**: 现有 SDK `trace()` 方法零改动继续工作，内部自动映射为 Root Span
2. **双写过渡**: `traces` 和 `spans` 并行写入，保证历史数据零丢失
3. **最小侵入**: SDK 新增 Span API 为纯新增，不破坏现有方法签名
4. **数据库无关**: SQLite 和 PostgreSQL 使用同一套 SQL（通过 `$1, $2` 参数风格，SQLite 层自动转换）
5. **渐进增强**: MVP 只实现 Gantt 图，火焰图作为 P1 扩展点预留
6. **并发安全**: SDK `spanStack` 按 `traceId` 隔离，支持并行子 Span
7. **批量双写**: 旧 SDK `trace()` 双写 Span 数据进入 buffer 批量 flush

---

## 2. 数据库设计

### 2.1 `spans` 表（新增）

#### SQLite Schema

```sql
-- spans 表：存储 Span 级追踪数据
CREATE TABLE IF NOT EXISTS spans (
  span_id         TEXT PRIMARY KEY,           -- UUIDv4，由 SDK 生成
  trace_id        TEXT NOT NULL,              -- 所属 Trace 的 trace_id
  parent_span_id  TEXT REFERENCES spans(span_id) ON DELETE SET NULL,
  name            TEXT NOT NULL,              -- Span 名称
  trace_type      TEXT NOT NULL,              -- message / llm / tool_call / function / custom
  started_at      TEXT NOT NULL,              -- ISO 8601
  ended_at        TEXT,                       -- ISO 8601，可为 NULL（未结束）
  latency_ms      REAL,                       -- 毫秒
  input           TEXT,                       -- JSON 字符串，受 truncate 策略限制
  output          TEXT,                       -- JSON 字符串，受 truncate 策略限制
  attributes      TEXT,                       -- JSON 字符串，自定义属性
  status          TEXT NOT NULL DEFAULT 'unset', -- success / error / unset
  error           TEXT,                       -- 错误信息
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_project_id ON spans(project_id);
CREATE INDEX IF NOT EXISTS idx_spans_session_id ON spans(session_id);
CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at);
```

#### PostgreSQL Schema

```sql
-- spans 表：与 SQLite 逻辑一致，类型更精确
CREATE TABLE IF NOT EXISTS spans (
  span_id         UUID PRIMARY KEY,
  trace_id        UUID NOT NULL,
  parent_span_id  UUID REFERENCES spans(span_id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  trace_type      TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  latency_ms      DOUBLE PRECISION,
  input           JSONB,
  output          JSONB,
  attributes      JSONB,
  status          TEXT NOT NULL DEFAULT 'unset',
  error           TEXT,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spans_trace_id ON spans(trace_id);
CREATE INDEX idx_spans_parent_span_id ON spans(parent_span_id);
CREATE INDEX idx_spans_project_id ON spans(project_id);
CREATE INDEX idx_spans_session_id ON spans(session_id);
CREATE INDEX idx_spans_started_at ON spans(started_at);
```

> **关键设计决策**:
> - `span_id` 为主键，无冗余 `id` 字段（响应评审意见）
> - `trace_id` 不建外键约束（trace_id 可能来自外部 OTel Collector，不一定在本地 traces 表中）
> - `input`/`output`/`attributes` 在 SQLite 中用 TEXT 存 JSON 字符串，PostgreSQL 用 JSONB

### 2.2 `traces` 表兼容（不变更结构）

现有 `traces` 表继续使用，不删除字段。`createTrace` 服务同时写入 `traces` 和 `spans`。

### 2.3 Migration 策略

#### SQLite（`backend/src/db/sqlite.ts`）

在 `initSchema()` 末尾追加：

```typescript
// P0-01: spans 表迁移
if (!tableExists(db, 'spans')) {
  db.exec(`
    CREATE TABLE spans (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT REFERENCES spans(span_id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      trace_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      latency_ms REAL,
      input TEXT,
      output TEXT,
      attributes TEXT,
      status TEXT NOT NULL DEFAULT 'unset',
      error TEXT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_spans_trace_id ON spans(trace_id);
    CREATE INDEX idx_spans_parent_span_id ON spans(parent_span_id);
    CREATE INDEX idx_spans_project_id ON spans(project_id);
    CREATE INDEX idx_spans_session_id ON spans(session_id);
    CREATE INDEX idx_spans_started_at ON spans(started_at);
  `);
}

// P0-01: 历史 traces 数据迁移到 spans（幂等，只执行一次）
const migrationMarker = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migration_p001_spans'"
).get();
if (!migrationMarker) {
  db.exec(`
    INSERT OR IGNORE INTO spans (
      span_id, trace_id, parent_span_id, name, trace_type,
      started_at, ended_at, latency_ms, input, output, attributes,
      status, error, project_id, session_id
    )
    SELECT
      COALESCE(span_id, id) as span_id,
      COALESCE(trace_id, id) as trace_id,
      COALESCE(parent_span_id, parent_trace_id) as parent_span_id,
      name, trace_type, started_at, ended_at, latency_ms,
      input, output, metadata as attributes,
      COALESCE(status, 'success') as status, error, project_id, session_id
    FROM traces
    WHERE span_id IS NOT NULL OR trace_id IS NOT NULL;
  `);
  db.exec(`CREATE TABLE _migration_p001_spans (completed_at TEXT DEFAULT (datetime('now')))`);
}
```

#### PostgreSQL（`backend/migrations/005_spans.sql`）

```sql
-- Migration: 005_spans.sql
-- P0-01: Span 级分布式追踪

CREATE TABLE IF NOT EXISTS spans (
  span_id         UUID PRIMARY KEY,
  trace_id        UUID NOT NULL,
  parent_span_id  UUID REFERENCES spans(span_id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  trace_type      TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  latency_ms      DOUBLE PRECISION,
  input           JSONB,
  output          JSONB,
  attributes      JSONB,
  status          TEXT NOT NULL DEFAULT 'unset',
  error           TEXT,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_project_id ON spans(project_id);
CREATE INDEX IF NOT EXISTS idx_spans_session_id ON spans(session_id);
CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at);

-- 历史数据迁移：将已有 trace_id/span_id 的 traces 复制到 spans
INSERT INTO spans (
  span_id, trace_id, parent_span_id, name, trace_type,
  started_at, ended_at, latency_ms, input, output, attributes,
  status, error, project_id, session_id
)
SELECT
  COALESCE(span_id::uuid, id::uuid) as span_id,
  COALESCE(trace_id::uuid, id::uuid) as trace_id,
  COALESCE(parent_span_id::uuid, parent_trace_id::uuid) as parent_span_id,
  name, trace_type, started_at, ended_at, latency_ms,
  input::jsonb, output::jsonb, metadata::jsonb,
  COALESCE(status, 'success') as status, error, project_id, session_id
FROM traces
WHERE span_id IS NOT NULL OR trace_id IS NOT NULL
ON CONFLICT (span_id) DO NOTHING;
```

> **注意**: PostgreSQL 迁移需要 `postgres-migrate.ts` 支持按数字顺序执行 migration 文件。当前只有一个 `004_decisions.sql`，新增 `005_spans.sql` 即可。

---

## 3. 后端设计

### 3.1 目录结构（新增/修改）

```
backend/src/
├── services/
│   ├── trace.ts          # 现有，追加双写逻辑
│   ├── span.ts           # 新增：Span CRUD + Tree 查询
│   └── snapshot.ts       # 现有，无需修改
├── routes/
│   ├── traces.ts         # 现有，追加 GET /:id/tree（从 span 服务查询）
│   └── spans.ts          # 新增：POST /spans（内部/SDK 使用）
├── middleware/
│   └── sanitize.ts       # 新增：敏感字段过滤中间件
└── utils/
    └── truncate.ts       # 新增：数据截断工具
```

### 3.2 `span.ts` Service（核心新增）

```typescript
// backend/src/services/span.ts
import { query, queryOne, run } from '../db/index.js';
import { sanitizeData } from '../middleware/sanitize.js';
import { truncateJson } from '../utils/truncate.js';

export interface Span {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  trace_type: string;
  started_at: Date;
  ended_at: Date | null;
  latency_ms: number | null;
  input: unknown;
  output: unknown | null;
  attributes: unknown | null;
  status: string;
  error: string | null;
  project_id: string;
  session_id: string | null;
  created_at: Date;
}

export interface SpanInput {
  spanId: string;
  traceId: string;
  parentSpanId?: string | null;
  name: string;
  traceType: string;
  startedAt: Date;
  endedAt?: Date;
  latencyMs?: number;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  status?: string;
  error?: string;
  projectId: string;
  sessionId?: string | null;
}

export interface SpanTreeNode {
  spanId: string;
  name: string;
  traceType: string;
  startedAt: string;
  endedAt: string | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  input: unknown;
  output: unknown;
  attributes: unknown;
  tokens: { prompt?: number; completion?: number; total?: number } | null;
  costUsd: number | null;
  children: SpanTreeNode[];
}

/**
 * 创建 Span（带敏感数据过滤和截断）
 */
export async function createSpan(data: SpanInput): Promise<Span> {
  // 1. 敏感数据过滤
  const safeInput = data.input ? sanitizeData(data.input) : null;
  const safeOutput = data.output ? sanitizeData(data.output) : null;
  const safeAttributes = data.attributes ? sanitizeData(data.attributes) : null;

  // 2. 大字段截断（512KB 限制）
  const truncatedInput = safeInput ? truncateJson(safeInput, 512 * 1024, 'input') : null;
  const truncatedOutput = safeOutput ? truncateJson(safeOutput, 512 * 1024, 'output') : null;

  const span = await queryOne<Span>(
    `INSERT INTO spans (
      span_id, trace_id, parent_span_id, name, trace_type,
      started_at, ended_at, latency_ms, input, output, attributes,
      status, error, project_id, session_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *`,
    [
      data.spanId,
      data.traceId,
      data.parentSpanId || null,
      data.name,
      data.traceType,
      data.startedAt.toISOString(),
      data.endedAt ? data.endedAt.toISOString() : null,
      data.latencyMs ?? null,
      truncatedInput ? JSON.stringify(truncatedInput) : null,
      truncatedOutput ? JSON.stringify(truncatedOutput) : null,
      safeAttributes ? JSON.stringify(safeAttributes) : null,
      data.status || 'unset',
      data.error || null,
      data.projectId,
      data.sessionId || null,
    ]
  );

  if (!span) throw new Error('Failed to create span');

  // 3. 解析存储的 JSON 字符串（SQLite 返回字符串，PostgreSQL 返回对象）
  return deserializeSpan(span);
}

/**
 * 按 trace_id 查询所有 Span，构建嵌套树
 * 使用递归 CTE 防止循环引用（最多 100 层）
 */
export async function getSpanTree(traceId: string): Promise<{
  rootSpan: SpanTreeNode | null;
  stats: { totalSpans: number; totalLatencyMs: number; totalTokens: any; totalCostUsd: number; errorCount: number };
} | null> {
  // 1. 获取该 trace 的所有 spans
  const spans = await query<Span>(
    `SELECT * FROM spans WHERE trace_id = $1 ORDER BY started_at ASC`,
    [traceId]
  );

  if (spans.length === 0) return null;

  // 2. 解析 JSON 字段
  const parsedSpans = spans.map(deserializeSpan);

  // 3. 构建映射表和检测循环引用
  const spanMap = new Map<string, SpanTreeNode>();
  const visited = new Set<string>();

  for (const s of parsedSpans) {
    spanMap.set(s.span_id, {
      spanId: s.span_id,
      name: s.name,
      traceType: s.trace_type,
      startedAt: s.started_at instanceof Date ? s.started_at.toISOString() : s.started_at,
      endedAt: s.ended_at instanceof Date ? s.ended_at.toISOString() : s.ended_at,
      latencyMs: s.latency_ms,
      status: s.status,
      error: s.error,
      input: s.input,
      output: s.output,
      attributes: s.attributes,
      tokens: extractTokens(s.attributes),
      costUsd: extractCost(s.attributes),
      children: [],
    });
  }

  // 4. 独立循环引用检测（基于 parent 关系图，在建树前完成）
  const cycleNodes = detectCycles(parsedSpans);

  // 5. 构建树结构
  let rootNode: SpanTreeNode | null = null;
  const orphaned: SpanTreeNode[] = [];

  for (const node of spanMap.values()) {
    const rawSpan = parsedSpans.find(s => s.span_id === node.spanId)!;
    if (cycleNodes.has(node.spanId)) {
      // 参与循环的节点视为孤儿，不加入树（避免无限递归）
      orphaned.push(node);
      continue;
    }
    if (!rawSpan.parent_span_id) {
      if (!rootNode) rootNode = node;
      else orphaned.push(node); // 多个 root，后面的视为孤儿
    } else {
      const parent = spanMap.get(rawSpan.parent_span_id);
      if (parent && !cycleNodes.has(rawSpan.parent_span_id)) {
        parent.children.push(node);
      } else {
        orphaned.push(node);
      }
    }
  }

  // 孤儿节点挂到第一个根下（如果没有根，第一个孤儿升为根）
  if (orphaned.length > 0 && rootNode) {
    rootNode.children.push(...orphaned);
  } else if (orphaned.length > 0 && !rootNode) {
    rootNode = orphaned[0];
    rootNode.children.push(...orphaned.slice(1));
  }

  // 6. 计算统计
  const stats = calculateStats(parsedSpans);

  return { rootSpan: rootNode, stats };
}

/**
 * 独立循环引用检测：基于 parent 关系图做 DFS
 * 返回参与循环的所有 span_id 集合
 */
function detectCycles(spans: Span[]): Set<string> {
  const cycleNodes = new Set<string>();
  const parentMap = new Map<string, string | null>();
  for (const s of spans) {
    parentMap.set(s.span_id, s.parent_span_id);
  }

  for (const spanId of parentMap.keys()) {
    if (cycleNodes.has(spanId)) continue;
    const visited = new Set<string>();
    let current: string | null = spanId;
    let depth = 0;
    while (current && depth <= 100) {
      if (visited.has(current)) {
        // 发现循环，将环上所有节点标记
        const cycleStart = current;
        const cycle = new Set<string>();
        do {
          cycle.add(current);
          current = parentMap.get(current) || null;
        } while (current && current !== cycleStart && cycle.size < 100);
        for (const id of cycle) cycleNodes.add(id);
        break;
      }
      visited.add(current);
      current = parentMap.get(current) || null;
      depth++;
    }
    if (depth > 100) {
      // 超过 100 层视为异常，将当前链所有节点标记
      for (const id of visited) cycleNodes.add(id);
    }
  }
  return cycleNodes;
}

function extractTokens(attrs: unknown): { prompt?: number; completion?: number; total?: number } | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const a = attrs as Record<string, unknown>;
  const prompt = a.tokens_prompt ?? a.prompt_tokens ?? a.tokens?.prompt;
  const completion = a.tokens_completion ?? a.completion_tokens ?? a.tokens?.completion;
  const total = a.tokens_total ?? a.total_tokens ?? a.tokens?.total;
  if (prompt === undefined && completion === undefined && total === undefined) return null;
  return {
    prompt: typeof prompt === 'number' ? prompt : undefined,
    completion: typeof completion === 'number' ? completion : undefined,
    total: typeof total === 'number' ? total : undefined,
  };
}

function extractCost(attrs: unknown): number | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const a = attrs as Record<string, unknown>;
  const cost = a.cost_usd ?? a.costUsd ?? a.cost;
  return typeof cost === 'number' ? cost : null;
}

function calculateStats(spans: Span[]): {
  totalSpans: number;
  totalLatencyMs: number;
  totalTokens: { prompt: number; completion: number; total: number };
  totalCostUsd: number;
  errorCount: number;
} {
  let totalLatency = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let errors = 0;

  for (const s of spans) {
    if (s.latency_ms) totalLatency += s.latency_ms;
    if (s.status === 'error') errors++;
    const tokens = extractTokens(s.attributes);
    if (tokens) {
      if (tokens.prompt) promptTokens += tokens.prompt;
      if (tokens.completion) completionTokens += tokens.completion;
      if (tokens.total) totalTokens += tokens.total;
    }
    const cost = extractCost(s.attributes);
    if (cost) totalCost += cost;
  }

  return {
    totalSpans: spans.length,
    totalLatencyMs: totalLatency,
    totalTokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
    totalCostUsd: totalCost,
    errorCount: errors,
  };
}

function deserializeSpan(span: Span): Span {
  return {
    ...span,
    input: parseJsonField(span.input),
    output: parseJsonField(span.output),
    attributes: parseJsonField(span.attributes),
  };
}

function parseJsonField(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value; // PostgreSQL JSONB 已解析
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
```

### 3.3 `traces.ts` Service 修改（双写）

在 `createTrace()` 末尾追加 `spans` 表写入：

```typescript
// backend/src/services/trace.ts
import { createSpan } from './span.js';

export async function createTrace(data: TraceInput): Promise<Trace> {
  // ... 现有 createTrace 逻辑不变 ...
  const trace = await queryOne<Trace>(...);
  
  // P0-01: 双写 spans 表
  if (trace) {
    try {
      await createSpan({
        spanId: data.spanId || trace.id,
        traceId: data.traceId || trace.id,
        parentSpanId: data.parentSpanId || data.parentTraceId || null,
        name: data.name,
        traceType: data.traceType,
        startedAt: data.startedAt,
        endedAt: data.endedAt,
        latencyMs: data.latencyMs,
        input: data.input,
        output: data.output,
        attributes: data.metadata as Record<string, unknown> | undefined,
        status: trace.status,
        error: data.error,
        projectId: data.projectId,
        sessionId: data.sessionId || null,
      });
    } catch (spanError) {
      // 双写失败不影响 traces 表写入，记录日志即可
      console.warn('[createTrace] Failed to write span:', spanError);
    }
  }
  
  return trace!;
}
```

### 3.4 `traces.ts` Route 修改

将 `GET /:id/tree` 的实现从 `getTraceTree`（旧，只查一级 children）替换为新的 `getSpanTree`：

```typescript
// backend/src/routes/traces.ts
import { getSpanTree } from '../services/span.js';

// 替换现有 GET /:id/tree
app.get('/:id/tree', { preHandler: authMiddleware }, async (request, reply) => {
  if (!request.userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  
  const params = request.params as { id: string };
  
  // 1. 先查 trace 基础信息（权限校验）
  const trace = await getTraceById(params.id);
  if (!trace) {
    reply.code(404).send({ error: 'Trace not found' });
    return;
  }
  
  const project = await getProjectById(trace.project_id);
  if (!project || project.user_id !== request.userId) {
    reply.code(404).send({ error: 'Trace not found' });
    return;
  }
  
  // 2. 从 spans 表查询完整的嵌套树
  const tree = await getSpanTree(trace.trace_id || trace.id);
  
  if (!tree || !tree.rootSpan) {
    // 降级：如果 spans 表没有数据，返回旧的扁平结构
    const oldTree = await getTraceTree(params.id);
    reply.send({ 
      trace: oldTree?.trace,
      spans: oldTree?.children || [],
      stats: { totalSpans: oldTree?.children.length || 0, totalLatencyMs: 0, totalTokens: { prompt: 0, completion: 0, total: 0 }, totalCostUsd: 0, errorCount: 0 },
      _fallback: true,
    });
    return;
  }
  
  reply.send({
    trace: {
      id: trace.id,
      traceId: trace.trace_id || trace.id,
      name: trace.name,
      startedAt: trace.started_at,
      endedAt: trace.ended_at,
      latencyMs: trace.latency_ms,
      status: trace.status,
    },
    spans: [tree.rootSpan], // 根节点包装为数组
    stats: tree.stats,
  });
});
```

### 3.5 `spans.ts` Route（新增）

```typescript
// backend/src/routes/spans.ts
import { FastifyInstance } from 'fastify';
import { createSpan, getSpanTree } from '../services/span.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function spansRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/spans - 创建 Span（SDK 直接调用）
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }

    const body = request.body as {
      traceId: string;
      parentSpanId?: string | null;
      spanId: string;
      name: string;
      traceType: string;
      startedAt: string;
      endedAt?: string;
      latencyMs?: number;
      input?: unknown;
      output?: unknown;
      attributes?: Record<string, unknown>;
      status?: string;
      error?: string;
      sessionId?: string;
    };

    if (!body.traceId || !body.spanId || !body.name || !body.traceType) {
      reply.code(400).send({ error: 'traceId, spanId, name, traceType are required' });
      return;
    }

    const span = await createSpan({
      projectId: request.projectId,
      spanId: body.spanId,
      traceId: body.traceId,
      parentSpanId: body.parentSpanId,
      name: body.name,
      traceType: body.traceType,
      startedAt: new Date(body.startedAt),
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      latencyMs: body.latencyMs,
      input: body.input,
      output: body.output,
      attributes: body.attributes,
      status: body.status,
      error: body.error,
      sessionId: body.sessionId,
    });

    reply.code(201).send({ span });
  });

  // GET /api/v1/spans/:spanId/raw - 下载未截断的原始数据
  app.get('/:spanId/raw', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { spanId: string };
    // TODO: 实现从 spans 表查询并返回原始数据
    // 当前版本返回 501，P1 实现完整 raw 数据存储
    reply.code(501).send({ error: 'Raw data export not yet implemented' });
  });
}
```

### 3.6 新增工具模块

```typescript
// backend/src/utils/truncate.ts
const MAX_TOTAL_SIZE = 512 * 1024; // 512KB

function getByteLength(str: string): number {
  // 兼容浏览器和 Node.js（Buffer 在 browser 不可用）
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(str, 'utf8');
  }
  return new TextEncoder().encode(str).length;
}

export function truncateJson(data: unknown, maxBytes: number = MAX_TOTAL_SIZE, fieldName: string): unknown {
  const str = JSON.stringify(data);
  if (getByteLength(str) <= maxBytes) return data;

  if (typeof data === 'string') {
    // 字符串：保留前 10000 字符
    const truncated = data.slice(0, 10000);
    return `${truncated}... [truncated, total: ${data.length} chars]`;
  }

  if (Array.isArray(data)) {
    const result: unknown[] = [];
    let currentSize = 0;
    for (let i = 0; i < data.length; i++) {
      const itemStr = JSON.stringify(data[i]);
      if (currentSize + getByteLength(itemStr) > maxBytes || i >= 50) {
        result.push({ _truncated: true, total: data.length });
        break;
      }
      result.push(data[i]);
      currentSize += getByteLength(itemStr);
    }
    return result;
  }

  if (typeof data === 'object' && data !== null) {
    const result: Record<string, unknown> = {};
    let currentSize = 0;
    const entries = Object.entries(data);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const entryStr = JSON.stringify({ [key]: value });
      if (currentSize + getByteLength(entryStr) > maxBytes || i >= 50) {
        result._truncated = true;
        result._total = entries.length;
        break;
      }
      result[key] = value;
      currentSize += getByteLength(entryStr);
    }
    return result;
  }

  return data;
}
```

```typescript
// backend/src/middleware/sanitize.ts
const DEFAULT_SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'api_key', 'apikey', 'authorization',
  'cookie', 'credit_card', 'ssn', 'social_security', 'private_key',
];

export function sanitizeData(data: unknown, sensitiveKeys?: string[]): unknown {
  const keys = sensitiveKeys || DEFAULT_SENSITIVE_KEYS;
  return sanitizeValue(data, keys);
}

function sanitizeValue(value: unknown, keys: string[]): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // PII 脱敏：邮箱、手机号
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map(v => sanitizeValue(v, keys));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (keys.some(sk => lowerKey.includes(sk))) {
        result[key] = '[FILTERED]';
      } else {
        result[key] = sanitizeValue(val, keys);
      }
    }
    return result;
  }

  return value;
}

function sanitizeString(str: string): string {
  // 邮箱脱敏
  str = str.replace(/[\w.-]+@[\w.-]+\.\w+/g, (match) => {
    const [local, domain] = match.split('@');
    return `${local.slice(0, 2)}***@${domain.slice(0, 2)}***`;
  });
  // 手机号脱敏（中国大陆）
  str = str.replace(/1[3-9]\d{9}/g, (match) => {
    return `${match.slice(0, 3)}****${match.slice(-4)}`;
  });
  // 信用卡号脱敏
  str = str.replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[REDACTED]');
  return str;
}
```

---

## 4. SDK 设计

### 4.1 TypeScript SDK（`sdk/src/index.ts`）

#### 新增类型

```typescript
// sdk/src/types.ts（追加）
export interface SpanContext {
  spanId: string;
  traceId: string;
  name: string;
  startTime: number; // Date.now()
}

export interface SpanOptions {
  name: string;
  traceType?: string;
  parentSpanId?: string;
  traceId?: string;
  attributes?: Record<string, unknown>;
}
```

#### SDKConfig 扩展（新增配置项）

```typescript
interface SDKConfig {
  // ... 现有配置 ...
  
  /**
   * P0-01: 控制旧 SDK trace() 是否双写 spans 表
   * - true / undefined: 双写（默认）
   * - false: 只写 traces 表（旧行为，零性能影响）
   * 适用场景：旧用户升级 SDK 但暂不需要 Span 功能时
   */
  enableSpanWrite?: boolean;
}
```

#### AgentMonitor 类新增方法

```typescript
// sdk/src/index.ts（AgentMonitor 类内部）

// ── Span 上下文栈（按 traceId 隔离，支持并发子 Span）──
private spanStack: Map<string, SpanContext[]> = new Map();
private readonly MAX_SPAN_STACK_SIZE = 1000; // 防止内存泄漏

/**
 * 创建新 Trace（含 Root Span）
 */
startTrace(name: string, options?: { traceId?: string; attributes?: Record<string, unknown>; sessionId?: string }): SpanContext {
  const traceId = options?.traceId || crypto.randomUUID();
  const spanId = crypto.randomUUID();
  const context: SpanContext = {
    spanId,
    traceId,
    name,
    startTime: Date.now(),
  };

  // 上报 Root Span（started，未结束）进入 buffer 批量发送
  this.bufferSpan({
    traceId,
    spanId,
    parentSpanId: null,
    name,
    traceType: 'trace',
    startedAt: new Date().toISOString(),
    attributes: options?.attributes,
    sessionId: options?.sessionId || this.currentSessionId,
    status: 'unset',
  });

  const stack = this.spanStack.get(traceId) || [];
  stack.push(context);
  this.spanStack.set(traceId, stack);
  this.maybeCleanupSpanStack();
  return context;
}

/**
 * 结束 Trace
 */
endTrace(traceId: string, options?: { status?: 'success' | 'error'; error?: string }): void {
  const stack = this.spanStack.get(traceId);
  const span = stack?.[stack.length - 1];
  if (!span) return;

  const endedAt = new Date().toISOString();
  const latencyMs = Date.now() - span.startTime;

  this.bufferSpan({
    traceId,
    spanId: span.spanId,
    name: span.name,
    traceType: 'trace',
    startedAt: new Date(span.startTime).toISOString(),
    endedAt,
    latencyMs,
    status: options?.status || 'success',
    error: options?.error,
  });

  const newStack = stack.filter(s => s.spanId !== span.spanId);
  if (newStack.length === 0) this.spanStack.delete(traceId);
  else this.spanStack.set(traceId, newStack);
}

/**
 * 创建子 Span
 */
startSpan(name: string, options?: SpanOptions): SpanContext {
  const traceId = options?.traceId || this.getCurrentTraceId() || crypto.randomUUID();
  const stack = this.spanStack.get(traceId) || [];
  const parentSpanId = options?.parentSpanId || stack[stack.length - 1]?.spanId || null;
  const spanId = crypto.randomUUID();

  const context: SpanContext = {
    spanId,
    traceId,
    name,
    startTime: Date.now(),
  };

  this.bufferSpan({
    traceId,
    spanId,
    parentSpanId,
    name,
    traceType: options?.traceType || 'custom',
    startedAt: new Date().toISOString(),
    attributes: options?.attributes,
    sessionId: this.currentSessionId,
    status: 'unset',
  });

  stack.push(context);
  this.spanStack.set(traceId, stack);
  this.maybeCleanupSpanStack();
  return context;
}

/**
 * 结束 Span
 */
endSpan(spanContext: SpanContext, options?: { status?: 'success' | 'error'; error?: string; output?: unknown }): void {
  const endedAt = new Date().toISOString();
  const latencyMs = Date.now() - spanContext.startTime;

  this.bufferSpan({
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    name: spanContext.name,
    traceType: 'custom',
    startedAt: new Date(spanContext.startTime).toISOString(),
    endedAt,
    latencyMs,
    output: options?.output,
    status: options?.status || 'success',
    error: options?.error,
  });

  const stack = this.spanStack.get(spanContext.traceId) || [];
  const newStack = stack.filter(s => s.spanId !== spanContext.spanId);
  if (newStack.length === 0) this.spanStack.delete(spanContext.traceId);
  else this.spanStack.set(spanContext.traceId, newStack);
}

/**
 * 设置 Span 属性（增量更新，通过 attributes 合并）
 */
setSpanAttribute(spanContext: SpanContext, key: string, value: unknown): void {
  this.setSpanAttributes(spanContext, { [key]: value });
}

setSpanAttributes(spanContext: SpanContext, attributes: Record<string, unknown>): void {
  // MVP 简化：属性在 SDK 层缓存，随 endSpan 时一次性上报
  // 不单独发送 PATCH 请求，避免后端更新逻辑复杂度
  const stack = this.spanStack.get(spanContext.traceId) || [];
  const span = stack.find(s => s.spanId === spanContext.spanId);
  if (span) {
    (span as any).pendingAttributes = { ...(span as any).pendingAttributes, ...attributes };
  }
}

/**
 * withSpan 便捷方法：自动包裹函数
 */
async withSpan<T>(name: string, fn: (span: SpanContext) => Promise<T>, options?: SpanOptions): Promise<T> {
  const span = this.startSpan(name, options);
  try {
    const result = await fn(span);
    this.endSpan(span, { status: 'success', output: result });
    return result;
  } catch (error) {
    this.endSpan(span, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * 内部：发送 Span 数据到后端
 */
/**
 * 将 Span 数据加入 buffer，随 flush() 批量发送
 * 旧 SDK trace() 的双写 Span 也走此路径，不单独发请求
 */
private bufferSpan(data: {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  traceType: string;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  status?: string;
  error?: string;
  sessionId?: string;
}): void {
  if (this.config.disabled || this.config.enableSpanWrite === false) return;
  this.buffer.push({ type: 'span', data });
  this.maybeFlush();
}

private getCurrentTraceId(): string | undefined {
  // 返回最近活跃的 traceId（Map 中最后一个 key）
  const keys = Array.from(this.spanStack.keys());
  return keys[keys.length - 1];
}

/**
 * 防止 spanStack 内存泄漏：超过 MAX_SPAN_STACK_SIZE 时清理最早的 unset Span
 */
private maybeCleanupSpanStack(): void {
  let total = 0;
  for (const stack of this.spanStack.values()) total += stack.length;
  if (total <= this.MAX_SPAN_STACK_SIZE) return;

  // 清理最早加入的 trace 中的所有 Span
  const firstKey = this.spanStack.keys().next().value;
  if (firstKey) {
    const stack = this.spanStack.get(firstKey) || [];
    for (const span of stack) {
      this.bufferSpan({
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        traceType: 'custom',
        startedAt: new Date(span.startTime).toISOString(),
        endedAt: new Date().toISOString(),
        status: 'error',
        error: 'Span auto-closed due to max stack size exceeded',
      });
    }
    this.spanStack.delete(firstKey);
  }
}

/**
 * close() 时自动结束未关闭的 Span
 */
close(): void {
  // 自动结束所有未关闭的 Span
  for (const [traceId, stack] of this.spanStack) {
    for (const span of [...stack]) {
      this.bufferSpan({
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        traceType: 'custom',
        startedAt: new Date(span.startTime).toISOString(),
        endedAt: new Date().toISOString(),
        status: 'error',
        error: 'Span auto-closed on monitor.close()',
      });
    }
  }
  this.spanStack.clear();

  if (this.flushTimer) {
    clearInterval(this.flushTimer);
  }
  if (this.retryTimer) {
    clearTimeout(this.retryTimer);
  }
  this.flush();
}
```

#### 现有 `trace()` 方法改造（双写兼容）

```typescript
// 修改现有 trace() 方法，在 buffer trace 后同时 buffer Span（双写）
trace(data: TraceData): Promise<void> {
  // ... 现有采样逻辑 ...

  const enrichedData: TraceData = { ... };
  this.buffer.push({ type: 'trace', data: enrichedData });

  // P0-01: 同时作为 Root Span 写入 spans 表（走 buffer 批量发送，不单独 HTTP）
  if (this.config.enableSpanWrite !== false) {
    const traceId = enrichedData.traceId || crypto.randomUUID();
    const spanId = enrichedData.spanId || crypto.randomUUID();
    this.buffer.push({
      type: 'span',
      data: {
        traceId,
        spanId,
        parentSpanId: null,
        name: enrichedData.name || 'trace',
        traceType: enrichedData.traceType,
        startedAt: enrichedData.startedAt || new Date().toISOString(),
        endedAt: enrichedData.endedAt,
        latencyMs: enrichedData.latencyMs,
        input: enrichedData.input,
        output: enrichedData.output,
        attributes: enrichedData.metadata as Record<string, unknown>,
        status: enrichedData.status,
        error: enrichedData.error,
        sessionId: enrichedData.sessionId,
      }
    });
  }

  this.maybeFlush();
}
```

### 4.2 Python SDK（`sdk-python/`）

```python
# sdk-python/agentmonitor/client.py（新增方法）

class AgentMonitor:
    def __init__(self, api_key: str, base_url: str = "http://localhost:3000"):
        self.api_key = api_key
        self.base_url = base_url
        self._span_stack: List[SpanContext] = []
    
    def start_trace(self, name: str, trace_id: Optional[str] = None, 
                    attributes: Optional[Dict] = None) -> SpanContext:
        trace_id = trace_id or str(uuid.uuid4())
        span_id = str(uuid.uuid4())
        ctx = SpanContext(span_id=span_id, trace_id=trace_id, name=name, start_time=time.time())
        self._send_span({
            "traceId": trace_id,
            "spanId": span_id,
            "parentSpanId": None,
            "name": name,
            "traceType": "trace",
            "startedAt": datetime.utcnow().isoformat(),
            "attributes": attributes,
            "status": "unset",
        })
        self._span_stack.append(ctx)
        return ctx
    
    def end_trace(self, trace_id: str, status: str = "success", error: Optional[str] = None):
        span = next((s for s in self._span_stack if s.trace_id == trace_id), None)
        if not span:
            return
        latency_ms = int((time.time() - span.start_time) * 1000)
        self._send_span({
            "traceId": trace_id,
            "spanId": span.span_id,
            "name": span.name,
            "traceType": "trace",
            "startedAt": datetime.fromtimestamp(span.start_time).isoformat(),
            "endedAt": datetime.utcnow().isoformat(),
            "latencyMs": latency_ms,
            "status": status,
            "error": error,
        })
        self._span_stack = [s for s in self._span_stack if s.trace_id != trace_id]
    
    def start_span(self, name: str, trace_type: str = "custom",
                   parent_span_id: Optional[str] = None,
                   trace_id: Optional[str] = None,
                   attributes: Optional[Dict] = None) -> SpanContext:
        trace_id = trace_id or (self._span_stack[-1].trace_id if self._span_stack else str(uuid.uuid4()))
        parent_span_id = parent_span_id or (self._span_stack[-1].span_id if self._span_stack else None)
        span_id = str(uuid.uuid4())
        ctx = SpanContext(span_id=span_id, trace_id=trace_id, name=name, start_time=time.time())
        self._send_span({
            "traceId": trace_id,
            "spanId": span_id,
            "parentSpanId": parent_span_id,
            "name": name,
            "traceType": trace_type,
            "startedAt": datetime.utcnow().isoformat(),
            "attributes": attributes,
            "status": "unset",
        })
        self._span_stack.append(ctx)
        return ctx
    
    def end_span(self, span_context: SpanContext, status: str = "success",
                 error: Optional[str] = None, output: Optional[Any] = None):
        latency_ms = int((time.time() - span_context.start_time) * 1000)
        self._send_span({
            "traceId": span_context.trace_id,
            "spanId": span_context.span_id,
            "name": span_context.name,
            "traceType": "custom",
            "startedAt": datetime.fromtimestamp(span_context.start_time).isoformat(),
            "endedAt": datetime.utcnow().isoformat(),
            "latencyMs": latency_ms,
            "output": output,
            "status": status,
            "error": error,
        })
        self._span_stack = [s for s in self._span_stack if s.span_id != span_context.span_id]
    
    def with_span(self, name: str, trace_type: str = "custom"):
        """上下文管理器版本"""
        return _SpanContextManager(self, name, trace_type)
    
    def _send_span(self, data: Dict):
        try:
            requests.post(
                f"{self.base_url}/api/v1/spans",
                headers={"Content-Type": "application/json", "X-API-Key": self.api_key},
                json=data,
                timeout=5,
            )
        except Exception as e:
            print(f"[AgentMonitor] Failed to send span: {e}")

class _SpanContextManager:
    def __init__(self, monitor: AgentMonitor, name: str, trace_type: str):
        self.monitor = monitor
        self.name = name
        self.trace_type = trace_type
        self.span = None
    
    def __enter__(self):
        self.span = self.monitor.start_span(self.name, self.trace_type)
        return self.span
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_val:
            self.monitor.end_span(self.span, status="error", error=str(exc_val))
        else:
            self.monitor.end_span(self.span, status="success")
        return False
```

### 4.3 Go SDK（`sdk-go/`）

```go
// sdk-go/agentmonitor/span.go（新增文件）

package agentmonitor

import (
	"context"
	"time"
)

type SpanContext struct {
	SpanID    string
	TraceID   string
	Name      string
	StartTime time.Time
}

func (c *Client) StartTrace(ctx context.Context, name string, opts ...TraceOption) (*SpanContext, error) {
	traceID := generateUUID()
	spanID := generateUUID()
	
	span := &SpanContext{
		SpanID:    spanID,
		TraceID:   traceID,
		Name:      name,
		StartTime: time.Now(),
	}
	
	// 上报 Root Span
	c.sendSpan(SpanPayload{
		TraceID:     traceID,
		SpanID:      spanID,
		Name:        name,
		TraceType:   "trace",
		StartedAt:   time.Now(),
		Status:      "unset",
	})
	
	c.spanStack = append(c.spanStack, span)
	return span, nil
}

func (c *Client) EndSpan(ctx context.Context, span *SpanContext, status string, errorMsg string) error {
	latencyMs := time.Since(span.StartTime).Milliseconds()
	
	c.sendSpan(SpanPayload{
		TraceID:   span.TraceID,
		SpanID:    span.SpanID,
		Name:      span.Name,
		TraceType: "custom",
		StartedAt: span.StartTime,
		EndedAt:   time.Now(),
		LatencyMs: int(latencyMs),
		Status:    status,
		Error:     errorMsg,
	})
	
	// 从栈中移除
	for i, s := range c.spanStack {
		if s.SpanID == span.SpanID {
			c.spanStack = append(c.spanStack[:i], c.spanStack[i+1:]...)
			break
		}
	}
	return nil
}

func (c *Client) WithSpan(ctx context.Context, name string, fn func(ctx context.Context, span *SpanContext) error) error {
	span, err := c.StartSpan(ctx, name)
	if err != nil {
		return err
	}
	defer func() {
		if r := recover(); r != nil {
			c.EndSpan(ctx, span, "error", fmt.Sprintf("panic: %v", r))
			panic(r)
		}
	}()
	
	if err := fn(ctx, span); err != nil {
		c.EndSpan(ctx, span, "error", err.Error())
		return err
	}
	
	c.EndSpan(ctx, span, "success", "")
	return nil
}
```

---

## 5. 前端设计

### 5.1 组件拆分

```
frontend/src/components/trace/
├── TraceDetailPage.tsx       # Trace 详情页（整合所有子组件）
├── SpanTreeList.tsx          # 左侧：Span 树状列表（可折叠）
├── GanttChart.tsx            # 中间/上方：Gantt 时间轴
├── SpanDetailPanel.tsx       # 右侧：Span 详情面板
├── SpanBar.tsx               # Gantt 图单个条形（颜色+宽度+hover）
└── useSpanTree.ts            # 自定义 Hook：查询 /tree API
```

### 5.2 `TraceDetailPage.tsx`

```tsx
// 整合布局：顶部信息栏 + Gantt 图 + 左右分栏（树 + 详情）
export function TraceDetailPage({ traceId }: { traceId: string }) {
  const { tree, loading, error } = useSpanTree(traceId);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [sortByLatency, setSortByLatency] = useState(false);

  const selectedSpan = useMemo(() => {
    if (!tree || !selectedSpanId) return null;
    return findSpanInTree(tree.spans[0], selectedSpanId);
  }, [tree, selectedSpanId]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!tree) return <EmptyState />;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部信息栏 */}
      <TraceHeader trace={tree.trace} stats={tree.stats} />

      {/* Gantt 时间轴 */}
      <div className="h-64 border-b">
        <GanttChart
          spans={tree.spans}
          selectedSpanId={selectedSpanId}
          onSelectSpan={setSelectedSpanId}
          sortByLatency={sortByLatency}
        />
      </div>

      {/* 下方：树列表 + 详情面板 */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/3 border-r overflow-auto">
          <SpanTreeList
            spans={tree.spans}
            selectedSpanId={selectedSpanId}
            onSelectSpan={setSelectedSpanId}
            sortByLatency={sortByLatency}
            onToggleSort={() => setSortByLatency(!sortByLatency)}
          />
        </div>
        <div className="w-2/3 overflow-auto">
          <SpanDetailPanel span={selectedSpan} />
        </div>
      </div>
    </div>
  );
}
```

### 5.3 `GanttChart.tsx`

```tsx
// 核心实现思路：
// 1. 计算整个 Trace 的时间范围（min startedAt ~ max endedAt）
// 2. 每个 Span 的 left% = (span.startedAt - traceStart) / totalDuration * 100
// 3. 每个 Span 的 width% = span.latencyMs / totalDuration * 100
// 4. Y 轴按层级/顺序排列，使用 flex column
// 5. 颜色根据 status：success=green, error=red, unset=gray
// 6. Hover 显示 Tooltip

interface GanttChartProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  sortByLatency: boolean;
}

export function GanttChart({ spans, selectedSpanId, onSelectSpan, sortByLatency }: GanttChartProps) {
  const { flatSpans, traceStart, traceEnd } = useMemo(() => {
    const flat = flattenSpans(spans);
    if (sortByLatency) flat.sort((a, b) => (b.latencyMs || 0) - (a.latencyMs || 0));
    const start = Math.min(...flat.map(s => new Date(s.startedAt).getTime()));
    const end = Math.max(...flat.map(s => new Date(s.endedAt || s.startedAt).getTime() + (s.latencyMs || 0)));
    return { flatSpans: flat, traceStart: start, traceEnd: end };
  }, [spans, sortByLatency]);

  const totalDuration = traceEnd - traceStart;

  return (
    <div className="relative h-full overflow-auto">
      {/* 时间轴刻度 */}
      <div className="sticky top-0 h-6 border-b bg-gray-50 flex text-xs text-gray-500">
        {generateTicks(traceStart, traceEnd).map(tick => (
          <div key={tick.time} className="absolute" style={{ left: `${tick.percent}%` }}>
            {tick.label}
          </div>
        ))}
      </div>

      {/* Span 条形 */}
      <div className="pt-2 space-y-1">
        {flatSpans.map(span => {
          const startOffset = new Date(span.startedAt).getTime() - traceStart;
          const left = (startOffset / totalDuration) * 100;
          const width = totalDuration > 0 ? ((span.latencyMs || 0) / totalDuration) * 100 : 0;

          return (
            <div key={span.spanId} className="relative h-6 flex items-center">
              {/* 缩进指示 */}
              <div style={{ width: `${span.depth * 20}px` }} />
              
              {/* 条形 */}
              <div
                className={`absolute h-4 rounded cursor-pointer transition-all hover:opacity-80 ${
                  span.status === 'error' ? 'bg-red-500' :
                  span.status === 'success' ? 'bg-green-500' : 'bg-gray-400'
                } ${selectedSpanId === span.spanId ? 'ring-2 ring-blue-400' : ''}`}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                onClick={() => onSelectSpan(span.spanId)}
                title={`${span.name} (${span.latencyMs}ms)`}
              />
              
              {/* 名称标签（条形右侧或内部） */}
              <span className="ml-2 text-xs text-gray-600 truncate" style={{ marginLeft: `calc(${left}% + ${Math.max(width, 0.5)}% + 4px)` }}>
                {span.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### 5.4 `SpanTreeList.tsx`

```tsx
// 可折叠的树状列表，类似文件浏览器
// 支持：展开/折叠、按 latency 排序、选中高亮

interface SpanTreeListProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  sortByLatency: boolean;
  onToggleSort: () => void;
}

export function SpanTreeList({ spans, selectedSpanId, onSelectSpan, sortByLatency, onToggleSort }: SpanTreeListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (spanId: string) => {
    const next = new Set(expandedIds);
    if (next.has(spanId)) next.delete(spanId);
    else next.add(spanId);
    setExpandedIds(next);
  };

  return (
    <div className="p-2">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium">Span Tree</span>
        <button onClick={onToggleSort} className="text-xs text-blue-600">
          {sortByLatency ? 'Sort: Time' : 'Sort: Latency'}
        </button>
      </div>
      {spans.map(span => (
        <TreeNode
          key={span.spanId}
          span={span}
          depth={0}
          expandedIds={expandedIds}
          selectedSpanId={selectedSpanId}
          onSelect={onSelectSpan}
          onToggle={toggleExpand}
        />
      ))}
    </div>
  );
}

function TreeNode({ span, depth, expandedIds, selectedSpanId, onSelect, onToggle }: TreeNodeProps) {
  const isExpanded = expandedIds.has(span.spanId);
  const hasChildren = span.children && span.children.length > 0;
  const isSelected = selectedSpanId === span.spanId;

  return (
    <div>
      <div
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-gray-100 rounded ${
          isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(span.spanId)}
      >
        {hasChildren && (
          <button onClick={(e) => { e.stopPropagation(); onToggle(span.spanId); }} className="mr-1 w-4">
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        {!hasChildren && <span className="mr-1 w-4" />}
        
        <StatusDot status={span.status} />
        <span className="text-sm truncate flex-1">{span.name}</span>
        <span className="text-xs text-gray-500 ml-2">{span.latencyMs}ms</span>
      </div>
      
      {isExpanded && hasChildren && span.children.map(child => (
        <TreeNode
          key={child.spanId}
          span={child}
          depth={depth + 1}
          expandedIds={expandedIds}
          selectedSpanId={selectedSpanId}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
```

### 5.5 `SpanDetailPanel.tsx`

```tsx
// 展示选中 Span 的完整信息，强制展示 Token 和 Cost
export function SpanDetailPanel({ span }: { span: SpanTreeNode | null }) {
  if (!span) return <div className="p-4 text-gray-500">Select a span to view details</div>;

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold">{span.name}</h3>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-gray-500">Type:</span> {span.traceType}</div>
        <div><span className="text-gray-500">Status:</span> <StatusBadge status={span.status} /></div>
        <div><span className="text-gray-500">Latency:</span> {span.latencyMs}ms</div>
        <div><span className="text-gray-500">Span ID:</span> <code className="text-xs">{span.spanId}</code></div>
      </div>

      {/* Token & Cost（强制展示） */}
      {(span.tokens || span.costUsd !== null) && (
        <div className="bg-blue-50 p-3 rounded">
          <h4 className="text-sm font-medium mb-2">Cost & Usage</h4>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {span.tokens?.prompt !== undefined && (
              <div><span className="text-gray-500">Prompt:</span> {span.tokens.prompt}</div>
            )}
            {span.tokens?.completion !== undefined && (
              <div><span className="text-gray-500">Completion:</span> {span.tokens.completion}</div>
            )}
            {span.tokens?.total !== undefined && (
              <div><span className="text-gray-500">Total:</span> {span.tokens.total}</div>
            )}
            {span.costUsd !== null && (
              <div className="col-span-3"><span className="text-gray-500">Cost:</span> ${span.costUsd.toFixed(4)}</div>
            )}
          </div>
        </div>
      )}

      {/* Attributes */}
      {span.attributes && (
        <div>
          <h4 className="text-sm font-medium mb-1">Attributes</h4>
          <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto max-h-40">
            {JSON.stringify(span.attributes, null, 2)}
          </pre>
        </div>
      )}

      {/* Input / Output Tabs */}
      <div className="border rounded">
        <div className="flex border-b">
          <button className="px-3 py-1 text-sm border-r bg-gray-50">Input</button>
          <button className="px-3 py-1 text-sm">Output</button>
        </div>
        <div className="p-2">
          <pre className="text-xs overflow-auto max-h-48">
            {JSON.stringify(span.input, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
```

---

## 6. 数据流时序图

### 6.1 SDK 手动 Span → 后端 → 前端

```
Developer Code                    SDK-TS                    Backend                    DB                Frontend
     │                              │                          │                    │                    │
     │ startTrace('agent_run')      │                          │                    │                    │
     │ ────────────────────────────>│                          │                    │                    │
     │                              │ POST /api/v1/spans       │                    │                    │
     │                              │ ─────────────────────────>│                    │                    │
     │                              │                          │ sanitize+truncate  │                    │
     │                              │                          │ ──────────────────>│                    │
     │                              │                          │ INSERT spans       │                    │
     │                              │                          │ <──────────────────│                    │
     │                              │ 201 {span}               │                    │                    │
     │                              │ <────────────────────────│                    │                    │
     │ {spanId, traceId}            │                          │                    │                    │
     │ <────────────────────────────│                          │                    │                    │
     │                              │                          │                    │                    │
     │ withSpan('llm_call', ...)    │                          │                    │                    │
     │ ────────────────────────────>│                          │                    │                    │
     │                              │ POST /api/v1/spans       │                    │                    │
     │                              │ (parentSpanId=root.span) │                    │                    │
     │                              │ ─────────────────────────>│                    │                    │
     │                              │                          │ ...                │                    │
     │                              │                          │                    │                    │
     │ endTrace(traceId)            │                          │                    │                    │
     │ ────────────────────────────>│ POST /api/v1/spans       │                    │                    │
     │                              │ (endedAt, latencyMs)     │                    │                    │
     │                              │ ─────────────────────────>│                    │                    │
     │                              │                          │ UPDATE spans       │                    │
     │                              │                          │ (ended_at, latency)│                    │
     │                              │                          │ ──────────────────>│                    │
     │                              │                          │                    │                    │
     │                              │                          │                    │   GET /traces/:id/tree
     │                              │                          │                    │ <───────────────────
     │                              │                          │ getSpanTree()      │                    │
     │                              │                          │ ──────────────────>│                    │
     │                              │                          │ SELECT * FROM spans│                    │
     │                              │                          │ WHERE trace_id=$1  │                    │
     │                              │                          │ <──────────────────│                    │
     │                              │                          │ buildTree()        │                    │
     │                              │                          │ ─────────────────────────> {rootSpan, stats}
```

### 6.2 旧 SDK `trace()` 双写兼容

```
旧 Agent Code                     SDK-TS (旧)                Backend
     │                              │                          │
     │ monitor.trace({...})         │                          │
     │ ────────────────────────────>│                          │
     │                              │ POST /api/v1/traces      │
     │                              │ ─────────────────────────>│
     │                              │                          │ createTrace()
     │                              │                          │ ──────────────────
     │                              │                          │ INSERT traces
     │                              │                          │ ──────────────────
     │                              │                          │ createSpan() ← 追加
     │                              │                          │ ──────────────────
     │                              │                          │ INSERT spans
     │                              │                          │ ──────────────────
     │                              │ 201 {trace, span}        │
     │                              │ <────────────────────────│
```

---

## 7. 迁移方案

### 7.1 零停机迁移步骤

| 步骤 | 操作 | 影响 | 回滚方案 |
|-----|------|------|---------|
| 1 | 发布数据库 Migration（spans 表 + 索引） | 无停机 | DROP TABLE spans |
| 2 | 发布后端（双写逻辑 + 新 API） | 无停机 | 回滚到旧版本 |
| 3 | 后台迁移历史 traces → spans | 低负载 | 清除 spans 表重新执行 |
| 4 | 发布前端（Gantt 图 + Span 树） | 无停机 | 回滚到旧版本 |
| 5 | 发布 SDK（新增 Span API + trace() 双写） | 用户需升级 SDK | 旧 SDK 仍可用 |
| 6 | 验证：Layer 4 回归测试全部通过 | - | - |
| 7 | (P1) 废弃 traces 表写入，只读 spans | - | - |

### 7.2 回滚策略

如果 P0-01 上线后发现问题：
1. **后端回滚**: 旧版本后端仍然支持 `traces` 表写入，前端查询 `GET /:id/tree` 会 fallback 到旧的 `getTraceTree`
2. **前端回滚**: 旧版前端直接展示 `TraceDetail`（单个 trace 详情），不依赖 Span 树
3. **数据安全**: `spans` 表是新增表，不影响 `traces` 表数据

---

## 8. 安全设计

### 8.1 数据流安全

```
SDK Input → sanitizeData() → truncateJson() → HTTPS → apikeyMiddleware → sanitize middleware → DB
```

### 8.2 权限矩阵

| API | 认证方式 | 权限检查 |
|-----|---------|---------|
| POST /api/v1/spans | X-API-Key | `request.projectId` 自动从 API Key 解析 |
| GET /api/v1/traces/:id/tree | Bearer Token | 校验 `trace.project_id` 属于当前用户 |
| GET /api/v1/spans/:spanId/raw | Bearer Token | 校验 span 的 project 属于当前用户 |

### 8.3 PII 脱敏流程

1. **SDK 层**（可选）: `config.sanitizePII = true` 时，SDK `sendSpan` 前调用 `sanitizeString()`；`config.enableSpanWrite = false` 可关闭双写
2. **后端层**（强制）: `createSpan()` 内调用 `sanitizeData()`，无论 SDK 是否脱敏
3. **默认值**: 邮箱、手机号、信用卡号自动脱敏
4. **敏感字段**: `password`, `secret`, `token` 等替换为 `[FILTERED]`

---

## 9. 测试策略

### 9.1 测试金字塔

```
        ┌─────────────┐
        │  E2E (P3)   │  Playwright: Trace 详情页 Gantt 图交互
        │   ~5 tests  │
        ├─────────────┤
        │  Agent (P4) │  vitest: SDK Span API + 后端 Tree API
        │  ~10 tests  │
        ├─────────────┤
        │  Unit (P2)  │  vitest: span.ts service, sanitize, truncate
        │  ~15 tests  │
        └─────────────┘
```

### 9.2 关键测试用例

| 层级 | 测试用例 | 验证点 |
|-----|---------|--------|
| Unit | `createSpan` 写入并返回正确字段 | DB 写入、JSON 序列化 |
| Unit | `getSpanTree` 构建 3 层嵌套树 | 递归正确、children 嵌套 |
| Unit | 循环引用检测 | A→B→A 时 B 被视为孤儿 |
| Unit | `sanitizeData` 过滤敏感字段 | `password` → `[FILTERED]` |
| Unit | `truncateJson` 截断大对象 | 超过 512KB 截断，保留提示 |
| Agent | SDK `startTrace` → `endTrace` | Span 创建、latency 计算 |
| Agent | SDK `withSpan` 包裹异步函数 | 成功/错误状态正确上报 |
| Agent | SDK `trace()` 双写 spans 表 | 旧 SDK 调用后 spans 表有数据 |
| Agent | 后端 `GET /tree` 返回嵌套结构 | root → child → grandchild |
| Agent | 后端 `GET /tree` fallback 逻辑 | spans 表无数据时返回旧结构 |
| E2E | 前端 Gantt 图渲染 | 条形位置、颜色、宽度正确 |
| E2E | 前端点击 Span 显示详情面板 | Token/Cost 展示正确 |
| E2E | 前端树列表展开/折叠 | 交互正确、选中状态同步 |

### 9.3 性能测试

```bash
# 100 Span 的 Trace 树查询性能
npm run test:perf -- --testNamePattern="span-tree-query"

# 目标：P99 < 200ms
# 测试数据：100 个 Span，嵌套 5 层，并发查询 10 个请求
```

---

## 10. 性能优化

### 10.1 后端优化

| 优化点 | 方案 | 预期效果 |
|--------|------|---------|
| 树查询 | 单次 `SELECT * WHERE trace_id=$1`，内存建树 | 避免 N+1 查询 |
| JSONB 压缩 | PostgreSQL TOAST 自动压缩 >2KB 字段 | 减少存储和 IO |
| 大字段截断 | 写入前截断到 512KB | 避免单行过大 |
| 索引覆盖 | `idx_spans_trace_id` 覆盖 95% 查询 | 毫秒级查询 |
| 连接池 | SQLite: 单连接；PostgreSQL: pg pool | 避免连接耗尽 |

### 10.2 前端优化

| 优化点 | 方案 | 预期效果 |
|--------|------|---------|
| 虚拟滚动 | >100 个 Span 时启用 react-window | 流畅渲染 1000+ Span |
| 懒加载 | 初始只展开第一层，延迟渲染子树 | 首屏 < 100ms |
| Memo | `useMemo` 缓存 tree 扁平化和排序 | 避免重复计算 |
| 分页 | API `limit=500`，前端提示"未完全加载" | 避免超大 Trace 卡死 |

### 10.3 SDK 优化

| 优化点 | 方案 | 预期效果 |
|--------|------|---------|
| 批量上报 | Span 数据进入 buffer，随 `flush()` 批量发送 | 减少 HTTP 请求 |
| 异步无阻塞 | `sendSpan` 不 await（fire-and-forget） | 不影响业务代码性能 |
| 属性合并 | 多次 `setSpanAttribute` 在 SDK 层合并后发送 | 减少网络请求 |

---

## 11. 排期与里程碑

### 11.1 开发排期（预估 7 个工作日，含 2 天 buffer）

| 天数 | 任务 | 产出 |
|-----|------|------|
| Day 1 | 数据库 Migration + span.ts Service（含独立循环检测） | SQLite/PostgreSQL spans 表，CRUD + Tree 查询 |
| Day 2 | 后端 Routes + 双写改造 + sanitize/truncate | traces.ts 追加双写，spans.ts 新路由，工具模块 |
| Day 3 | SDK-TS Span API（Map 结构 + buffer 双写） | startSpan/endSpan/withSpan + trace() 双写走 buffer |
| Day 4 | 前端组件 + Gantt 性能原型验证 | SpanTreeList + GanttChart + SpanDetailPanel；500 Span 基准测试 |
| Day 5 | 集成测试 + Layer 4 回归 | SDK/后端/前端联调，旧 SDK 兼容性验证 |
| Day 6 | 性能调优 + 边界情况修复 | 100 Span 查询 < 200ms，循环引用/孤儿 Span 测试 |
| Day 7 | Buffer 日：文档更新 + 验收 + 代码审查 | 技术文档更新，PR 合并准备 |

### 11.2 里程碑

- **M1** (Day 2): 后端 API 可用，`POST /spans` + `GET /tree` 返回正确数据
- **M2** (Day 3): SDK 可用，`withSpan` 包裹函数在平台显示为树
- **M3** (Day 4): 前端可用，Gantt 图 + 树列表可交互；性能原型达标
- **M4** (Day 5): 集成测试通过，Layer 4 回归无失败
- **M5** (Day 7): 验收通过，所有测试通过，性能达标，文档更新

---

## 12. 风险与技术债务

| 风险 | 缓解措施 | 责任人 |
|-----|---------|--------|
| 双写逻辑引入性能瓶颈 | `createTrace` 内 `createSpan` 用 `try/catch` 包裹；SDK 双写走 buffer 批量发送 | 后端+SDK |
| 前端 Gantt 图大数据量卡顿 | Day 4 上午做 500 Span 基准测试；不达标时启用虚拟滚动 | 前端 |
| SQLite JSON 字段查询性能差 | 数据量小（本地部署）时无问题；大数据量建议切 PostgreSQL | 架构 |
| SDK `spanStack` 内存泄漏 | `Map<traceId, SpanContext[]>` + `MAX_SPAN_STACK_SIZE=1000` 硬限制 + 自动清理 | SDK |
| 循环引用导致错误树结构 | **独立 `detectCycles` 函数**：基于 parent 关系图做 DFS，与建树逻辑分离 | 后端 |
| 并发 Span parent 关联错误 | `Map<traceId, SpanContext[]>` 按 trace 隔离栈；并发子 Span 通过 `options.parentSpanId` 显式指定 | SDK |
| `setSpanAttribute` 后端更新缺失 | **MVP 简化**：SDK 层缓存属性，随 `endSpan` 一次性上报；后端只实现 POST 创建 | SDK |

---

## 附录

### A. API 变更汇总

| 方法 | 路径 | 变更类型 | 说明 |
|-----|------|---------|------|
| POST | /api/v1/spans | 新增 | 创建 Span（SDK 使用） |
| GET | /api/v1/traces/:id/tree | 修改 | 从 spans 表查询完整嵌套树 |
| GET | /api/v1/spans/:spanId/raw | 新增 | 下载未截断原始数据（P1） |

### B. 数据库变更汇总

| 对象 | 变更类型 | 说明 |
|-----|---------|------|
| spans 表 | 新增 | Span 追踪主表 |
| _migration_p001_spans | 新增 | SQLite 迁移标记表 |
| traces 表 | 不变 | 继续使用，双写兼容 |

### C. 第三方依赖

| 依赖 | 用途 | 是否新增 |
|-----|------|---------|
| better-sqlite3 | SQLite 驱动 | 已有 |
| pg | PostgreSQL 驱动 | 已有 |
| uuid | UUID 生成 | 已有 |
| react-window | 前端虚拟滚动（P1） | 新增（可选） |

---

> **下一步**: 技术设计评审会议，确认后进入 TDD 实现阶段。
