import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useProjectStore } from '../stores/projectStore';
import { api, Alert, AlertHistory } from '../api';
import { useTranslation } from '../App';

interface AlertFormData {
  name: string;
  type: 'latency' | 'error_rate' | 'cost' | 'custom';
  condition: string;
  threshold: number;
  enabled: boolean;
}

const initialFormData: AlertFormData = {
  name: '',
  type: 'latency',
  condition: '',
  threshold: 0,
  enabled: true,
};

export function AlertsPage() {
  const { currentProject, ensureDefaultProject } = useProjectStore();
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<AlertHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);
  const [formData, setFormData] = useState<AlertFormData>(initialFormData);
  const [ignoringHistoryId, setIgnoringHistoryId] = useState<string | null>(null);

  useEffect(() => {
    ensureDefaultProject().finally(() => setBootstrapped(true));
  }, [ensureDefaultProject]);

  const fetchData = async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const res = await api.alerts.list(currentProject.id);
      setAlerts(res.alerts);
      setHistory(res.history);
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!bootstrapped) return;
    if (!currentProject) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [bootstrapped, currentProject?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;

    try {
      if (editingAlert) {
        await api.alerts.update(editingAlert.id, formData);
      } else {
        await api.alerts.create(currentProject.id, formData);
      }
      setShowModal(false);
      setEditingAlert(null);
      setFormData(initialFormData);
      fetchData();
    } catch (error) {
      console.error('Failed to save alert:', error);
    }
  };

  const handleEdit = (alert: Alert) => {
    setEditingAlert(alert);
    setFormData({
      name: alert.name,
      type: alert.type,
      condition: alert.condition,
      threshold: alert.threshold,
      enabled: alert.enabled,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await api.alerts.delete(id);
      fetchData();
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const handleToggle = async (alert: Alert) => {
    try {
      await api.alerts.update(alert.id, { enabled: !alert.enabled });
      fetchData();
    } catch (error) {
      console.error('Failed to toggle alert:', error);
    }
  };

  const handleCheckNow = async () => {
    if (!currentProject) return;
    setChecking(true);
    try {
      await api.alerts.check(currentProject.id);
      fetchData();
    } catch (error) {
      console.error('Failed to check alerts:', error);
    } finally {
      setChecking(false);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'latency': return t.latencyAlert;
      case 'error_rate': return t.errorRateAlert;
      case 'cost': return t.costAlert;
      case 'custom': return t.customAlert;
      default: return type;
    }
  };

  const formatThreshold = (alert: Alert) => {
    if (alert.type === 'error_rate') {
      return `${(alert.threshold * 100).toFixed(1)}%`;
    }
    if (alert.type === 'cost') {
      return `$${alert.threshold}`;
    }
    return `${alert.threshold}ms`;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };
  

  const formatHistorySummary = (h: AlertHistory) => {
    if (!h.alertType || h.threshold === undefined || h.actual === undefined) return null;
    if (h.alertType === 'latency' && typeof h.actual === 'number') {
      return `平均延迟 ${h.actual.toFixed(0)}ms > 阈值 ${h.threshold}ms`;
    }
    if (h.alertType === 'error_rate' && typeof h.actual === 'number') {
      return `错误率 ${(h.actual * 100).toFixed(1)}% > 阈值 ${(h.threshold * 100).toFixed(1)}%`;
    }
    if (h.alertType === 'cost' && typeof h.actual === 'number') {
      return `近 1 天成本 $${h.actual.toFixed(4)} > 阈值 $${h.threshold}`;
    }
    return null;
  };
  
  const formatEvidence = (h: AlertHistory) => {
    const e = h.evidenceTrace;
    if (!e) return null;

    const parts: string[] = [];
    parts.push(`${e.traceType}/${e.name}`);
    if (typeof e.latencyMs === 'number') parts.push(`延迟 ${e.latencyMs}ms`);
    if (e.status) parts.push(`状态 ${e.status}`);
    if (typeof e.cost === 'number') parts.push(`成本 $${e.cost.toFixed(4)}`);

    return parts.join(' · ');
  };

  const isHistoryIgnored = (h: AlertHistory) => {
    if (!h.ignoredUntil) return false;
    const d = new Date(h.ignoredUntil);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() > Date.now();
  };

  const formatHistoryIgnoredUntil = (h: AlertHistory) => {
    if (!h.ignoredUntil) return null;
    const d = new Date(h.ignoredUntil);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  };

  const handleIgnoreSimilar = async (historyId: string, minutes: number) => {
    setIgnoringHistoryId(historyId);
    try {
      await api.alerts.ignoreHistory(historyId, minutes);
      fetchData();
    } catch (error) {
      console.error('Failed to ignore similar alert history:', error);
    } finally {
      setIgnoringHistoryId(null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">{t.loading}</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.alertManagement}</h1>
          <p className="text-gray-500 text-sm mt-1">{t.alertDesc}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheckNow}
            disabled={checking || !currentProject}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {t.checkNow}
          </button>
          <button
            onClick={() => {
              setEditingAlert(null);
              setFormData(initialFormData);
              setShowModal(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {t.addAlert}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.alertRules}</h3>
          {alerts.length > 0 ? (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${alert.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="font-medium">{alert.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggle(alert)}
                        className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                      >
                        {alert.enabled ? t.disable : t.enable}
                      </button>
                      <button
                        onClick={() => handleEdit(alert)}
                        className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                      >
                        {t.edit}
                      </button>
                      <button
                        onClick={() => handleDelete(alert.id)}
                        className="text-xs px-2 py-1 rounded border text-red-600 hover:bg-red-50"
                      >
                        {t.delete}
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    <span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs mr-2">
                      {getTypeLabel(alert.type)}
                    </span>
                    <span>阈值: {formatThreshold(alert)}</span>
                  </div>
                  {alert.lastTriggered && (
                    <div className="text-xs text-gray-400 mt-2">
                      {t.lastTriggered}: {formatDate(alert.lastTriggered)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">{t.noAlerts}</div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.alertHistory}</h3>
          {history.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {history.map((h) => (
                <div key={h.id} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                  <div className="text-sm text-red-800">{h.message}</div>
                  {formatHistorySummary(h) && (
                    <div className="text-xs text-red-700 mt-1">{formatHistorySummary(h)}</div>
                  )}
                  {formatHistoryIgnoredUntil(h) && (
                    <div className="text-xs text-amber-700 mt-1">
                      {t.ignoredHistoryUntil}: {formatHistoryIgnoredUntil(h)}
                    </div>
                  )}
                  {h.evidenceTrace && (
                    <div className="text-xs text-gray-700 mt-1">
                      <span className="text-gray-500">关联调用：</span>
                      {formatEvidence(h)}
                      {h.evidenceTrace.sessionId && (
                        <>
                          <span className="text-gray-500"> · 会话：</span>
                          <Link
                            to={`/sessions/${h.evidenceTrace.sessionId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {h.evidenceTrace.sessionId}
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-red-500 mt-1">{formatDate(h.triggeredAt)}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      className="text-xs px-2 py-1 rounded border bg-white"
                      defaultValue="60"
                      disabled={ignoringHistoryId === h.id || isHistoryIgnored(h)}
                      onChange={(e) => handleIgnoreSimilar(h.id, parseInt(e.target.value, 10))}
                    >
                      <option value="10">{t.ignore10m}</option>
                      <option value="60">{t.ignore1h}</option>
                      <option value="1440">{t.ignore24h}</option>
                    </select>
                    <button
                      onClick={() => handleIgnoreSimilar(h.id, 60)}
                      disabled={ignoringHistoryId === h.id || isHistoryIgnored(h)}
                      className="text-xs px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-50"
                    >
                      {t.ignoreSimilar}
                    </button>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-blue-600 text-xs">{t.viewDetails}</summary>
                    <pre className="mt-2 bg-white/60 p-3 rounded text-xs overflow-auto whitespace-pre-wrap break-words max-h-80">
                      {JSON.stringify(h, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">{t.noAlertHistory}</div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">
              {editingAlert ? t.editAlert : t.addAlert}
            </h3>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.alertName}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.alertType}
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as AlertFormData['type'] })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="latency">{t.latencyAlert}</option>
                    <option value="error_rate">{t.errorRateAlert}</option>
                    <option value="cost">{t.costAlert}</option>
                    <option value="custom">{t.customAlert}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.threshold}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.threshold}
                    onChange={(e) => setFormData({ ...formData, threshold: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.type === 'latency' && t.latencyThresholdHint}
                    {formData.type === 'error_rate' && t.errorRateThresholdHint}
                    {formData.type === 'cost' && t.costThresholdHint}
                  </p>
                </div>
                {formData.type === 'custom' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t.condition}
                    </label>
                    <input
                      type="text"
                      value={formData.condition}
                      onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
                      placeholder="context.metrics.avgLatency > 1000"
                    />
                    <p className="text-xs text-gray-500 mt-1">{t.customConditionHint}</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    className="rounded"
                  />
                  <label htmlFor="enabled" className="text-sm text-gray-700">{t.enabled}</label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingAlert ? t.update : t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
