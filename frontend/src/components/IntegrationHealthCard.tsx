import { useEffect, useState } from 'react';
import { api, IntegrationStatus } from '../api';

interface IntegrationHealthCardProps {
  projectId?: string;
}

/**
 * 接入健康卡片：轮询 integration-status，展示 SDK 连接、Hook 覆盖与诊断告警。
 * @param props - 组件属性
 * @param props.projectId - 当前项目 ID
 * @returns 接入健康卡片 React 节点
 */
export function IntegrationHealthCard({ projectId }: IntegrationHealthCardProps) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setStatus(null);
      return;
    }

    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.projects.integrationStatus(projectId);
        if (alive) {
          setStatus(result);
          setError(null);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Failed to load integration status');
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const hookItems: Array<{ key: keyof IntegrationStatus['hooks']; label: string }> = [
    { key: 'agent', label: 'Agent' },
    { key: 'llm', label: 'LLM' },
    { key: 'tool', label: 'Tool' },
    { key: 'retrieval', label: 'Retrieval' },
    { key: 'decision', label: 'Decision' },
  ];

  const fieldItems: Array<{ key: keyof IntegrationStatus['fieldCompleteness']; label: string }> = [
    { key: 'parentSpanId', label: 'Parent Span' },
    { key: 'tokenUsage', label: 'Token Usage' },
    { key: 'promptVersion', label: 'Prompt Version' },
    { key: 'agentVersion', label: 'Agent Version' },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Integration Health</h2>
          <p className="text-sm text-gray-500">最近 60 分钟 SDK 接入与 Hook 覆盖诊断</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            status?.connected
              ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
              : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
          }`}
        >
          {loading && !status ? '检查中' : status?.connected ? '已连接' : '等待接入'}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {status && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-gray-500">Trace 数</div>
              <div className="text-xl font-semibold text-gray-900">{status.traceCount}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-gray-500">SDK</div>
              <div className="truncate font-medium text-gray-900">
                {status.detectedSdk ? `${status.detectedSdk.language}@${status.detectedSdk.version}` : '未识别'}
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-gray-500">最近事件</div>
              <div className="truncate text-xs text-gray-700">
                {status.lastEventAt ? new Date(status.lastEventAt).toLocaleTimeString() : '—'}
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-gray-500">示例 Trace</div>
              <div className="truncate text-xs text-gray-700">{status.sampleTraceId ? '可打开详情' : '—'}</div>
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-sm font-medium text-gray-700">Hook 覆盖</div>
            <div className="flex flex-wrap gap-2">
              {hookItems.map((item) => (
                <span
                  key={item.key}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    status.hooks[item.key]
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                      : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200'
                  }`}
                >
                  {item.label}: {status.hooks[item.key] ? 'OK' : '缺失'}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-sm font-medium text-gray-700">字段完整度</div>
            <div className="grid gap-2 md:grid-cols-2">
              {fieldItems.map((item) => {
                const value = Math.round(status.fieldCompleteness[item.key] * 100);
                return (
                  <div key={item.key}>
                    <div className="mb-1 flex justify-between text-xs text-gray-500">
                      <span>{item.label}</span>
                      <span>{value}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${value >= 80 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-400'}`}
                        style={{ width: `${Math.max(value, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {status.warnings.length > 0 && (
            <div className="space-y-2">
              {status.warnings.map((warning) => (
                <div key={warning.code} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                  <div className="font-medium">{warning.code}</div>
                  <div>{warning.message}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
