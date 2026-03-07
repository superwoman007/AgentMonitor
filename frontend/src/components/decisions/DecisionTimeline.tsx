import React from 'react';
import { Decision } from '../../types/decision';
import './DecisionTimeline.css';

interface DecisionTimelineProps {
  decisions: Decision[];
  onDecisionClick?: (decision: Decision) => void;
}

export const DecisionTimeline: React.FC<DecisionTimelineProps> = ({
  decisions,
  onDecisionClick,
}) => {
  const getDecisionMakerIcon = (maker: string) => {
    switch (maker) {
      case 'rule':
        return '📋';
      case 'llm':
        return '🤖';
      case 'human':
        return '👤';
      case 'hybrid':
        return '⚡';
      default:
        return '❓';
    }
  };

  const getDecisionMakerLabel = (maker: string) => {
    switch (maker) {
      case 'rule':
        return 'Rule-based';
      case 'llm':
        return 'LLM';
      case 'human':
        return 'Human';
      case 'hybrid':
        return 'Hybrid';
      default:
        return 'Unknown';
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
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatLatency = (latencyMs: number | null) => {
    if (latencyMs === null) return '-';
    if (latencyMs < 1000) return `${latencyMs}ms`;
    return `${(latencyMs / 1000).toFixed(2)}s`;
  };

  if (decisions.length === 0) {
    return (
      <div className="decision-timeline empty">
        <div className="empty-icon">📊</div>
        <p>No decisions recorded yet</p>
        <p className="empty-hint">Decisions will appear here when your agent makes choices</p>
      </div>
    );
  }

  return (
    <div className="decision-timeline">
      {decisions.map((decision, index) => (
        <div
          key={decision.id}
          className={`decision-item ${onDecisionClick ? 'clickable' : ''}`}
          onClick={() => onDecisionClick?.(decision)}
          style={{ animationDelay: `${index * 0.05}s` }}
        >
          <div className="decision-marker">
            <span className="decision-icon">{getDecisionMakerIcon(decision.decision_maker)}</span>
            <div className="timeline-line" />
          </div>

          <div className="decision-content">
            <div className="decision-header">
              <div className="decision-type">{decision.decision_type}</div>
              <div className="decision-time">{formatTime(decision.created_at)}</div>
            </div>

            <div className="decision-body">
              <div className="selected-option">
                <span className="label">Selected:</span>
                <span className="value">{decision.selected_option}</span>
              </div>

              {decision.confidence !== null && (
                <div className={`confidence-badge ${getConfidenceColor(decision.confidence)}`}>
                  Confidence: {(decision.confidence * 100).toFixed(1)}%
                </div>
              )}
            </div>

            <div className="decision-footer">
              <span className="decision-maker">{getDecisionMakerLabel(decision.decision_maker)}</span>
              {decision.latency_ms !== null && (
                <span className="latency">⏱️ {formatLatency(decision.latency_ms)}</span>
              )}
              {decision.options.length > 0 && (
                <span className="options-count">{decision.options.length} options</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
