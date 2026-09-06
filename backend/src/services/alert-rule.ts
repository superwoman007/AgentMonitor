import { createHash, randomUUID } from 'crypto';
import { fromDbBool, fromDbJson, toDbBool, toDbJson, query, queryOne, run } from '../db/index.js';

/**
 * 持久化告警规则。event_type 决定触发场景：
 * - run_failed：Run 进入 failed
 * - run_regression：通过率低于 threshold
 * - run_completed：Run 完成（threshold 为空即全量通知）
 */
export interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  event_type: 'run_failed' | 'run_regression' | 'run_completed';
  condition: string | null;
  threshold: number | null;
  webhook_url: string | null;
  channels: string[];
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 告警事件台账。fingerprint 与 rule_id 唯一，防止同一事件重复落库。
 */
export interface AlertEvent {
  id: string;
  rule_id: string | null;
  project_id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  payload: Record<string, unknown> | null;
  fingerprint: string;
  delivery_status: 'pending' | 'delivered' | 'failed' | 'skipped';
  delivered_at: string | null;
  delivery_error: string | null;
  created_at: string;
}

/**
 * 触发告警时的上下文（来自 Run 终态聚合结果）。
 */
export interface AlertTriggerContext {
  runId: string;
  runNumber: number;
  experimentId: string;
  experimentName?: string;
  status: string;
  passRate?: number;
  totalItems?: number;
  passedItems?: number;
}

/**
 * 行结构（channels 为 JSON 文档，enabled 为布尔）。
 */
interface AlertRuleRow extends Omit<AlertRule, 'channels' | 'enabled'> {
  channels: unknown;
  enabled: unknown;
}

/**
 * 把数据库行反序列化为 AlertRule。
 * @param row - 数据库行
 * @returns 结构化规则
 */
function deserializeRule(row: AlertRuleRow): AlertRule {
  let channels: string[] = ['web'];
  const parsed = fromDbJson(row.channels);
  if (Array.isArray(parsed)) channels = parsed.map(String);
  return { ...row, channels, enabled: fromDbBool(row.enabled) ?? true };
}

/**
 * 列出项目下全部告警规则。
 * @param projectId - 项目 ID
 * @returns 规则列表
 */
export async function listAlertRules(projectId: string): Promise<AlertRule[]> {
  const rows = await query<AlertRuleRow>(
    'SELECT * FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
  return rows.map(deserializeRule);
}

/**
 * 读取单条告警规则。
 * @param projectId - 项目 ID
 * @param id - 规则 ID
 * @returns 规则或 null
 */
export async function getAlertRule(projectId: string, id: string): Promise<AlertRule | null> {
  const row = await queryOne<AlertRuleRow>(
    'SELECT * FROM alert_rules WHERE project_id = $1 AND id = $2',
    [projectId, id]
  );
  return row ? deserializeRule(row) : null;
}

/**
 * 创建告警规则。
 * @param input - 创建参数
 * @returns 新规则
 */
export async function createAlertRule(input: {
  projectId: string;
  name: string;
  eventType: AlertRule['event_type'];
  condition?: string;
  threshold?: number;
  webhookUrl?: string;
  channels?: string[];
  enabled?: boolean;
  cooldownMinutes?: number;
  createdBy?: string;
}): Promise<AlertRule> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO alert_rules
       (id, project_id, name, event_type, condition, threshold, webhook_url, channels,
        enabled, cooldown_minutes, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [
      id,
      input.projectId,
      input.name.trim(),
      input.eventType,
      input.condition ?? null,
      input.threshold ?? null,
      input.webhookUrl ?? null,
      toDbJson(input.channels ?? ['web']),
      toDbBool(input.enabled !== false),
      input.cooldownMinutes ?? 60,
      input.createdBy ?? null,
      now,
    ]
  );
  const created = await getAlertRule(input.projectId, id);
  if (!created) throw new Error('Failed to reload alert rule');
  return created;
}

/**
 * 更新告警规则。
 * @param projectId - 项目 ID
 * @param id - 规则 ID
 * @param patch - 更新字段
 * @returns 更新后的规则，不存在返回 null
 */
