import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { RefreshButton } from '../components/RefreshButton';
import { useTranslation } from '../App';
import { api, Session, Message, Trace, TimelineItem } from '../api';

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'timeline' | 'chat' | 'unified' | 'react'>('timeline');
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [{ session }, { messages }, { timeline: tl }] = await Promise.all([
        api.sessions.get(id),
        api.sessions.messages.list(id, { limit: 200 }),
        api.sessions.timeline(id),
      ]);
      setSession(session);
      setMessages(messages);
      setTimeline(tl);
      if (session.project_id) {
        const { traces } = await api.traces.list(session.project_id, { sessionId: id, limit: 100 });
        setTraces(traces);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString();
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return t.active;
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const [exporting, setExporting] = useState(false);

  const handleEndSession = async () => {
    if (!id || !session) return;
    try {
      const { session: updated } = await api.sessions.end(id);
      setSession(updated);
    } catch (error) {
      console.error('Failed to end session:', error);
    }
  };

  const handleExportDataset = async () => {
    if (!id) return;
    setExporting(true);
    try {
      const { dataset, itemCount } = await api.sessions.exportDataset(id);
      alert(`${t.exportDatasetSuccess}: ${(dataset as any).name} (${itemCount} items)`);
    } catch (error: any) {
      console.error('Failed to export dataset:', error);
      alert(error.message || t.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  const toggleMessage = (msgId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  const getMessageMetadata = (msg: Message) => {
    const meta = msg.metadata as any;
    return {
      tokens: meta?.tokens || meta?.usage?.total_tokens,
      latency: meta?.latency || meta?.latency_ms,
      model: meta?.model,
    };
  };

  const formatTokens = (tokens?: number) => {
    if (!tokens) return null;
    return `${tokens} tokens`;
  };

  const formatLatency = (latency?: number) => {
    if (!latency) return null;
    if (latency < 1000) return `${latency}ms`;
    return `${(latency / 1000).toFixed(2)}s`;
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500">{t.loading}</div>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500">{t.errorOccurred}</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <button
          onClick={() => navigate('/sessions')}
          className="text-blue-600 hover:text-blue-500 text-sm mb-2 flex items-center gap-1"
        >
          ← {t.back}
        </button>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.sessionDetail}</h1>
            <p className="text-gray-500 mt-1 font-mono text-sm">{session.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={handleRefresh} />
            <button
              onClick={handleExportDataset}
              disabled={exporting}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm disabled:opacity-50"
            >
              {exporting ? '...' : t.exportDataset}
            </button>
            {session.status === 'active' && (
              <button
                onClick={handleEndSession}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
              >
                {t.endSession}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
            <h3 className="text-sm font-medium text-gray-900 mb-3">{t.session}</h3>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-500">{t.status}:</span>{' '}
                <span className={session.status === 'active' ? 'text-green-600' : 'text-gray-700'}>
                  {session.status === 'active' ? t.active : t.ended}
                </span>
              </div>
              <div>
                <span className="text-gray-500">{t.startTime}:</span>{' '}
                <span>{formatTime(session.started_at)}</span>
              </div>
              {session.ended_at && (
                <div>
                  <span className="text-gray-500">{t.endTime}:</span>{' '}
                  <span>{formatTime(session.ended_at)}</span>
                </div>
              )}
              <div>
                <span className="text-gray-500">{t.duration}:</span>{' '}
                <span>{formatDuration(session.started_at, session.ended_at)}</span>
              </div>
              {session.agent_id && (
                <div>
                  <span className="text-gray-500">{t.agentId}:</span>{' '}
                  <span className="font-mono text-xs">{session.agent_id}</span>
                </div>
              )}
            </div>
          </div>

          {traces.length > 0 && (
            <div className="bg-white p-4 rounded-lg shadow-sm border">
              <h3 className="text-sm font-medium text-gray-900 mb-3">{t.toolCalls} ({traces.length})</h3>
              <div className="space-y-2 max-h-80 overflow-auto">
                {traces.map((trace) => (
                  <div key={trace.id} className="text-xs p-2 bg-gray-50 rounded">
                    <div className="font-medium text-gray-900">{trace.name}</div>
                    <div className="text-gray-500">{trace.trace_type}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium text-gray-900">{t.messages} ({messages.length})</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-1 text-xs rounded ${
                    viewMode === 'timeline' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {t.messages}
                </button>
                <button
                  onClick={() => setViewMode('chat')}
                  className={`px-3 py-1 text-xs rounded ${
                    viewMode === 'chat' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {t.chat}
                </button>
                <button
                  onClick={() => setViewMode('unified')}
                  className={`px-3 py-1 text-xs rounded ${
                    viewMode === 'unified' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {t.timeline}
                </button>
                <button
                  onClick={() => setViewMode('react')}
                  className={`px-3 py-1 text-xs rounded ${
                    viewMode === 'react' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {t.reactFlow}
                </button>
              </div>
            </div>
            {viewMode === 'unified' && (
              timeline.length === 0 ? (
                <div className="text-center py-12 text-gray-500">{t.noMessages}</div>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                  <div className="space-y-4">
                    {timeline.map((item, idx) => (
                      <div key={`${item.type}-${item.id}`} className="relative pl-10">
                        <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${
                          item.type === 'message' ? 'bg-blue-500' :
                          item.type === 'trace' ? 'bg-green-500' : 'bg-orange-500'
                        }`}>
                          <span className="text-white text-xs">{idx + 1}</span>
                        </div>
                        <div className="bg-white border rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              item.type === 'message' ? 'bg-blue-100 text-blue-700' :
                              item.type === 'trace' ? 'bg-green-100 text-green-700' :
                              'bg-orange-100 text-orange-700'
                            }`}>
                              {item.type === 'message' ? (item.data as any).role : item.type}
                            </span>
                            <span className="text-xs text-gray-400">{formatTime(item.timestamp)}</span>
                          </div>
                          {item.type === 'message' && (
                            <div className="text-sm whitespace-pre-wrap">{(item.data as any).content}</div>
                          )}
                          {item.type === 'trace' && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{(item.data as any).name}</div>
                              <div className="text-xs text-gray-500">{(item.data as any).trace_type}</div>
                              {(item.data as any).latency_ms && (
                                <div className="text-xs text-orange-600">{formatLatency((item.data as any).latency_ms)}</div>
                              )}
                            </div>
                          )}
                          {item.type === 'tool_call' && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{(item.data as any).tool_name}</div>
                              {(item.data as any).input && (
                                <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-24">
                                  {JSON.stringify((item.data as any).input, null, 2)}
                                </pre>
                              )}
                              {(item.data as any).output && (
                                <pre className="text-xs bg-green-50 p-2 rounded overflow-auto max-h-24">
                                  {JSON.stringify((item.data as any).output, null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {viewMode === 'react' && (
              timeline.length === 0 ? (
                <div className="text-center py-12 text-gray-500">{t.noMessages}</div>
              ) : (
                <div className="space-y-6">
                  {(() => {
                    // Parse timeline into ReAct steps
                    const steps = timeline.map((item) => {
                      if (item.type === 'message') {
                        const role = (item.data as any).role;
                        if (role === 'assistant') {
                          return {
                            type: 'thought' as const,
                            title: t.thought,
                            content: (item.data as any).content || '',
                            timestamp: item.timestamp,
                            status: 'success' as const,
                          };
                        }
                        return {
                          type: 'observation' as const,
                          title: t.observation,
                          content: (item.data as any).content || '',
                          timestamp: item.timestamp,
                          status: 'success' as const,
                        };
                      }
                      if (item.type === 'tool_call') {
                        const data = item.data as any;
                        return {
                          type: 'action' as const,
                          title: `${t.action}: ${data.tool_name || ''}`,
                          content: data.input ? JSON.stringify(data.input, null, 2) : '',
                          output: data.output ? JSON.stringify(data.output, null, 2) : '',
                          timestamp: item.timestamp,
                          status: data.status === 'failed' ? ('failed' as const) : ('success' as const),
                        };
                      }
                      if (item.type === 'trace') {
                        const data = item.data as any;
                        if (data.trace_type === 'tool') {
                          return {
                            type: 'action' as const,
                            title: `${t.action}: ${data.name || ''}`,
                            content: data.input ? JSON.stringify(data.input, null, 2) : '',
                            output: data.output ? JSON.stringify(data.output, null, 2) : '',
                            timestamp: item.timestamp,
                            status: data.status === 'failed' || data.error ? ('failed' as const) : ('success' as const),
                          };
                        }
                        return {
                          type: 'thought' as const,
                          title: t.thought,
                          content: data.output ? String(data.output) : data.input ? String(data.input) : '',
                          timestamp: item.timestamp,
                          status: data.error ? ('failed' as const) : ('success' as const),
                        };
                      }
                      return null;
                    }).filter(Boolean) as Array<{
                      type: 'thought' | 'action' | 'observation';
                      title: string;
                      content: string;
                      output?: string;
                      timestamp: string;
                      status: 'success' | 'failed';
                    }>;

                    return (
                      <>
                        {steps.map((step, idx) => (
                          <div key={idx} className="relative">
                            {idx > 0 && (
                              <div className="flex justify-center -mt-2 mb-2">
                                <div className="w-0.5 h-6 bg-gray-300"></div>
                              </div>
                            )}
                            <div className={`border rounded-lg p-4 ${
                              step.status === 'failed' ? 'border-red-300 bg-red-50' :
                              step.type === 'thought' ? 'border-purple-200 bg-purple-50' :
                              step.type === 'action' ? 'border-blue-200 bg-blue-50' :
                              'border-green-200 bg-green-50'
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    step.status === 'failed' ? 'bg-red-100 text-red-700' :
                                    step.type === 'thought' ? 'bg-purple-100 text-purple-700' :
                                    step.type === 'action' ? 'bg-blue-100 text-blue-700' :
                                    'bg-green-100 text-green-700'
                                  }`}>
                                    {step.title}
                                  </span>
                                  {step.status === 'failed' && (
                                    <span className="text-xs text-red-600 font-medium">{t.failed}</span>
                                  )}
                                </div>
                                <span className="text-xs text-gray-400">{formatTime(step.timestamp)}</span>
                              </div>
                              <div className="text-sm whitespace-pre-wrap font-mono text-xs">{step.content}</div>
                              {step.output && (
                                <div className="mt-2 pt-2 border-t border-gray-200">
                                  <div className="text-xs text-gray-500 mb-1">{t.output}:</div>
                                  <pre className="text-xs bg-white p-2 rounded border overflow-auto max-h-32">{step.output}</pre>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )
            )}

            {viewMode !== 'unified' && viewMode !== 'react' && (
              messages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">{t.noMessages}</div>
              ) : viewMode === 'timeline' ? (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                  <div className="space-y-4">
                    {messages.map((msg, idx) => {
                      const metadata = getMessageMetadata(msg);
                      const isExpanded = expandedMessages.has(msg.id);
                      return (
                        <div key={msg.id} className="relative pl-10">
                          <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${
                            msg.role === 'user' ? 'bg-blue-500' : 
                            msg.role === 'assistant' ? 'bg-green-500' : 'bg-yellow-500'
                          }`}>
                            <span className="text-white text-xs">{idx + 1}</span>
                          </div>
                          <div className="bg-white border rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  msg.role === 'user'
                                    ? 'bg-blue-100 text-blue-700'
                                    : msg.role === 'assistant'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}>
                                  {msg.role}
                                </span>
                                <span className="text-xs text-gray-400">{formatTime(msg.timestamp)}</span>
                                {metadata.model && (
                                  <span className="text-xs text-gray-500 font-mono">{metadata.model}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-500">
                                {formatTokens(metadata.tokens) && (
                                  <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">
                                    {formatTokens(metadata.tokens)}
                                  </span>
                                )}
                                {formatLatency(metadata.latency) && (
                                  <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded">
                                    {formatLatency(metadata.latency)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div 
                              className={`text-sm whitespace-pre-wrap ${!isExpanded && msg.content.length > 200 ? 'max-h-32 overflow-hidden relative' : ''}`}
                            >
                              {msg.content}
                              {!isExpanded && msg.content.length > 200 && (
                                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent"></div>
                              )}
                            </div>
                            {msg.content.length > 200 && (
                              <button
                                onClick={() => toggleMessage(msg.id)}
                                className="text-blue-600 text-xs mt-2 hover:underline"
                              >
                                {isExpanded ? t.showLess : t.showMore}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const metadata = getMessageMetadata(msg);
                    return (
                      <div
                        key={msg.id}
                        className={`p-4 rounded-lg ${
                          msg.role === 'user'
                            ? 'bg-blue-50 ml-0 mr-12'
                            : msg.role === 'assistant'
                            ? 'bg-gray-50 ml-12 mr-0'
                            : 'bg-yellow-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              msg.role === 'user'
                                ? 'bg-blue-100 text-blue-700'
                                : msg.role === 'assistant'
                                ? 'bg-gray-200 text-gray-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {msg.role}
                          </span>
                          <span className="text-xs text-gray-400">{formatTime(msg.timestamp)}</span>
                          {metadata.model && (
                            <span className="text-xs text-gray-500 font-mono">{metadata.model}</span>
                          )}
                          {metadata.tokens && (
                            <span className="text-xs text-purple-600">{formatTokens(metadata.tokens)}</span>
                          )}
                          {metadata.latency && (
                            <span className="text-xs text-orange-600">{formatLatency(metadata.latency)}</span>
                          )}
                        </div>
                        <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
