import { FastifyInstance } from 'fastify';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { queryOne } from '../db/index.js';
import { createSession, endSession, getSessionById } from '../services/session.js';
import { createSpan } from '../services/span.js';
import { createTrace, Trace, updateTrace, upsertTraceByTraceId } from '../services/trace.js';
import { createFeedback } from '../services/feedback.js';
import { getEventReceipt, recordEventReceipt } from '../services/telemetry-receipt.js';

type TelemetryEventType =
  | 'session.start'
  | 'session.end'
  | 'trace.start'
  | 'trace.end'
  | 'span.start'
  | 'span.end'
  | 'span.event'
  | 'feedback.created'
  | 'sample.completed';

interface TelemetryEvent {
  schemaVersion: '2.0';
  eventId: string;
  eventType: TelemetryEventType;
  occurredAt: string;
  sequence?: number;
  resource?: Record<string, unknown>;
  context?: Record<string, unknown>;
  payload: Record<string, unknown>;
}

interface TelemetryReceipt {
  eventId: string;
  status: 'accepted' | 'rejected';
  entityType?: 'session' | 'trace' | 'span' | 'feedback' | 'sample';
  entityId?: string;
  error?: string;
  acceptedAt: string;
}

const SUPPORTED_EVENT_TYPES = new Set<TelemetryEventType>([
  'session.start',
  'session.end',
  'trace.start',
  'trace.end',
  'span.start',
  'span.end',
  'span.event',
  'feedback.created',
  'sample.completed',
]);

/**
 * 判断值是否为普通对象
 * @param value - 待判断值
 * @returns 若为普通对象则返回 true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从对象中安全读取字符串字段
 * @param data - 输入对象
 * @param key - 字段名
 * @returns 返回字符串值，不存在则返回 undefined
 */
function getString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 从对象中安全读取数字字段
 * @param data - 输入对象
 * @param key - 字段名
 * @returns 返回数字值，不存在则返回 undefined
 */
function getNumber(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 解析事件时间
 * @param preferredIso - 优先使用的 ISO 时间
 * @param fallbackIso - 回退时间
 * @returns 返回合法 Date 对象
 */
function parseEventDate(preferredIso: string | undefined, fallbackIso: string): Date {
  const parsed = new Date(preferredIso || fallbackIso);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(fallbackIso);
  }
  return parsed;
}

/**
 * 规范化 Span 状态
 * @param status - 原始状态
 * @returns 返回 spans 表使用的状态值
 */
function normalizeSpanStatus(status: unknown): string {
  if (status === 'success') return 'ok';
  if (typeof status === 'string' && status.length > 0) return status;
  return 'unset';
}

/**
 * 规范化 Trace 状态
 * @param status - 原始状态
 * @returns 返回 traces 表使用的状态值
 */
function normalizeTraceStatus(status: unknown): string {
  if (status === 'ok') return 'success';
  if (typeof status === 'string' && status.length > 0) return status;
  return 'pending';
}

/**
 * 解析事件展示名称
 * @param event - telemetry 事件
 * @returns 返回名称
 */
function resolveEventName(event: TelemetryEvent): string {
  return getString(event.payload, 'name')
    || getString(event.payload, 'spanName')
    || getString(event.payload, 'operationName')
    || event.eventType;
}

/**
 * 按上下文查找既有根 Trace
 * @param context - 事件上下文
 * @returns 返回匹配的 Trace 或 null
 */
async function findTraceByContext(context: Record<string, unknown> | undefined): Promise<Trace | null> {
  const spanId = getString(context, 'spanId');
  const traceId = getString(context, 'traceId');

  if (spanId) {
    return queryOne<Trace>(
      'SELECT * FROM traces WHERE span_id = $1 ORDER BY created_at DESC LIMIT 1',
      [spanId]
    );
  }

  if (traceId) {
    return queryOne<Trace>(
      'SELECT * FROM traces WHERE trace_id = $1 ORDER BY created_at DESC LIMIT 1',
      [traceId]
    );
  }

  return null;
}

/**
 * 处理 Session 事件
 * @param projectId - 项目 ID
 * @param event - telemetry 事件
 * @returns 返回实体类型与实体 ID
 */
async function handleSessionEvent(
  projectId: string,
  event: TelemetryEvent
): Promise<{ entityType: 'session'; entityId: string }> {
  const sessionId = getString(event.context, 'sessionId');
  if (!sessionId) {
    throw new Error('sessionId is required for session events');
  }

  if (event.eventType === 'session.start') {
    const existing = await getSessionById(sessionId);
    const session = existing || await createSession(projectId, sessionId, event.payload);
    return { entityType: 'session', entityId: session.id };
  }

  const session = await endSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return { entityType: 'session', entityId: session.id };
}

/**
 * 处理 Span 事件
 * @param projectId - 项目 ID
 * @param event - telemetry 事件
 * @returns 返回实体类型与实体 ID
 */