export async function updateAlertRule(
  projectId: string,
  id: string,
  patch: {
    name?: string;
    threshold?: number | null;
    webhookUrl?: string | null;
    channels?: string[];
    enabled?: boolean;
    cooldownMinutes?: number;
  }
): Promise<AlertRule | null> {
  const existing = await getAlertRule(projectId, id);
  if (!existing) return null;

  const merged: AlertRule = {
    ...existing,
    name: patch.name ?? existing.name,
    threshold: patch.threshold === undefined ? existing.threshold : patch.threshold,
    webhook_url: patch.webhookUrl === undefined ? existing.webhook_url : patch.webhookUrl,
    channels: patch.channels ?? existing.channels,
    enabled: patch.enabled ?? existing.enabled,
    cooldown_minutes: patch.cooldownMinutes ?? existing.cooldown_minutes,
  };

  await run(
    `UPDATE alert_rules
        SET name = $3, threshold = $4, webhook_url = $5, channels = $6,
            enabled = $7, cooldown_minutes = $8, updated_at = $9
      WHERE id = $1 AND project_id = $2`,
    [
      merged.id,
      merged.project_id,
      merged.name,
      merged.threshold,
      merged.webhook_url,
      toDbJson(merged.channels),
      toDbBool(merged.enabled),
      merged.cooldown_minutes,
      new Date().toISOString(),
    ]
  );
  return getAlertRule(projectId, id);
}

/**
 * 删除告警规则（告警事件保留，rule_id 置空）。
 * @param projectId - 项目 ID
 * @param id - 规则 ID
 * @returns 是否删除成功
 */
export async function deleteAlertRule(projectId: string, id: string): Promise<boolean> {
  const result = await run('DELETE FROM alert_rules WHERE project_id = $1 AND id = $2', [
    projectId,
    id,
  ]);
  return result.changes > 0;
}

/**
 * 列出项目下的告警事件（倒序）。
 * @param projectId - 项目 ID
 * @param limit - 最多返回条数
 * @returns 事件列表
 */
export async function listAlertEvents(projectId: string, limit = 50): Promise<AlertEvent[]> {
  const rows = await query<AlertEvent & { payload: unknown }>(
    'SELECT * FROM alert_events WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
    [projectId, limit]
  );
  return rows.map((r) => ({
    ...r,
    payload: r.payload ? (fromDbJson(r.payload) as Record<string, unknown>) : null,
  }));
}

/**
 * 生成事件指纹：规则 + Run 维度，保证同一 Run 同一规则只告警一次。
 * @param ruleId - 规则 ID
 * @param ctx - 触发上下文
 * @returns 指纹字符串
 */
