import { useTranslation } from '../App';
import { Trace } from '../api';

interface TraceDetailProps {
  trace: Trace | null;
}

const formatValue = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
};

export function TraceDetail({ trace }: TraceDetailProps) {
  const { t } = useTranslation();

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString();
  };

  if (!trace) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.selectTrace}</h3>
        <div className="text-gray-500 text-center py-12">{t.selectHint}</div>
      </div>
    );
  }

  const inputStr = formatValue(trace.input);
  const outputStr = formatValue(trace.output);
  const metadataStr = formatValue(trace.metadata);

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.traceDetails}</h3>
      <div className="space-y-4 max-h-[600px] overflow-auto">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.traceType}</p>
            <p className="text-sm font-mono">{trace.trace_type}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.traceName}</p>
            <p className="text-sm font-mono">{trace.name}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.latency}</p>
            <p className="text-sm">{formatDuration(trace.latency_ms)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.status}</p>
            <p className={`text-sm ${trace.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {trace.status === 'success' ? t.success : t.failed}
            </p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 mb-1">{t.startTime}</p>
          <p className="text-sm">{formatTime(trace.started_at)}</p>
        </div>

        {inputStr && (
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.input}</p>
            <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-40">
              {inputStr}
            </pre>
          </div>
        )}

        {outputStr && (
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.output}</p>
            <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-40">
              {outputStr}
            </pre>
          </div>
        )}

        {metadataStr && (
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{t.metadata}</p>
            <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-40">
              {metadataStr}
            </pre>
          </div>
        )}

        {trace.error && (
          <div>
            <p className="text-sm font-medium text-red-500 mb-1">{t.error}</p>
            <pre className="bg-red-50 p-3 rounded text-xs text-red-700 overflow-auto max-h-40">
              {trace.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
