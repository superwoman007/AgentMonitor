import { queryOne, run } from '../db/index.js';

export interface EventReceiptRecord {
  event_id: string;
  event_type: string;
  project_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  accepted_at: Date;
}

/**
 * 查询某事件是否已经被接收处理（幂等检查）
 *
 * @param eventId - 事件唯一 ID（UUID v7）
 * @returns 若已接收则返回回执记录，否则返回 null
 */
export async function getEventReceipt(eventId: string): Promise<EventReceiptRecord | null> {
  return queryOne<EventReceiptRecord>(
    'SELECT * FROM telemetry_event_receipts WHERE event_id = $1',
    [eventId]
  );
}

/**
 * 记录一条已接收事件的回执（幂等台账）
 *
 * 同一 eventId 重复上报时，依赖主键冲突实现“只生效一次”。
 *
 * @param receipt - 回执数据
 * @returns 是否为本次新插入（true 表示首次接收，false 表示重复事件）
 */
export async function recordEventReceipt(receipt: {
  eventId: string;
  eventType: string;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<boolean> {
  try {
    await run(
      `INSERT INTO telemetry_event_receipts (event_id, event_type, project_id, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        receipt.eventId,
        receipt.eventType,
        receipt.projectId || null,
        receipt.entityType || null,
        receipt.entityId || null,
      ]
    );
    return true;
  } catch (error) {
    // 主键冲突意味着该事件已被接收过，视为重复事件
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE') || message.includes('PRIMARY') || message.includes('duplicate')) {
      return false;
    }
    throw error;
  }
}
