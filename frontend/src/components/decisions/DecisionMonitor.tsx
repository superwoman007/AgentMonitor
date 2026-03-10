import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Decision, DecisionStats } from '../../types/decision';
import { DecisionTimeline } from './DecisionTimeline';
import { DecisionStatsCard } from './DecisionStatsCard';
import { DecisionDetailModal } from './DecisionDetailModal';
import { useApi } from '../../hooks/useApi';
import { useTranslation } from '../../App';
import './DecisionMonitor.css';

interface DecisionMonitorProps {
  projectId: string;
  sessionId?: string;
  refreshInterval?: number;
}

type ViewMode = 'timeline' | 'table';

export const DecisionMonitor: React.FC<DecisionMonitorProps> = ({
  projectId,
  sessionId,
  refreshInterval = 5000,
}) => {
  const { t, lang } = useTranslation();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<DecisionStats | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enableEnterAnimation, setEnableEnterAnimation] = useState(true);

  // Filter states
  const [filterType, setFilterType] = useState<string>('all');
  const [filterMaker, setFilterMaker] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  const { fetchApi } = useApi();
  const pollingRef = useRef<{ stopped: boolean; inFlight: boolean }>({ stopped: false, inFlight: false });

  const isSameDecisions = useCallback((prev: Decision[], next: Decision[]) => {
    if (prev === next) return true;
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].id !== next[i].id) return false;
      if (prev[i].created_at !== next[i].created_at) return false;
    }
    return true;
  }, []);

  const fetchDecisions = useCallback(async () => {
    try {
      const url = sessionId
        ? `/api/v1/sessions/${sessionId}/decisions`
        : `/api/v1/projects/${projectId}/decisions?limit=100`;
      
      const data = await fetchApi(url);
      setDecisions((prev) => (Array.isArray(data) && isSameDecisions(prev, data) ? prev : data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.fetchDecisionsFailed);
    }
  }, [projectId, sessionId, fetchApi, isSameDecisions, t.fetchDecisionsFailed]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await fetchApi(`/api/v1/projects/${projectId}/decisions/stats`);
      setStats(data);
    } catch (err) {
      return;
    }
  }, [projectId, fetchApi]);

  useEffect(() => {
    pollingRef.current.stopped = false;
    pollingRef.current.inFlight = false;

    const loadOnce = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchDecisions(), fetchStats()]);
      } finally {
        setLoading(false);
        setEnableEnterAnimation(false);
      }
    };

    const loop = async () => {
      if (pollingRef.current.stopped) return;
      if (pollingRef.current.inFlight) return;

      pollingRef.current.inFlight = true;
      try {
        await Promise.all([fetchDecisions(), fetchStats()]);
      } finally {
        pollingRef.current.inFlight = false;
      }

      if (pollingRef.current.stopped) return;
      window.setTimeout(loop, refreshInterval);
    };

    loadOnce().then(() => {
      window.setTimeout(loop, refreshInterval);
    });

    return () => {
      pollingRef.current.stopped = true;
    };
  }, [fetchDecisions, fetchStats, refreshInterval]);

  // Get unique decision types and makers for filter dropdowns
  const decisionTypes = useMemo(() => {
    const types = new Set(decisions.map((d) => d.decision_type));
    return Array.from(types).sort();
  }, [decisions]);

  const decisionMakers = useMemo(() => {
    const makers = new Set(decisions.map((d) => d.decision_maker));
    return Array.from(makers).sort();
  }, [decisions]);

  // Filter decisions
  const filteredDecisions = useMemo(() => {
    return decisions.filter((d) => {
      if (filterType !== 'all' && d.decision_type !== filterType) return false;
      if (filterMaker !== 'all' && d.decision_maker !== filterMaker) return false;
      return true;
    });
  }, [decisions, filterType, filterMaker]);

  // Prepare trend data (group by hour for last 24h)
  const trendData = useMemo(() => {
    const now = new Date();
    const hourBuckets: Record<string, { hour: string; count: number; avgConfidence: number; confidenceSum: number }> = {};

    // Initialize last 24 hours
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      const key = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
      hourBuckets[key] = { hour: key, count: 0, avgConfidence: 0, confidenceSum: 0 };
    }

    decisions.forEach((decision) => {
      const d = new Date(decision.created_at);
      const hoursDiff = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
      if (hoursDiff <= 24) {
        const key = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
        if (hourBuckets[key]) {
          hourBuckets[key].count += 1;
          if (decision.confidence !== null) {
            hourBuckets[key].confidenceSum += decision.confidence;
          }
        }
      }
    });

    return Object.values(hourBuckets).map((b) => ({
      ...b,
      avgConfidence: b.count > 0 ? Math.round((b.confidenceSum / b.count) * 100) : 0,
    }));
  }, [decisions]);

  const getMakerLabel = (maker: string) => {
    const labelMap: Record<string, string> = {
      rule: t.decisionMakerRule,
      llm: t.decisionMakerLLM,
      human: t.decisionMakerHuman,
      hybrid: t.decisionMakerHybrid,
    };
    return labelMap[maker] || t.decisionMakerUnknown;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatLatency = (latencyMs: number | null) => {
    if (latencyMs === null) return '-';
    if (latencyMs < 1000) return lang === 'zh' ? `${latencyMs}毫秒` : `${latencyMs}ms`;
    return lang === 'zh' ? `${(latencyMs / 1000).toFixed(2)}秒` : `${(latencyMs / 1000).toFixed(2)}s`;
  };

  if (loading && decisions.length === 0) {
    return (
      <div className="decision-monitor loading">
        <div className="spinner" />
        <p>{t.loadingDecisions}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="decision-monitor error">
        <div className="error-icon">!</div>
        <p>{error}</p>
        <button onClick={fetchDecisions}>{t.retry}</button>
      </div>
    );
  }

  return (
    <div className="decision-monitor">
      <div className="monitor-header">
        <h2>{t.decisions}</h2>
        <div className="refresh-info">
          {t.autoRefresh}: {refreshInterval / 1000}s
        </div>
      </div>

      {stats && <DecisionStatsCard stats={stats} />}

      {/* Trend Chart */}
      <div className="trend-section">
        <div className="section-title">{t.decisionTrend}</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" orientation="left" stroke="#2563eb" />
            <YAxis yAxisId="right" orientation="right" stroke="#10b981" />
            <Tooltip />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="count"
              stroke="#2563eb"
              strokeWidth={2}
              name={t.totalDecisions}
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="avgConfidence"
              stroke="#10b981"
              strokeWidth={2}
              name={t.avgConfidence}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Filters and View Toggle */}
      <div className="decisions-section">
        <div className="section-header">
          <h3>{t.recentDecisions} ({filteredDecisions.length})</h3>
          <div className="controls">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="filter-select"
            >
              <option value="all">{t.allTypes}</option>
              {decisionTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              value={filterMaker}
              onChange={(e) => setFilterMaker(e.target.value)}
              className="filter-select"
            >
              <option value="all">{t.allMakers}</option>
              {decisionMakers.map((maker) => (
                <option key={maker} value={maker}>
                  {getMakerLabel(maker)}
                </option>
              ))}
            </select>
            <div className="view-toggle">
              <button
                className={viewMode === 'timeline' ? 'active' : ''}
                onClick={() => setViewMode('timeline')}
                title={t.timelineView}
              >
                ⏱
              </button>
              <button
                className={viewMode === 'table' ? 'active' : ''}
                onClick={() => setViewMode('table')}
                title={t.tableView}
              >
                ☰
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'timeline' ? (
          <DecisionTimeline
            decisions={filteredDecisions}
            onDecisionClick={setSelectedDecision}
            enableEnterAnimation={enableEnterAnimation}
          />
        ) : (
          <div className="decisions-table-wrapper">
            <table className="decisions-table">
              <thead>
                <tr>
                  <th>{t.typeLabel}</th>
                  <th>{t.selectedLabel}</th>
                  <th>{t.confidenceLabel}</th>
                  <th>{t.makerLabel}</th>
                  <th>{t.latencyLabel}</th>
                  <th>{t.timeLabel}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDecisions.map((decision) => (
                  <tr
                    key={decision.id}
                    onClick={() => setSelectedDecision(decision)}
                    className="clickable"
                  >
                    <td className="type-cell">{decision.decision_type}</td>
                    <td>{decision.selected_option}</td>
                    <td>
                      {decision.confidence !== null
                        ? `${(decision.confidence * 100).toFixed(1)}%`
                        : '-'}
                    </td>
                    <td>{getMakerLabel(decision.decision_maker)}</td>
                    <td>{formatLatency(decision.latency_ms)}</td>
                    <td>{formatTime(decision.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDecision && (
        <DecisionDetailModal
          decision={selectedDecision}
          onClose={() => setSelectedDecision(null)}
        />
      )}
    </div>
  );
};

export default DecisionMonitor;
