import { useState, useEffect, useCallback, useRef, type FC } from 'react';
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

export const DecisionMonitor: FC<DecisionMonitorProps> = ({
  projectId,
  sessionId,
  refreshInterval = 5000,
}) => {
  const { t } = useTranslation();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<DecisionStats | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enableEnterAnimation, setEnableEnterAnimation] = useState(true);

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

      <div className="decisions-section">
        <h3>{t.recentDecisions} ({decisions.length})</h3>
        <DecisionTimeline
          decisions={decisions}
          onDecisionClick={setSelectedDecision}
          enableEnterAnimation={enableEnterAnimation}
        />
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
