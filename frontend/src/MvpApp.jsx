
// AgentMonitor MVP Frontend - Pure JavaScript, no TypeScript!
// 支持中英文切换

import { useState, useEffect } from 'react';
import './App.css';

const i18n = {
  en: {
    title: 'AgentMonitor',
    subtitle: 'AI Agent Quality Monitoring Platform · MVP',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
    totalRequests: 'Total Requests',
    successful: 'Successful',
    successRate: 'Success Rate',
    avgLatency: 'Avg Latency',
    totalTokens: 'Total Tokens',
    recentTraces: 'Recent Traces',
    traceDetails: 'Trace Details',
    selectTrace: 'Select a trace',
    noTraces: 'No traces yet, waiting for SDK to send data...',
    selectHint: 'Select a trace from the left to view details',
    model: 'Model',
    latency: 'Latency',
    status: 'Status',
    success: 'Success',
    failed: 'Failed',
    tokenUsage: 'Token Usage',
    prompt: 'Prompt',
    completion: 'Completion',
    total: 'Total',
    request: 'Request',
    response: 'Response',
    error: 'Error',
  },
  zh: {
    title: 'AgentMonitor',
    subtitle: 'AI Agent 质量监控平台 · MVP',
    connected: '已连接',
    reconnecting: '重连中',
    disconnected: '已断开',
    totalRequests: '总请求数',
    successful: '成功数',
    successRate: '成功率',
    avgLatency: '平均延迟',
    totalTokens: '总 Token 数',
    recentTraces: '最近调用记录',
    traceDetails: '调用详情',
    selectTrace: '选择一条记录',
    noTraces: '暂无数据，等待 SDK 发送...',
    selectHint: '点击左侧记录查看详情',
    model: '模型',
    latency: '延迟',
    status: '状态',
    success: '成功',
    failed: '失败',
    tokenUsage: 'Token 用量',
    prompt: '输入',
    completion: '输出',
    total: '合计',
    request: '请求',
    response: '响应',
    error: '错误',
  },
};

function MvpApp() {
  const [traces, setTraces] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [status, setStatus] = useState('loading');
  const [lang, setLang] = useState('zh');

  const t = i18n[lang];

  useEffect(() => {
    fetchData();
    connectWebSocket();
  }, []);

  const fetchData = async () => {
    try {
      const [tracesRes, statsRes] = await Promise.all([
        fetch('/api/v1/traces'),
        fetch('/api/v1/stats'),
      ]);
      const tracesData = await tracesRes.json();
      const statsData = await statsRes.json();
      setTraces(tracesData.traces || []);
      setStats(statsData);
      setStatus('connected');
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setStatus('error');
    }
  };

  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/api/v1/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'new_trace') {
        setTraces((prev) => [data.data, ...prev]);
        fetchData();
      }
      if (data.type === 'init') {
        setTraces(data.data.traces || []);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      setStatus('reconnecting');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setStatus('error');
    };
  };

  const formatTime = (iso) => {
    return new Date(iso).toLocaleTimeString();
  };

  const formatDuration = (ms) => {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  };

  const toggleLang = () => {
    setLang((prev) => (prev === 'zh' ? 'en' : 'zh'));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
            <p className="text-gray-600">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLang}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
            >
              {lang === 'zh' ? '🌐 EN' : '🌐 中文'}
            </button>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              status === 'connected' ? 'bg-green-100 text-green-800' :
              status === 'reconnecting' ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {status === 'connected' ? t.connected :
               status === 'reconnecting' ? t.reconnecting :
               t.disconnected}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500 mb-1">{t.totalRequests}</p>
            <p className="text-2xl font-bold text-blue-600">{stats?.totalRequests || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500 mb-1">{t.successful}</p>
            <p className="text-2xl font-bold text-green-600">{stats?.successfulRequests || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500 mb-1">{t.successRate}</p>
            <p className="text-2xl font-bold text-purple-600">{stats?.successRate || 0}%</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500 mb-1">{t.avgLatency}</p>
            <p className="text-2xl font-bold text-orange-600">{stats?.avgLatency || 0}ms</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <p className="text-sm text-gray-500 mb-1">{t.totalTokens}</p>
            <p className="text-2xl font-bold text-indigo-600">{stats?.totalTokens || 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.recentTraces}</h3>
            <div className="space-y-3 max-h-[600px] overflow-auto">
              {traces.map((trace) => (
                <div
                  key={trace.id}
                  onClick={() => setSelectedTrace(trace)}
                  className={`p-4 rounded border cursor-pointer transition-colors ${
                    selectedTrace?.id === trace.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono text-sm font-medium text-gray-900">{trace.model}</p>
                      <p className="text-xs text-gray-500">{formatTime(trace.timestamp)}</p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        trace.success
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {trace.success ? t.success : t.failed}
                      </span>
                      <p className="text-xs text-gray-500 mt-1">{formatDuration(trace.latencyMs)}</p>
                    </div>
                  </div>
                </div>
              ))}
              {traces.length === 0 && (
                <div className="text-gray-500 text-center py-12">
                  {t.noTraces}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {selectedTrace ? t.traceDetails : t.selectTrace}
            </h3>
            {selectedTrace ? (
              <div className="space-y-4 max-h-[600px] overflow-auto">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{t.model}</p>
                  <p className="font-mono text-sm">{selectedTrace.model}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{t.latency}</p>
                  <p className="text-sm">{formatDuration(selectedTrace.latencyMs)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{t.status}</p>
                  <p className={`text-sm ${selectedTrace.success ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedTrace.success ? t.success : t.failed}
                  </p>
                </div>
                {selectedTrace.response?.usage && (
                  <div>
                    <p className="text-sm font-medium text-gray-500 mb-1">{t.tokenUsage}</p>
                    <div className="text-sm space-y-1">
                      <p>{t.prompt}: {selectedTrace.response.usage.prompt_tokens}</p>
                      <p>{t.completion}: {selectedTrace.response.usage.completion_tokens}</p>
                      <p>{t.total}: {selectedTrace.response.usage.total_tokens}</p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{t.request}</p>
                  <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto">
                    {JSON.stringify(selectedTrace.request, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{t.response}</p>
                  <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto">
                    {JSON.stringify(selectedTrace.response, null, 2)}
                  </pre>
                </div>
                {selectedTrace.error && (
                  <div>
                    <p className="text-sm font-medium text-red-500 mb-1">{t.error}</p>
                    <pre className="bg-red-50 p-3 rounded text-xs text-red-700 overflow-auto">
                      {selectedTrace.error}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-500 text-center py-12">
                {t.selectHint}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default MvpApp;