async function handleSpanEvent(
  projectId: string,
  event: TelemetryEvent
): Promise<{ entityType: 'span'; entityId: string }> {
  const traceId = getString(event.context, 'traceId');
  const spanId = getString(event.context, 'spanId');
  if (!traceId || !spanId) {
    throw new Error('traceId and spanId are required for span events');
  }

  const startedAt = parseEventDate(getString(event.payload, 'startedAt'), event.occurredAt);
  const isSpanEnd = event.eventType === 'span.end';
  const endedAt = isSpanEnd
    ? parseEventDate(getString(event.payload, 'endedAt'), event.occurredAt)
    : undefined;

  const span = await createSpan({
    projectId,
    traceId,
    spanId,
    parentSpanId: getString(event.context, 'parentSpanId') || null,
    name: resolveEventName(event),
    traceType: getString(event.payload, 'traceType') || getString(event.payload, 'spanKind') || 'custom',
    startedAt,
    endedAt,
    latencyMs: getNumber(event.payload, 'latencyMs'),
    input: event.payload.input,
    output: event.payload.output,
    attributes: isRecord(event.payload.attributes)
      ? event.payload.attributes
      : isRecord(event.payload.metadata)
        ? event.payload.metadata
        : isRecord(event.payload.data)
          ? event.payload.data
          : undefined,
    status: normalizeSpanStatus(
      event.payload.status
      ?? (isSpanEnd ? (event.payload.error ? 'error' : 'ok') : 'unset')
    ),
    error: getString(event.payload, 'error'),
    sessionId: getString(event.context, 'sessionId') || null,
  });

  return { entityType: 'span', entityId: span.span_id };
}

/**
 * 处理 Trace 或 Sample 事件
 * @param projectId - 项目 ID
 * @param event - telemetry 事件
 * @returns 返回实体类型与实体 ID
 */
async function handleTraceLikeEvent(
  projectId: string,
  event: TelemetryEvent
): Promise<{ entityType: 'trace' | 'sample'; entityId: string }> {
  const existing = await findTraceByContext(event.context);
  const startedAt = parseEventDate(getString(event.payload, 'startedAt'), event.occurredAt);
  const endedAt = (event.eventType === 'trace.end' || event.eventType === 'sample.completed')
    ? parseEventDate(getString(event.payload, 'endedAt'), event.occurredAt)
    : undefined;

  const traceInput = {
    projectId,
    sessionId: getString(event.context, 'sessionId'),
    agentId: getString(event.payload, 'agentId'),
    traceType: getString(event.payload, 'traceType') || (event.eventType === 'sample.completed' ? 'sample' : 'custom'),
    name: resolveEventName(event),
    input: event.payload.input,
    output: event.payload.output,
    metadata: isRecord(event.payload.metadata) ? event.payload.metadata : event.payload,
    traceId: getString(event.context, 'traceId'),
    spanId: getString(event.context, 'spanId'),
    parentSpanId: getString(event.context, 'parentSpanId'),
    promptId: getString(event.context, 'promptId'),
    promptVersionId: getString(event.context, 'promptVersionId'),
    startedAt,
    endedAt,
    latencyMs: getNumber(event.payload, 'latencyMs'),
    status: normalizeTraceStatus(
      event.payload.status
      ?? ((event.eventType === 'trace.end' || event.eventType === 'sample.completed')
        ? (event.payload.error ? 'error' : 'success')
        : 'pending')
    ),
    error: getString(event.payload, 'error'),
  };

  if (!existing) {
    // V2 协议要求携带外部 traceId；存在时走幂等 upsert，避免 trace.start/trace.end 双写
    if (traceInput.traceId) {
      const trace = await upsertTraceByTraceId(traceInput as Parameters<typeof upsertTraceByTraceId>[0]);
      return {
        entityType: event.eventType === 'sample.completed' ? 'sample' : 'trace',
        entityId: trace.id,
      };
    }
    const trace = await createTrace(traceInput);
    return {
      entityType: event.eventType === 'sample.completed' ? 'sample' : 'trace',
      entityId: trace.id,
    };
  }

  const updated = await updateTrace(existing.id, traceInput);
  return {
    entityType: event.eventType === 'sample.completed' ? 'sample' : 'trace',
    entityId: updated?.id || existing.id,
  };
}

/**
 * 处理 Feedback 事件
 * @param projectId - 项目 ID
 * @param event - telemetry 事件
 * @returns 返回实体类型与实体 ID
 */
async function handleFeedbackEvent(
  projectId: string,
  event: TelemetryEvent
): Promise<{ entityType: 'feedback'; entityId: string }> {
  const rating = getNumber(event.payload, 'rating');
  if (rating === undefined) {
    throw new Error('rating is required for feedback.created');
  }

  const feedback = await createFeedback({
    projectId,
    sessionId: getString(event.context, 'sessionId'),
    messageId: getString(event.context, 'messageId'),
    rating,
    reason: getString(event.payload, 'reason'),
    comment: getString(event.payload, 'comment'),
    dimensions: isRecord(event.payload.dimensions) ? event.payload.dimensions : undefined,
  });

  return { entityType: 'feedback', entityId: feedback.id };
}

