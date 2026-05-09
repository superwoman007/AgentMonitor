import { useState } from 'react';
import { SpanTreeNode } from '../../api';
import { useTranslation } from '../../App';

interface SpanDetailPanelProps {
  span: SpanTreeNode | null;
}

const formatDuration = (ms: number | null) => {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatJson = (data: unknown): string => {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

type TabKey = 'overview' | 'input' | 'output';

/**
 * SpanDetailPanel 组件
 * 展示选中 Span 的详细信息，包含概览、Input、Output 三个 Tab
 */
export function SpanDetailPanel({ span }: SpanDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const { t } = useTranslation();

  if (!span) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 h-full">
        <div className="text-gray-500 text-center py-12">{t.selectSpan}</div>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t.overviewTab },
    { key: 'input', label: t.inputTab },
    { key: 'output', label: t.outputTab },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border flex flex-col h-full">
      <div className="flex border-b">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">{t.basicInfo}</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">{t.nameLabel}:</span>
                  <span className="ml-2 font-medium">{span.name}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t.typeLabel}:</span>
                  <span className="ml-2 font-mono text-xs">{span.traceType}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t.statusLabel}:</span>
                  <span
                    className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                      span.status === 'success'
                        ? 'bg-green-100 text-green-700'
                        : span.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {span.status}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">{t.latencyLabel}:</span>
                  <span className="ml-2">{formatDuration(span.latencyMs)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">{t.spanIdLabel}:</span>
                  <span className="ml-2 font-mono text-xs text-gray-700 break-all">{span.spanId}</span>
                </div>
                {span.error && (
                  <div className="col-span-2">
                    <span className="text-gray-500">{t.errorLabel}:</span>
                    <span className="ml-2 text-red-600 text-xs">{span.error}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">{t.tokenCostLabel}</h4>
              <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 p-3 rounded">
                {span.tokens !== null && (
                  <>
                    <div>
                      <span className="text-gray-500">{t.promptTokensLabel}:</span>
                      <span className="ml-2 font-medium">{span.tokens.prompt ?? '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">{t.completionTokensLabel}:</span>
                      <span className="ml-2 font-medium">{span.tokens.completion ?? '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">{t.totalTokens}:</span>
                      <span className="ml-2 font-medium">{span.tokens.total ?? '-'}</span>
                    </div>
                  </>
                )}
                {span.costUsd !== null && (
                  <div>
                    <span className="text-gray-500">{t.cost}:</span>
                    <span className="ml-2 font-medium">${span.costUsd.toFixed(6)}</span>
                  </div>
                )}
              </div>
            </div>

            {span.attributes !== null && span.attributes !== undefined && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">{t.attributesLabel}</h4>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-60">
                  {formatJson(span.attributes)}
                </pre>
              </div>
            )}
          </div>
        )}

        {activeTab === 'input' && (
          <div>
            {span.input !== null && span.input !== undefined ? (
              <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-[500px]">
                {formatJson(span.input)}
              </pre>
            ) : (
              <div className="text-gray-500 text-sm">{t.noInputData}</div>
            )}
          </div>
        )}

        {activeTab === 'output' && (
          <div>
            {span.output !== null && span.output !== undefined ? (
              <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-[500px]">
                {formatJson(span.output)}
              </pre>
            ) : (
              <div className="text-gray-500 text-sm">{t.noOutputData}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
