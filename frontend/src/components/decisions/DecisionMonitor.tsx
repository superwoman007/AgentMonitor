import React, { useState, useEffect, useCallback } from 'react';
import { Decision, DecisionStats } from '../../types/decision';
import { DecisionTimeline } from './DecisionTimeline';
import { DecisionStatsCard } from './DecisionStatsCard';
import { DecisionDetailModal } from './DecisionDetailModal';
import { useApi } from '../../hooks/useApi';

interface DecisionMonitorProps {
  projectId: string;
  sessionId?: string;
  refreshInterval?: number;
}

export const DecisionMonitor: React.FC<DecisionMonitorProps> = ({
  projectId,
  sessionId,
  refreshInterval = 5000,
}) => {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<DecisionStats | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchApi } = useApi();

  const fetchDecisions = useCallback(async () => {
    try {
      const url = sessionId
        ? `/api/v1/sessions/${sessionId}/decisions`
        : `/api/v1/projects/${projectId}/decisions?limit=100`;
      
      const data = await fetchApi(url);
      setDecisions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch decisions');
    }
  }, [projectId, sessionId, fetchApi]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await fetchApi(`/api/v1/projects/${projectId}/decisions/stats`);
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch decision stats:', err);
    }
  }, [projectId, fetchApi]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchDecisions(), fetchStats()]);
      setLoading(false);
    };

    loadData();

    // Set up auto-refresh
    const interval = setInterval(() => {
      fetchDecisions();
      fetchStats();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchDecisions, fetchStats, refreshInterval]);

  if (loading) {
    return (
      <div className="decision-monitor loading">
        <div className="spinner" />
        <p>Loading decisions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="decision-monitor error">
        <div className="error-icon">⚠️</div>
        <p>{error}</p>
        <button onClick={fetchDecisions}>Retry</button>
      </div>
    );
  }

  return (
    <div className="decision-monitor">
      <div className="monitor-header">
        <h2>Decision Monitor</h2>
        <div className="refresh-info">
          Auto-refresh: {refreshInterval / 1000}s
        </div>
      </div>

      {stats && <DecisionStatsCard stats={stats} />}

      <div className="decisions-section">
        <h3>Recent Decisions ({decisions.length})</h3>
        <DecisionTimeline
          decisions={decisions}
          onDecisionClick={setSelectedDecision}
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