function buildFingerprint(ruleId: string, ctx: AlertTriggerContext): string {
  return createHash('sha256')
    .update(`${ruleId}:${ctx.runId}:${ctx.status}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * 判断规则是否处于冷却期。
 * @param rule - 告警规则
 * @param now - 当前时间
 * @returns 是否冷却中
 */
function inCooldown(rule: AlertRule, now: Date): boolean {
  if (!rule.last_triggered_at) return false;
  const last = new Date(rule.last_triggered_at).getTime();
  return now.getTime() - last < rule.cooldown_minutes * 60_000;
}

/**
 * 根据规则与上下文评估是否应当告警。
 * @param rule - 告警规则
 * @param ctx - 触发上下文
 * @returns 是否命中
 */
function evaluateRule(rule: AlertRule, ctx: AlertTriggerContext): boolean {
  switch (rule.event_type) {
    case 'run_failed':
      return ctx.status === 'failed';
    case 'run_regression':
      return (
        ctx.status === 'completed' &&
        ctx.passRate !== undefined &&
        rule.threshold !== null &&
        ctx.passRate < rule.threshold
      );
    case 'run_completed':
      return ctx.status === 'completed' || ctx.status === 'failed';
    default:
      return false;
  }
}

/**
 * 投递 Webhook：POST JSON 负载，5s 超时；非 2xx 视为失败。
 * 可通过注入 fetch 便于测试。
 * @param url - Webhook 地址
 * @param body - 请求体
 * @param fetchImpl - 可选 fetch 实现
 */
async function deliverWebhook(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Webhook responded HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 评估项目下所有启用规则，命中则落 alert_events 并投递 Webhook。
 * 指纹唯一约束 + 冷却期双重去重。
 * @param projectId - 项目 ID
 * @param ctx - 触发上下文
 * @param deps - 可选依赖注入（fetch 实现）
 * @returns 本次产生的告警事件
 */
export async function evaluateRunAlerts(
  projectId: string,
  ctx: AlertTriggerContext,
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<AlertEvent[]> {
  const rules = await listAlertRules(projectId);
  const now = new Date();
  const produced: AlertEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!evaluateRule(rule, ctx)) continue;
    if (inCooldown(rule, now)) continue;

    const fingerprint = buildFingerprint(rule.id, ctx);
    // 指纹唯一约束兜底：同一 Run 已告警则跳过
    const dup = await queryOne<{ id: string }>(
      'SELECT id FROM alert_events WHERE rule_id = $1 AND fingerprint = $2',
      [rule.id, fingerprint]
    );
    if (dup) continue;

    const severity: AlertEvent['severity'] =
      rule.event_type === 'run_failed' ? 'critical' : rule.event_type === 'run_regression' ? 'warning' : 'info';
    const title = `[${rule.event_type}] ${rule.name}`;
    const rateText = ctx.passRate !== undefined ? `通过率 ${(ctx.passRate * 100).toFixed(1)}%` : ctx.status;
    const message = `Run #${ctx.runNumber}（实验 ${ctx.experimentName ?? ctx.experimentId.slice(0, 8)}）${rateText}，触发规则「${rule.name}」`;
    const eventId = randomUUID();

    let deliveryStatus: AlertEvent['delivery_status'] = 'skipped';
    let deliveredAt: string | null = null;
    let deliveryError: string | null = null;

    if (rule.webhook_url) {
      try {
        await deliverWebhook(
          rule.webhook_url,
          {
            event: rule.event_type,
            severity,
            title,
            message,
            runId: ctx.runId,
            runNumber: ctx.runNumber,
            experimentId: ctx.experimentId,
            passRate: ctx.passRate,
            status: ctx.status,
            fingerprint,
            triggeredAt: now.toISOString(),
          },
          deps.fetchImpl
        );
        deliveryStatus = 'delivered';
        deliveredAt = new Date().toISOString();
      } catch (error) {
        deliveryStatus = 'failed';
        deliveryError = (error as Error).message;
      }
    }

    await run(
      `INSERT INTO alert_events
         (id, rule_id, project_id, event_type, severity, title, message, payload,
          fingerprint, delivery_status, delivered_at, delivery_error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        eventId,
        rule.id,
        projectId,
        rule.event_type,
        severity,
        title,
        message,
        toDbJson({ runId: ctx.runId, runNumber: ctx.runNumber, passRate: ctx.passRate }),
        fingerprint,
        deliveryStatus,
        deliveredAt,
        deliveryError,
        now.toISOString(),
      ]
    );

    await run(
      'UPDATE alert_rules SET last_triggered_at = $3, updated_at = $3 WHERE id = $1 AND project_id = $2',
      [rule.id, projectId, now.toISOString()]
    );

    const stored = await queryOne<AlertEvent & { payload: unknown }>(
      'SELECT * FROM alert_events WHERE id = $1',
      [eventId]
    );
    if (stored) {
      produced.push({
        ...stored,
        payload: stored.payload ? (fromDbJson(stored.payload) as Record<string, unknown>) : null,
      });
    }

    // eslint-disable-next-line no-console
    console.log(`[alert-rule] ${severity}: ${message} (webhook ${deliveryStatus})`);
  }

  return produced;
}

/**
 * 仅供测试：清空告警规则与事件。
 */
export async function __clearAlertRulesForTests(): Promise<void> {
  await run('DELETE FROM alert_events', []);
  await run('DELETE FROM alert_rules', []);
}
