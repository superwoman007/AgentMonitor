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
  message: string;
  triggeredAt: Date;
}

const alertsStore: Map<string, Alert> = new Map();
const alertHistoryStore: Map<string, AlertHistory> = new Map();

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

  const updated = { ...alert, ...data };
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

export function checkAlerts(
  projectId: string,
  metrics: {
    avgLatency?: number;
    errorRate?: number;
    dailyCost?: number;
  }
): AlertHistory[] {
  const alerts = getAlertsByProject(projectId).filter((a) => a.enabled);
  const triggered: AlertHistory[] = [];

  for (const alert of alerts) {
    let shouldTrigger = false;
    let message = '';

    switch (alert.type) {
      case 'latency':
        if (metrics.avgLatency !== undefined && metrics.avgLatency > alert.threshold) {
          shouldTrigger = true;
          message = `High latency alert: ${metrics.avgLatency.toFixed(0)}ms exceeds threshold of ${alert.threshold}ms`;
        }
        break;
      case 'error_rate':
        if (metrics.errorRate !== undefined && metrics.errorRate > alert.threshold) {
          shouldTrigger = true;
          message = `High error rate alert: ${(metrics.errorRate * 100).toFixed(1)}% exceeds threshold of ${(alert.threshold * 100).toFixed(1)}%`;
        }
        break;
      case 'cost':
        if (metrics.dailyCost !== undefined && metrics.dailyCost > alert.threshold) {
          shouldTrigger = true;
          message = `High daily cost alert: $${metrics.dailyCost.toFixed(2)} exceeds threshold of $${alert.threshold}`;
        }
        break;
      case 'custom':
        try {
          const context = { metrics, alert };
          shouldTrigger = Boolean(new Function('context', `return ${alert.condition}`)(context));
          if (shouldTrigger) {
            message = `Custom alert "${alert.name}" triggered`;
          }
        } catch {
          console.error(`Invalid custom alert condition: ${alert.condition}`);
        }
        break;
    }

    if (shouldTrigger) {
      const historyEntry: AlertHistory = {
        id: uuidv4(),
        alertId: alert.id,
        projectId,
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
