import React from 'react';
import { Decision } from '../../types/decision';
import './DecisionDetailModal.css';

interface DecisionDetailModalProps {
  decision: Decision;
  onClose: () => void;
}

export const DecisionDetailModal: React.FC<DecisionDetailModalProps> = ({
  decision,
  onClose,
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

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'gray';
    if (confidence >= 0.8) return 'green';
    if (confidence >= 0.5) return 'yellow';
    return 'red';
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Decision Details</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="decision-overview">
            <div className="overview-item">
              <span className="label">Type:</span>
              <span className="value type-badge">{decision.decision_type}</span>
            </div>
            <div className="overview-item">
              <span className="label">Maker:</span>
              <span className="value maker-badge">
                {getDecisionMakerIcon(decision.decision_maker)} {decision.decision_maker}
              </span>
            </div>
            <div className="overview-item">
              <span className="label">Time:</span>
              <span className="value">{formatTimestamp(decision.created_at)}</span>
            </div>
            <div className="overview-item">
              <span className="label">Latency:</span>
              <span className="value">{formatLatency(decision.latency_ms)}</span>
            </div>
          </div>

          {decision.confidence !== null && (
            <div className="confidence-section">
              <h3>Confidence</h3>
              <div className={`confidence-bar ${getConfidenceColor(decision.confidence)}`}>
                <div
                  className="confidence-fill"
                  style={{ width: `${decision.confidence * 100}%` }}
                />
                <span className="confidence-value">
                  {(decision.confidence * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          <div className="selected-option-section">
            <h3>Selected Option</h3>
            <div className="selected-option-card">
              <span className="option-name">{decision.selected_option}</span>
            </div>
          </div>

          {decision.reasoning && (
            <div className="reasoning-section">
              <h3>Reasoning</h3>
              <div className="reasoning-content">
                <p>{decision.reasoning}</p>
              </div>
            </div>
          )}

          {decision.options.length > 0 && (
            <div className="options-section">
              <h3>All Options ({decision.options.length})</h3>
              <div className="options-list">
                {decision.options.map((option) => (
                  <div
                    key={option.id}
                    className={`option-card ${
                      option.option_name === decision.selected_option ? 'selected' : ''
                    }`}
                  >
                    <div className="option-header">
                      <span className="option-name">{option.option_name}</span>
                      {option.score !== null && (
                        <span className="option-score">
                          Score: {(option.score * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>

                    {option.pros && option.pros.length > 0 && (
                      <div className="option-pros">
                        <span className="label">Pros:</span>
                        <ul>
                          {option.pros.map((pro, idx) => (
                            <li key={idx}>{pro}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {option.cons && option.cons.length > 0 && (
                      <div className="option-cons">
                        <span className="label">Cons:</span>
                        <ul>
                          {option.cons.map((con, idx) => (
                            <li key={idx}>{con}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {decision.context && Object.keys(decision.context).length > 0 && (
            <div className="context-section">
              <h3>Context</h3>
              <pre className="context-json">
                {JSON.stringify(decision.context, null, 2)}
              </pre>
            </div>
          )}

          {decision.metadata && Object.keys(decision.metadata).length > 0 && (
            <div className="metadata-section">
              <h3>Metadata</h3>
              <pre className="metadata-json">
                {JSON.stringify(decision.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DecisionDetailModal;
