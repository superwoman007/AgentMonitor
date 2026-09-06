import { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { RefreshButton } from '../components/RefreshButton';
import { useTranslation } from '../App';
import { useSpanTree } from '../components/trace/useSpanTree';
import { SpanTreeList } from '../components/trace/SpanTreeList';
import { GanttChart } from '../components/trace/GanttChart';
import { SpanDetailPanel } from '../components/trace/SpanDetailPanel';
import { TraceAnnotationPanel } from '../components/trace/TraceAnnotationPanel';
import { SpanTreeNode } from '../api';

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
 * 扁平化查找指定 spanId 的节点
 * @param nodes - Span 节点数组
 * @param spanId - 目标 Span ID
 * @returns 找到的 SpanTreeNode 或 null
 */
const findSpanById = (nodes: SpanTreeNode[], spanId: string): SpanTreeNode | null => {
  for (const node of nodes) {
    if (node.spanId === spanId) return node;
    const found = findSpanById(node.children, spanId);
    if (found) return found;
  }
  return null;
};

/**
 * TraceDetailPage 页面组件
 * 展示单个 Trace 的 Span 级追踪详情
 * 包含 TraceHeader、GanttChart、SpanTreeList 和 SpanDetailPanel
 */
export function TraceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { trace, spans, stats, loading, error, refresh } = useSpanTree(id);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [sortByLatency, setSortByLatency] = useState(false);

  /**
   * 当前选中的 Span 对象
   */
  const selectedSpan = useMemo(() => {
    if (!selectedSpanId || spans.length === 0) return null;
    return findSpanById(spans, selectedSpanId);
  }, [selectedSpanId, spans]);

  /**
   * 处理选中 Span
   */
  const handleSelectSpan = useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
  }, []);

  /**
   * 切换按延迟排序
   */
  const handleToggleSort = useCallback(() => {
    setSortByLatency(prev => !prev);
  }, []);

  /**
   * 处理刷新
   */
  const handleRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500">{t.loading}</div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="text-center py-12 text-red-500">{error}</div>
      </Layout>
    );
  }

  if (!trace) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500">{t.spanNotFound}</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* TraceHeader: Trace 基础信息 + Stats */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <button
                onClick={() => navigate('/traces')}
                className="text-blue-600 hover:text-blue-500 text-sm mb-2 flex items-center gap-1"
              >
                ← {t.back}
              </button>
              <h1 className="text-xl font-bold text-gray-900">{trace.name}</h1>
              <p className="text-sm text-gray-500 font-mono mt-1">{trace.id}</p>
            </div>
            <RefreshButton onRefresh={handleRefresh} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">{t.traceType}</p>
              <p className="font-medium">{trace.trace_type}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">{t.status}</p>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  trace.status === 'success'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {trace.status === 'success' ? t.success : t.failed}
              </span>
            </div>
            <div>
              <p className="text-gray-500 text-xs">{t.latency}</p>
              <p className="font-medium">{formatDuration(trace.latency_ms ?? null)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">{t.startTime}</p>
              <p className="font-medium">{new Date(trace.started_at).toLocaleString()}</p>
            </div>
          </div>

          {/* Stats 统计信息（新格式） */}
          {stats && (
            <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs">{t.totalSpans}</p>
                <p className="font-medium">{stats.totalSpans}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">{t.totalLatency}</p>
                <p className="font-medium">{formatDuration(stats.totalLatencyMs)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">{t.totalTokens}</p>
                <p className="font-medium">{stats.totalTokens.total.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">{t.totalCost}</p>
                <p className="font-medium">${stats.totalCostUsd.toFixed(6)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">{t.errorCount}</p>
                <p className={`font-medium ${stats.errorCount > 0 ? 'text-red-600' : ''}`}>
                  {stats.errorCount}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 人工标注面板（P1） */}
        <TraceAnnotationPanel traceId={trace.id} />

        {/* GanttChart 甘特图 */}
        <GanttChart
          spans={spans}
          selectedSpanId={selectedSpanId}
          onSelectSpan={handleSelectSpan}
          sortByLatency={sortByLatency}
        />

        {/* 下方左右分栏: SpanTreeList + SpanDetailPanel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-h-[400px]">
            <SpanTreeList
              spans={spans}
              selectedSpanId={selectedSpanId}
              onSelectSpan={handleSelectSpan}
              sortByLatency={sortByLatency}
              onToggleSort={handleToggleSort}
            />
          </div>
          <div className="min-h-[400px]">
            <SpanDetailPanel span={selectedSpan} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
