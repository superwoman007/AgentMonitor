import { useTranslation } from '../App';
import { Trace } from '../api';

interface TraceListProps {
  traces: Trace[];
  selectedTrace: Trace | null;
  onSelect: (trace: Trace) => void;
  isLoading?: boolean;
}

export function TraceList({ traces, selectedTrace, onSelect, isLoading }: TraceListProps) {
  const { t } = useTranslation();

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString();
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.recentTraces}</h3>
        <div className="text-center py-12 text-gray-500">{t.loading}</div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.recentTraces}</h3>
      <div className="space-y-3 max-h-[600px] overflow-auto">
        {traces.map((trace) => (
          <div
            key={trace.id}
            onClick={() => onSelect(trace)}
            className={`p-4 rounded border cursor-pointer transition-colors ${
              selectedTrace?.id === trace.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-medium text-gray-900 truncate">
                  {trace.name || trace.trace_type}
                </p>
                <p className="text-xs text-gray-500">
                  {trace.trace_type} · {formatTime(trace.started_at)}
                </p>
              </div>
              <div className="text-right ml-2">
                <span
                  className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    trace.status === 'success'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {trace.status === 'success' ? t.success : t.failed}
                </span>
                <p className="text-xs text-gray-500 mt-1">{formatDuration(trace.latency_ms)}</p>
              </div>
            </div>
          </div>
        ))}
        {traces.length === 0 && (
          <div className="text-gray-500 text-center py-12">{t.noTraces}</div>
        )}
      </div>
    </div>
  );
}
