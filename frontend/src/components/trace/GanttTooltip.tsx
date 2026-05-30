import { SpanTreeNode } from '../../api';

interface GanttTooltipProps {
  span: SpanTreeNode;
  x: number;
  y: number;
}

const formatDuration = (ms: number | null) => {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export function GanttTooltip({ span, x, y }: GanttTooltipProps) {
  const tokens = span.tokens;
  const totalTokens = tokens ? (tokens.total ?? ((tokens.prompt ?? 0) + (tokens.completion ?? 0))) : null;

  return (
    <div
      className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 pointer-events-none max-w-xs"
      style={{ left: x + 12, top: y - 10 }}
      role="tooltip"
    >
      <div className="font-semibold mb-1 truncate">{span.name}</div>
      <div className="space-y-0.5 text-gray-300">
        <div className="flex justify-between gap-4">
          <span>Latency:</span>
          <span className="text-white">{formatDuration(span.latencyMs)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Status:</span>
          <span className={span.status === 'error' ? 'text-red-400' : 'text-green-400'}>{span.status}</span>
        </div>
        {totalTokens !== null && totalTokens > 0 && (
          <div className="flex justify-between gap-4">
            <span>Tokens:</span>
            <span className="text-white">{totalTokens.toLocaleString()}</span>
          </div>
        )}
        {span.costUsd !== null && span.costUsd > 0 && (
          <div className="flex justify-between gap-4">
            <span>Cost:</span>
            <span className="text-white">${span.costUsd.toFixed(4)}</span>
          </div>
        )}
        {span.error && (
          <div className="mt-1 text-red-400 truncate">{span.error}</div>
        )}
      </div>
    </div>
  );
}
