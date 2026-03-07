import { v4 as uuidv4 } from 'uuid';

export interface Alert {
  id: string;
  projectId: string;
  name: string;
  type: 'latency' | 'error_rate' | 'cost' | 'custom';
  condition: string;
  threshold: number;
  enabled: boolean;
  lastTriggered: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertHistory {
  id: string;
  alertId: string;
  projectId: string;
  alertName: string;
  alertType: Alert['type'];
  threshold: number;
  actual: number | null;
  metrics: {
    avgLatency?: number;
    errorRate?: number;
    dailyCost?: number;
  };
  condition?: string;
  fingerprint: string;
  ignoredUntil: Date | null;
  evidenceTrace?: {
    id: string;
    sessionId: string | null;
    traceType: string;
    name: string;
    startedAt: string;
    latencyMs: number | null;
    status: string;
    error: string | null;
    cost?: number | null;
  };
  message: string;
  triggeredAt: Date;
}

const alertsStore: Map<string, Alert> = new Map();
const alertHistoryStore: Map<string, AlertHistory> = new Map();
const alertSuppressionStore: Map<string, { mutedUntil: Date }> = new Map();

export function createAlert(data: {
  projectId: string;
  name: string;
  type: Alert['type'];
  condition: string;
  threshold: number;
  enabled?: boolean;
}): Alert {
  const id = uuidv4();
  const now = new Date();
  const alert: Alert = {
    id,
    projectId: data.projectId,
    name: data.name,
    type: data.type,
    condition: data.condition,
    threshold: data.threshold,
    enabled: data.enabled ?? true,
    lastTriggered: null,
    createdAt: now,
    updatedAt: now,
  };
  alertsStore.set(id, alert);
  return alert;
}

export function ignoreAlertHistory(historyId: string, minutes: number): { mutedUntil: Date } | null {
  const history = alertHistoryStore.get(historyId);
  if (!history) return null;

  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  const mutedUntil = new Date(Date.now() + minutes * 60_000);
  const suppressionKey = `${history.projectId}:${history.fingerprint}`;
  alertSuppressionStore.set(suppressionKey, { mutedUntil });
  history.ignoredUntil = mutedUntil;
  alertHistoryStore.set(historyId, history);
  return { mutedUntil };
}

export function getAlertsByProject(projectId: string): Alert[] {
  return Array.from(alertsStore.values()).filter(
    (alert) => alert.projectId === projectId
  );
}

export function getAlertById(id: string): Alert | null {
  return alertsStore.get(id) || null;
}

export function updateAlert(
  id: string,
  data: Partial<Omit<Alert, 'id' | 'projectId' | 'createdAt'>>
): Alert | null {
  const alert = alertsStore.get(id);
  if (!alert) return null;

  const updated = { ...alert, ...data, updatedAt: new Date() };
  alertsStore.set(id, updated);
  return updated;
}

export function deleteAlert(id: string): boolean {
  return alertsStore.delete(id);
}

export function toggleAlert(id: string): Alert | null {
  const alert = alertsStore.get(id);
  if (!alert) return null;
  alert.enabled = !alert.enabled;
  alert.updatedAt = new Date();
  alertsStore.set(id, alert);
  return alert;
}

export function getAlertHistory(projectId: string, limit: number = 50): AlertHistory[] {
  return Array.from(alertHistoryStore.values())
    .filter((h) => h.projectId === projectId)
    .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime())
    .slice(0, limit);
}

export function getAlertHistoryById(id: string): AlertHistory | null {
  return alertHistoryStore.get(id) || null;
}

function buildFingerprint(alert: Alert): string {
  const cond = alert.type === 'custom' ? alert.condition : '';
  return `${alert.id}:${alert.type}:${alert.threshold}:${cond}`;
}

function isSuppressed(projectId: string, fingerprint: string): boolean {
  const key = `${projectId}:${fingerprint}`;
  const entry = alertSuppressionStore.get(key);
  if (!entry) return false;
  if (entry.mutedUntil.getTime() <= Date.now()) {
    alertSuppressionStore.delete(key);
    return false;
  }
  return true;
}

export function checkAlerts(
  projectId: string,
  metrics: {
    avgLatency?: number;
    errorRate?: number;
    dailyCost?: number;
  },
  evidence?: Partial<Record<Alert['type'], AlertHistory['evidenceTrace']>>
): AlertHistory[] {
  const alerts = getAlertsByProject(projectId).filter((a) => a.enabled);
  const triggered: AlertHistory[] = [];

  for (const alert of alerts) {
    let shouldTrigger = false;
    let message = '';
    let actual: number | null = null;

    switch (alert.type) {
      case 'latency':
        if (metrics.avgLatency !== undefined && metrics.avgLatency > alert.threshold) {
          shouldTrigger = true;
          actual = metrics.avgLatency;
          message = `延迟告警：平均延迟 ${metrics.avgLatency.toFixed(0)}ms > 阈值 ${alert.threshold}ms`;
        }
        break;
      case 'error_rate':
        if (metrics.errorRate !== undefined && metrics.errorRate > alert.threshold) {
          shouldTrigger = true;
          actual = metrics.errorRate;
          message = `错误率告警：错误率 ${(metrics.errorRate * 100).toFixed(1)}% > 阈值 ${(alert.threshold * 100).toFixed(1)}%`;
        }
        break;
      case 'cost':
        if (metrics.dailyCost !== undefined && metrics.dailyCost > alert.threshold) {
          shouldTrigger = true;
          actual = metrics.dailyCost;
          message = `成本告警：近 1 天成本 $${metrics.dailyCost.toFixed(4)} > 阈值 $${alert.threshold}`;
        }
        break;
      case 'custom':
        try {
          const context = { metrics, alert };
          shouldTrigger = Boolean(new Function('context', `return ${alert.condition}`)(context));
          if (shouldTrigger) {
            message = `自定义告警「${alert.name}」触发`;
          }
        } catch {
          console.error(`Invalid custom alert condition: ${alert.condition}`);
        }
        break;
    }

    if (shouldTrigger) {
      const fingerprint = buildFingerprint(alert);
      if (isSuppressed(projectId, fingerprint)) {
        continue;
      }

      const historyEntry: AlertHistory = {
        id: uuidv4(),
        alertId: alert.id,
        projectId,
        alertName: alert.name,
        alertType: alert.type,
        threshold: alert.threshold,
        actual,
        metrics,
        condition: alert.type === 'custom' ? alert.condition : undefined,
        fingerprint,
        ignoredUntil: null,
        evidenceTrace: evidence?.[alert.type],
        message,
        triggeredAt: new Date(),
      };
      alertHistoryStore.set(historyEntry.id, historyEntry);
      triggered.push(historyEntry);

      alert.lastTriggered = historyEntry.triggeredAt;
      alertsStore.set(alert.id, alert);

      sendNotification(message);
    }
  }

  return triggered;
}

export function sendNotification(message: string): void {
  console.log(`[ALERT] ${new Date().toISOString()}: ${message}`);
}
