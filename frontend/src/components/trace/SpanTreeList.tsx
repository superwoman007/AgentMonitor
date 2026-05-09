import { useState, useMemo, useCallback } from 'react';
import { SpanTreeNode } from '../../api';
import { useTranslation } from '../../App';

interface SpanTreeListProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  sortByLatency: boolean;
  onToggleSort: () => void;
}

/**
 * 状态颜色点组件
 * 根据 Span 状态返回对应颜色
 */
function StatusDot({ status }: { status: string }) {
  const colorClass =
    status === 'success'
      ? 'bg-green-500'
      : status === 'error'
      ? 'bg-red-500'
      : 'bg-gray-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${colorClass}`} />;
}

interface SpanTreeItemProps {
  node: SpanTreeNode;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  depth: number;
}

/**
 * 单个 Span 树节点项（递归渲染子节点）
 */
function SpanTreeItem({ node, selectedSpanId, onSelectSpan, depth }: SpanTreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  const formatDuration = (ms: number | null) => {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  return (
    <div>
      <div
        onClick={() => onSelectSpan(node.spanId)}
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-l-4 ${
          selectedSpanId === node.spanId
            ? 'bg-blue-50 border-blue-500'
            : 'border-transparent hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        {/* 展开/折叠按钮 */}
        {hasChildren ? (
          <button
            onClick={toggleExpand}
            className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-700 text-xs"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <StatusDot status={node.status} />

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">
            {node.name}
          </div>
          <div className="text-xs text-gray-500">
            {node.traceType} · {formatDuration(node.latencyMs)}
          </div>
        </div>
      </div>

      {/* 递归渲染子节点 */}
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <SpanTreeItem
              key={child.spanId}
              node={child}
              selectedSpanId={selectedSpanId}
              onSelectSpan={onSelectSpan}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Span 树列表组件
 * 支持折叠展开、按延迟排序、选中高亮
 */
export function SpanTreeList({
  spans,
  selectedSpanId,
  onSelectSpan,
  sortByLatency,
  onToggleSort,
}: SpanTreeListProps) {
  const { t } = useTranslation();
  /**
   * 递归按 latency 排序 spans
   */
  const sortSpansByLatency = useCallback((nodes: SpanTreeNode[]): SpanTreeNode[] => {
    const sorted = [...nodes].sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0));
    return sorted.map(node => ({
      ...node,
      children: sortSpansByLatency(node.children),
    }));
  }, []);

  const displaySpans = useMemo(() => {
    if (!sortByLatency) return spans;
    return sortSpansByLatency(spans);
  }, [spans, sortByLatency, sortSpansByLatency]);

  return (
    <div className="bg-white rounded-lg shadow-sm border flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{t.spanTree}</h3>
        <button
          onClick={onToggleSort}
          className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
            sortByLatency
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {sortByLatency ? `${t.latencySort} ↓` : t.latencySort}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {displaySpans.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">{t.noSpanData}</div>
        ) : (
          displaySpans.map(node => (
            <SpanTreeItem
              key={node.spanId}
              node={node}
              selectedSpanId={selectedSpanId}
              onSelectSpan={onSelectSpan}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  );
}
