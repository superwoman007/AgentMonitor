import { useMemo, useCallback, useState } from 'react';
import { SpanTreeNode } from '../../api';
import { SpanBar } from './SpanBar';
import { GanttTooltip } from './GanttTooltip';
import { GanttMinimap } from './GanttMinimap';
import { findCriticalPath } from '../../utils/criticalPath';
import { useTranslation } from '../../App';

export interface ZoomState {
  start: number; // 0-100 percent
  end: number;   // 0-100 percent
}

interface GanttChartProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  sortByLatency: boolean;
}

/**
 * 格式化持续时间（用于时间轴刻度）
 * @param ms - 毫秒数
 * @returns 格式化后的字符串
 */
const formatDuration = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * 递归按 latency 排序 spans
 * @param nodes - Span 节点数组
 * @returns 排序后的数组
 */
const sortSpansByLatency = (nodes: SpanTreeNode[]): SpanTreeNode[] => {
  const sorted = [...nodes].sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0));
  return sorted.map(node => ({
    ...node,
    children: sortSpansByLatency(node.children),
  }));
};

/**
 * 扁平化收集所有 spans（用于计算时间范围）
 * @param nodes - Span 节点数组
 * @returns 扁平化后的 Span 数组
 */
const flattenSpans = (nodes: SpanTreeNode[]): SpanTreeNode[] => {
  const result: SpanTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenSpans(node.children));
  }
  return result;
};

/**
 * GanttChart 甘特图组件
 * 展示所有 Span 在时间轴上的分布情况
 */
export function GanttChart({
  spans,
  selectedSpanId,
  onSelectSpan,
  sortByLatency,
}: GanttChartProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<ZoomState>({ start: 0, end: 100 });
  const [tooltip, setTooltip] = useState<{ span: SpanTreeNode; x: number; y: number } | null>(null);

  const displaySpans = useMemo(() => {
    if (!sortByLatency) return spans;
    return sortSpansByLatency(spans);
  }, [spans, sortByLatency]);

  const criticalPathIds = useMemo(() => new Set(findCriticalPath(spans)), [spans]);

  /**
   * 计算整个 trace 的时间范围
   */
  const { traceStart, totalDuration } = useMemo(() => {
    const allSpans = flattenSpans(spans);
    if (allSpans.length === 0) {
      return { traceStart: 0, totalDuration: 1 };
    }

    const starts = allSpans.map(s => new Date(s.startedAt).getTime());
    const ends = allSpans.map(s => {
      if (s.endedAt) return new Date(s.endedAt).getTime();
      return new Date(s.startedAt).getTime() + (s.latencyMs ?? 0);
    });

    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    const duration = Math.max(maxEnd - minStart, 1);

    return { traceStart: minStart, totalDuration: duration };
  }, [spans]);

  /**
   * 生成时间轴刻度（基于 zoom 窗口）
   */
  const ticks = useMemo(() => {
    const tickCount = 5;
    const arr: { label: string; percent: number }[] = [];
    const zoomStartMs = (zoom.start / 100) * totalDuration;
    const zoomEndMs = (zoom.end / 100) * totalDuration;
    const zoomDuration = zoomEndMs - zoomStartMs;
    for (let i = 0; i <= tickCount; i++) {
      const offset = zoomStartMs + (zoomDuration / tickCount) * i;
      arr.push({
        label: formatDuration(offset),
        percent: (i / tickCount) * 100,
      });
    }
    return arr;
  }, [totalDuration, zoom]);

  const handleSelectSpan = useCallback(
    (spanId: string) => {
      onSelectSpan(spanId);
    },
    [onSelectSpan]
  );

  const handleZoomToSpan = useCallback(
    (span: SpanTreeNode) => {
      const startMs = new Date(span.startedAt).getTime();
      const endMs = span.endedAt
        ? new Date(span.endedAt).getTime()
        : startMs + (span.latencyMs ?? 0);
      const spanStartPct = ((startMs - traceStart) / totalDuration) * 100;
      const spanEndPct = ((endMs - traceStart) / totalDuration) * 100;
      const padding = (spanEndPct - spanStartPct) * 0.2;
      setZoom({
        start: Math.max(0, spanStartPct - padding),
        end: Math.min(100, spanEndPct + padding),
      });
    },
    [traceStart, totalDuration]
  );

  const handleSpanHover = useCallback(
    (span: SpanTreeNode | null, e?: React.MouseEvent) => {
      if (span && e) {
        setTooltip({ span, x: e.clientX, y: e.clientY });
      } else {
        setTooltip(null);
      }
    },
    []
  );

  if (spans.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <h3 className="font-semibold text-gray-900 mb-4">{t.ganttChart}</h3>
        <div className="text-center text-gray-500 text-sm py-8">{t.noSpanData}</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <h3 className="font-semibold text-gray-900 mb-4">{t.ganttChart}</h3>

      {/* Minimap (only visible when zoomed) */}
      <GanttMinimap zoom={zoom} onZoomChange={setZoom} />

      {/* 表头 */}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-48 shrink-0 text-xs text-gray-500 font-medium">{t.traceName}</div>
        <div className="flex-1 relative h-6">
          {/* 时间轴刻度 */}
          {ticks.map((tick, idx) => (
            <div
              key={idx}
              className="absolute top-0 text-[10px] text-gray-400"
              style={{ left: `${tick.percent}%`, transform: 'translateX(-50%)' }}
            >
              {tick.label}
            </div>
          ))}
        </div>
        <div className="w-16 text-right text-xs text-gray-500 font-medium shrink-0">{t.duration}</div>
      </div>

      {/* 时间轴刻度线 */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-48 shrink-0" />
        <div className="flex-1 relative h-4 border-b border-gray-200">
          {ticks.map((tick, idx) => (
            <div
              key={idx}
              className="absolute bottom-0 w-px h-2 bg-gray-300"
              style={{ left: `${tick.percent}%` }}
            />
          ))}
        </div>
        <div className="w-16 shrink-0" />
      </div>

      {/* Span 条形列表 */}
      <div className="space-y-0">
        {displaySpans.map(node => (
          <SpanBar
            key={node.spanId}
            node={node}
            depth={0}
            totalDuration={totalDuration}
            traceStart={traceStart}
            selectedSpanId={selectedSpanId}
            onSelectSpan={handleSelectSpan}
            onDoubleClick={handleZoomToSpan}
            onHover={handleSpanHover}
            sortByLatency={sortByLatency}
            zoom={zoom}
            criticalPathIds={criticalPathIds}
          />
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && <GanttTooltip span={tooltip.span} x={tooltip.x} y={tooltip.y} />}
    </div>
  );
}
