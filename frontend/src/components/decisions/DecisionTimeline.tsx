import React from 'react';
import { Decision } from '../../types/decision';
import './DecisionTimeline.css';
import { useTranslation } from '../../App';

interface DecisionTimelineProps {
  decisions: Decision[];
  onDecisionClick?: (decision: Decision) => void;
  enableEnterAnimation?: boolean;
}

export const DecisionTimeline: React.FC<DecisionTimelineProps> = ({
  decisions,
  onDecisionClick,
  enableEnterAnimation = false,
}) => {
  const { t, lang } = useTranslation();

  const getDecisionMakerLabel = (maker: string) => {
    switch (maker) {
      case 'rule':
        return t.decisionMakerRule;
      case 'llm':
        return t.decisionMakerLLM;
      case 'human':
        return t.decisionMakerHuman;
      case 'hybrid':
        return t.decisionMakerHybrid;
      default:
        return t.decisionMakerUnknown;
    }
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'gray';
    if (confidence >= 0.8) return 'green';
    if (confidence >= 0.5) return 'yellow';
    return 'red';
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatLatency = (latencyMs: number | null) => {
    if (latencyMs === null) return '-';
    if (latencyMs < 1000) return lang === 'zh' ? `${latencyMs}毫秒` : `${latencyMs}ms`;
    return lang === 'zh' ? `${(latencyMs / 1000).toFixed(2)}秒` : `${(latencyMs / 1000).toFixed(2)}s`;
  };

  if (decisions.length === 0) {
    return (
      <div className="decision-timeline empty">
        <div className="empty-icon">-</div>
        <p>{t.noDecisionsRecorded}</p>
        <p className="empty-hint">{t.noDecisionsHint}</p>
      </div>
    );
  }

  return (
    <div className="decision-timeline">
      {decisions.map((decision, index) => (
        <div
          key={decision.id}
          className={`decision-item ${enableEnterAnimation ? 'animate' : ''} ${onDecisionClick ? 'clickable' : ''}`}
          onClick={() => onDecisionClick?.(decision)}
          style={enableEnterAnimation ? { animationDelay: `${index * 0.05}s` } : undefined}
        >
          <div className="decision-content">
            <div className="decision-header">
              <div className="decision-type">{decision.decision_type}</div>
              <div className="decision-time">{formatTime(decision.created_at)}</div>
            </div>

            <div className="decision-body">
              <div className="selected-option">
                <span className="label">{t.selectedLabel}:</span>
                <span className="value">{decision.selected_option}</span>
              </div>

              {decision.confidence !== null && (
                <div className={`confidence-badge ${getConfidenceColor(decision.confidence)}`}>
                  {(decision.confidence * 100).toFixed(0)}%
                </div>
              )}
            </div>

            <div className="decision-footer">
              <span className="decision-maker">
                {getDecisionMakerLabel(decision.decision_maker)}
              </span>
              {decision.latency_ms !== null && (
                <span className="latency">{formatLatency(decision.latency_ms)}</span>
              )}
              {decision.options.length > 0 && (
                <span className="options-count">{decision.options.length} {t.optionsUnit}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
