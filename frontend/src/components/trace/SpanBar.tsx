import { SpanTreeNode } from '../../api';

interface SpanBarProps {
  node: SpanTreeNode;
  depth: number;
  totalDuration: number;
  traceStart: number;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  sortByLatency: boolean;
}

/**
 * 格式化持续时间
 * @param ms - 毫秒数
 * @returns 格式化后的字符串
 */
const formatDuration = (ms: number | null) => {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * 获取 Span 状态对应的颜色类名
 * @param status - Span 状态
 * @returns Tailwind 颜色类名
 */
const getStatusColor = (status: string): string => {
  if (status === 'success') return 'bg-green-500';
  if (status === 'error') return 'bg-red-500';
  return 'bg-gray-400';
};

/**
 * SpanBar 组件
 * 甘特图中单个 Span 的条形表示
 */
export function SpanBar({
  node,
  depth,
  totalDuration,
  traceStart,
  selectedSpanId,
  onSelectSpan,
  sortByLatency,
}: SpanBarProps) {
  const startMs = new Date(node.startedAt).getTime();
  const leftPercent = ((startMs - traceStart) / totalDuration) * 100;
  const widthPercent = ((node.latencyMs ?? 0) / totalDuration) * 100;
  const isSelected = selectedSpanId === node.spanId;

  return (
    <div className="relative">
      {/* Span 条形行 */}
      <div
        className="flex items-center gap-2 py-1 hover:bg-gray-50 cursor-pointer"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onSelectSpan(node.spanId)}
      >
        {/* Span 名称 */}
        <div className="w-48 shrink-0 text-xs text-gray-700 truncate">
          {node.name}
        </div>

        {/* 甘特图条形区域 */}
        <div className="flex-1 relative h-6 bg-gray-100 rounded overflow-hidden">
          <div
            className={`absolute top-1 h-4 rounded ${getStatusColor(node.status)} transition-all ${
              isSelected ? 'ring-2 ring-blue-400' : ''
            }`}
            style={{
              left: `${Math.max(0, leftPercent)}%`,
              width: `${Math.max(1, Math.min(100 - leftPercent, widthPercent))}%`,
            }}
            title={`${node.name}: ${formatDuration(node.latencyMs)} (${node.status})`}
          />
        </div>

        {/* 延迟数值 */}
        <div className="w-16 text-right text-xs text-gray-500 shrink-0">
          {formatDuration(node.latencyMs)}
        </div>
      </div>

      {/* 递归渲染子节点 */}
      {node.children.length > 0 && (
        <div>
          {node.children.map(child => (
            <SpanBar
              key={child.spanId}
              node={child}
              depth={depth + 1}
              totalDuration={totalDuration}
              traceStart={traceStart}
              selectedSpanId={selectedSpanId}
              onSelectSpan={onSelectSpan}
              sortByLatency={sortByLatency}
            />
          ))}
        </div>
      )}
    </div>
  );
}
