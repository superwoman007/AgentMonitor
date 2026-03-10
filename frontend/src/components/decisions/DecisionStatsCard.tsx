import React from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { DecisionStats } from '../../types/decision';
import './DecisionStatsCard.css';
import { useTranslation } from '../../App';

interface DecisionStatsCardProps {
  stats: DecisionStats;
}

const TYPE_COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899'];
const MAKER_COLORS: Record<string, string> = {
  rule: '#1d4ed8',
  llm: '#059669',
  human: '#d97706',
  hybrid: '#7c3aed',
};

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

  // Prepare pie chart data for decision types
  const decisionTypeData = Object.entries(stats.decisionsByType)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Prepare pie chart data for decision makers
  const decisionMakerData = Object.entries(stats.decisionsByMaker)
    .map(([name, value]) => {
      const labelMap: Record<string, string> = {
        rule: t.decisionMakerRule,
        llm: t.decisionMakerLLM,
        human: t.decisionMakerHuman,
        hybrid: t.decisionMakerHybrid,
      };
      return {
        name,
        label: labelMap[name] || t.decisionMakerUnknown,
        value,
      };
    })
    .sort((a, b) => b.value - a.value);

  const chartTooltipFormatter = (value: number | string) => formatNumber(Number(value));

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

      {/* Distribution Charts */}
      <div className="distribution-grid">
        <div className="distribution-panel">
          <div className="section-title">{t.decisionsByType}</div>
          {decisionTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={decisionTypeData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={60}
                  innerRadius={35}
                >
                  {decisionTypeData.map((entry, index) => (
                    <Cell key={entry.name} fill={TYPE_COLORS[index % TYPE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={chartTooltipFormatter} />
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-chart">{t.noData}</div>
          )}
        </div>

        <div className="distribution-panel">
          <div className="section-title">{t.decisionsByMaker}</div>
          {decisionMakerData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={decisionMakerData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="45%"
                  outerRadius={60}
                  innerRadius={35}
                >
                  {decisionMakerData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={MAKER_COLORS[entry.name] || '#6b7280'}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={chartTooltipFormatter} />
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-chart">{t.noData}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DecisionStatsCard;