/**
 * 处理单条 telemetry 事件
 * @param projectId - 项目 ID
 * @param event - telemetry 事件
 * @returns 返回事件回执
 */
async function ingestTelemetryEvent(projectId: string, event: TelemetryEvent): Promise<TelemetryReceipt> {
  const acceptedAt = new Date().toISOString();

  if (event.schemaVersion !== '2.0') {
    return { eventId: event.eventId || 'unknown', status: 'rejected', error: 'Unsupported schemaVersion', acceptedAt };
  }
  if (!event.eventId) {
    return { eventId: 'unknown', status: 'rejected', error: 'eventId is required', acceptedAt };
  }
  if (!SUPPORTED_EVENT_TYPES.has(event.eventType)) {
    return { eventId: event.eventId, status: 'rejected', error: 'Unsupported eventType', acceptedAt };
  }

  // 幂等检查：同一 eventId 重复上报时直接返回既有回执，避免副作用被执行多次
  const existingReceipt = await getEventReceipt(event.eventId);
  if (existingReceipt) {
    const existingAcceptedAt = existingReceipt.accepted_at instanceof Date
      ? existingReceipt.accepted_at.toISOString()
      : String(existingReceipt.accepted_at);
    return {
      eventId: event.eventId,
      status: 'accepted',
      entityType: existingReceipt.entity_type as TelemetryReceipt['entityType'],
      entityId: existingReceipt.entity_id || undefined,
      acceptedAt: existingAcceptedAt,
    };
  }

  try {
    let result:
      | { entityType: 'session'; entityId: string }
      | { entityType: 'trace' | 'sample'; entityId: string }
      | { entityType: 'span'; entityId: string }
      | { entityType: 'feedback'; entityId: string };

    switch (event.eventType) {
      case 'session.start':
      case 'session.end':
        result = await handleSessionEvent(projectId, event);
        break;
      case 'trace.start':
      case 'trace.end':
      case 'sample.completed':
        result = await handleTraceLikeEvent(projectId, event);
        break;
      case 'span.start':
      case 'span.end':
      case 'span.event':
        result = await handleSpanEvent(projectId, event);
        break;
      case 'feedback.created':
        result = await handleFeedbackEvent(projectId, event);
        break;
      default:
        return { eventId: event.eventId, status: 'rejected', error: 'Unsupported eventType', acceptedAt };
    }

    await recordEventReceipt({
      eventId: event.eventId,
      eventType: event.eventType,
      projectId,
      entityType: result.entityType,
      entityId: result.entityId,
    });

    return {
      eventId: event.eventId,
      status: 'accepted',
      entityType: result.entityType,
      entityId: result.entityId,
      acceptedAt,
    };
  } catch (error) {
    return {
      eventId: event.eventId,
      status: 'rejected',
      error: error instanceof Error ? error.message : 'Failed to ingest event',
      acceptedAt,
    };
  }
}

/**
 * 注册 Telemetry V2 路由
 * @param app - Fastify 应用实例
 * @returns 无返回值
 */
export async function telemetryV2Routes(app: FastifyInstance): Promise<void> {
  // 遥测批量上报入口。
  // - bodyLimit 放宽到 10MB（默认 1MB 会导致大批量 Span 上报 413）；
  // - 单批事件数上限 MAX_BATCH_EVENTS，超出直接 413 拒绝，防止超大请求拖垮入库。
  const MAX_BATCH_EVENTS = 1000;
  app.post(
    '/batch',
    {
      preHandler: apikeyMiddleware,
      bodyLimit: 10 * 1024 * 1024,
    },
    async (request, reply) => {
      if (!request.projectId) {
        reply.code(401).send({ error: 'Project not identified' });
        return;
      }

      const body = request.body as { events?: TelemetryEvent[] };
      if (!Array.isArray(body?.events) || body.events.length === 0) {
        reply.code(400).send({ error: 'events must be a non-empty array' });
        return;
      }

      if (body.events.length > MAX_BATCH_EVENTS) {
        reply.code(413).send({
          error: `Batch too large: ${body.events.length} events exceeds limit of ${MAX_BATCH_EVENTS}`,
          maxEvents: MAX_BATCH_EVENTS,
        });
        return;
      }

      const receipts: TelemetryReceipt[] = [];
      for (const rawEvent of body.events) {
        if (!isRecord(rawEvent)) {
          receipts.push({
            eventId: 'unknown',
            status: 'rejected',
            error: 'Event must be an object',
            acceptedAt: new Date().toISOString(),
          });
          continue;
        }
        receipts.push(await ingestTelemetryEvent(request.projectId, rawEvent as TelemetryEvent));
      }

    const acceptedCount = receipts.filter((receipt) => receipt.status === 'accepted').length;
    reply.code(202).send({
      receipts,
      summary: {
        total: receipts.length,
        accepted: acceptedCount,
        rejected: receipts.length - acceptedCount,
      },
    });
  });
}
