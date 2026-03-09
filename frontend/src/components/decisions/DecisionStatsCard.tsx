import React from 'react';
import { DecisionStats } from '../../types/decision';
import './DecisionStatsCard.css';
import { useTranslation } from '../../App';

interface DecisionStatsCardProps {
  stats: DecisionStats;
}

export const DecisionStatsCard: React.FC<DecisionStatsCardProps> = ({ stats }) => {
  const { t, lang } = useTranslation();

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
          <div className="stat-label">{t.totalDecisions}</div>
        </div>

        <div className="stat-item confidence">
          <div className={`stat-value ${getConfidenceColor(stats.avgConfidence)}`}>
            {(stats.avgConfidence * 100).toFixed(1)}%
          </div>
          <div className="stat-label">{t.avgConfidence}</div>
        </div>

        <div className="stat-item latency">
          <div className="stat-value">
            {stats.avgLatencyMs < 1000
              ? (lang === 'zh' ? `${Math.round(stats.avgLatencyMs)}毫秒` : `${Math.round(stats.avgLatencyMs)}ms`)
              : (lang === 'zh' ? `${(stats.avgLatencyMs / 1000).toFixed(2)}秒` : `${(stats.avgLatencyMs / 1000).toFixed(2)}s`)}
          </div>
          <div className="stat-label">{t.avgLatency}</div>
        </div>

        <div className="stat-item recent">
          <div className="stat-value">{formatNumber(stats.recentDecisions)}</div>
          <div className="stat-label">{t.last24h}</div>
        </div>
      </div>
    </div>
  );
};

export default DecisionStatsCard;
