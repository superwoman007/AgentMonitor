import React from 'react';
import { DecisionStats } from '../../types/decision';
import './DecisionStatsCard.css';

interface DecisionStatsCardProps {
  stats: DecisionStats;
}

export const DecisionStatsCard: React.FC<DecisionStatsCardProps> = ({ stats }) => {
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'excellent';
    if (confidence >= 0.6) return 'good';
    if (confidence >= 0.4) return 'fair';
    return 'poor';
  };

  return (
    <div className="decision-stats-card">
      <div className="stats-grid">
        <div className="stat-item total">
          <div className="stat-value">{formatNumber(stats.totalDecisions)}</div>
          <div className="stat-label">Total Decisions</div>
        </div>

        <div className="stat-item confidence">
          <div className={`stat-value ${getConfidenceColor(stats.avgConfidence)}`}>
            {(stats.avgConfidence * 100).toFixed(1)}%
          </div>
          <div className="stat-label">Avg Confidence</div>
        </div>

        <div className="stat-item latency">
          <div className="stat-value">
            {stats.avgLatencyMs < 1000
              ? `${Math.round(stats.avgLatencyMs)}ms`
              : `${(stats.avgLatencyMs / 1000).toFixed(2)}s`}
          </div>
          <div className="stat-label">Avg Latency</div>
        </div>

        <div className="stat-item recent">
          <div className="stat-value">{formatNumber(stats.recentDecisions)}</div>
          <div className="stat-label">Last 24h</div>
        </div>
      </div>
    </div>
  );
};

export default DecisionStatsCard;
