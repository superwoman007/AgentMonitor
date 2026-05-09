import { useState, useEffect, useCallback } from 'react';
import { api, Trace, SpanTreeNode, SpanStats, TraceTreeResponse } from '../../api';

/**
 * useSpanTree Hook
 * 获取并解析 Trace 树数据，兼容旧格式（children）和新格式（spans+stats）
 *
 * @param traceId - Trace ID
 * @returns tree 数据、加载状态、错误信息
 */
export function useSpanTree(traceId: string | undefined) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [spans, setSpans] = useState<SpanTreeNode[]>([]);
  const [stats, setStats] = useState<SpanStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 判断响应是否为旧格式（包含 children 字段）
   */
  const isOldFormat = (res: TraceTreeResponse): res is { trace: Trace; children: Trace[] } => {
    return 'children' in res && Array.isArray((res as any).children);
  };

  /**
   * 判断响应是否为新格式（包含 spans 字段）
   */
  const isNewFormat = (res: TraceTreeResponse): res is { trace: Trace; spans: SpanTreeNode[]; stats: SpanStats } => {
    return 'spans' in res && Array.isArray((res as any).spans);
  };

  /**
   * 将旧格式的 Trace[] 转换为 SpanTreeNode[]
   */
  const convertTraceToSpanNode = (t: Trace): SpanTreeNode => ({
    spanId: t.id,
    name: t.name,
    traceType: t.trace_type,
    startedAt: t.started_at,
    endedAt: t.ended_at || null,
    latencyMs: t.latency_ms ?? null,
    status: t.status,
    error: t.error || null,
    input: t.input ?? null,
    output: t.output ?? null,
    attributes: t.metadata ?? null,
    tokens: null,
    costUsd: null,
    children: [],
  });

  const loadTree = useCallback(async () => {
    if (!traceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.traces.getTree(traceId);
      setTrace(res.trace);

      if (isNewFormat(res)) {
        // 新格式：直接使用 spans 和 stats
        setSpans(res.spans);
        setStats(res.stats);
      } else if (isOldFormat(res)) {
        // 旧格式：将 children 转换为 spans
        const convertedSpans = res.children.map(convertTraceToSpanNode);
        setSpans(convertedSpans);
        // 旧格式无 stats，设为 null
        setStats(null);
      } else {
        setSpans([]);
        setStats(null);
      }
    } catch (err: any) {
      setError(err.message || '加载 Trace 树失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  return {
    trace,
    spans,
    stats,
    loading,
    error,
    refresh: loadTree,
  };
}
