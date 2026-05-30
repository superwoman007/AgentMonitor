import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { StatsCards } from '../components/StatsCards';
import { TrendChart } from '../components/TrendChart';
import { TraceList } from '../components/TraceList';
import { TraceDetail } from '../components/TraceDetail';
import { ConnectionStatus, ConnectionStatusType } from '../components/ConnectionStatus';
import { RefreshButton } from '../components/RefreshButton';
import { useAuthStore } from '../stores/authStore';
import { useProjectStore } from '../stores/projectStore';
import { useTraceStore } from '../stores/traceStore';
import { useTranslation } from '../App';
import { api, Trace, TrendPoint } from '../api';

export function DashboardPage() {
  const navigate = useNavigate();
  const { token, user, fetchUser } = useAuthStore();
  const { projects, currentProject, fetchProjects, ensureDefaultProject } = useProjectStore();
  const { traces, selectedTrace, stats, fetchTraces, fetchStats, selectTrace, addTrace } = useTraceStore();
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const { t } = useTranslation();
  const [wsStatus, setWsStatus] = useState<ConnectionStatusType>('loading');
  const wsRef = useRef<WebSocket | null>(null);
  const initializedRef = useRef(false);
  const lastTraceTimeRef = useRef<number>(0);

  useEffect(() => {
    if (token && !initializedRef.current) {
      initializedRef.current = true;
      if (!user) fetchUser();
      if (projects.length === 0) fetchProjects();
    }
  }, [token, user, projects.length, fetchUser, fetchProjects]);

  useEffect(() => {
    if (projects.length > 0 && !currentProject) {
      ensureDefaultProject();
    }
  }, [projects.length, currentProject, ensureDefaultProject]);

  useEffect(() => {
    if (token && !currentProject) {
      ensureDefaultProject();
    }
  }, [token, currentProject, ensureDefaultProject]);

  useEffect(() => {
    if (currentProject) {
      fetchTraces(currentProject.id);
      fetchStats(currentProject.id);
      api.stats.trend(currentProject.id, 7).then((res) => setTrendData(res.trend)).catch(() => {});
    }
  }, [currentProject?.id, fetchTraces, fetchStats]);

  // Update SDK connection status when traces change
  useEffect(() => {
    if (traces.length > 0) {
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      const mostRecent = new Date(traces[0].started_at).getTime();
      if (now - mostRecent < fiveMinutes) {
        lastTraceTimeRef.current = mostRecent;
        if (wsStatus === 'waiting' || wsStatus === 'loading') {
          setWsStatus('connected');
        }
      }
    }
  }, [traces, wsStatus]);

  useEffect(() => {
    if (!currentProject || !token) {
      setWsStatus('disconnected');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isDev = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    const wsHost = isDev ? `${window.location.hostname}:3000` : window.location.host;
    const wsUrl = `${protocol}//${wsHost}/ws?projectId=${currentProject.id}&token=${encodeURIComponent(token)}`;
    let alive = true;
    let retryTimer: number | undefined;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Check if we have recent trace data to determine SDK status
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        const hasRecentTrace = traces.length > 0 && (now - new Date(traces[0].started_at).getTime() < fiveMinutes);
        if (hasRecentTrace || lastTraceTimeRef.current > 0) {
          setWsStatus('connected');
        } else {
          setWsStatus('waiting');
        }
        try {
          ws.send(JSON.stringify({ type: 'subscribe', projectId: currentProject.id }));
        } catch {
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'new_trace' && data.data) {
            lastTraceTimeRef.current = Date.now();
            setWsStatus('connected');
            addTrace(data.data as Trace);
          }
          if (data.type === 'init' && data.data?.traces) {
            // Initial data handled by fetchTraces
          }
        } catch (e) {
          console.warn('Failed to parse WS message:', e);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        if (!alive) return;
        setWsStatus('reconnecting');
        retryTimer = window.setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
        if (!alive) return;
        setWsStatus('disconnected');
      };
    };

    connect();

    return () => {
      alive = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentProject?.id, token, addTrace]);

  const handleRefresh = useCallback(async () => {
    if (currentProject) {
      await Promise.all([
        fetchTraces(currentProject.id),
        fetchStats(currentProject.id),
      ]);
      try {
        const res = await api.stats.trend(currentProject.id, 7);
        setTrendData(res.trend);
      } catch (e) {
        console.error('Failed to fetch trend:', e);
      }
    }
  }, [currentProject, fetchTraces, fetchStats]);

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t.dashboard}</h1>
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={handleRefresh} />
          <ConnectionStatus status={wsStatus} />
        </div>
      </div>

      <StatsCards stats={stats} onCardClick={(filter) => {
        const params = new URLSearchParams(filter);
        navigate(`/traces?${params.toString()}`);
      }} />

      <TrendChart data={trendData} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TraceList
          traces={traces}
          selectedTrace={selectedTrace}
          onSelect={selectTrace}
        />
        <TraceDetail trace={selectedTrace} />
      </div>
    </Layout>
  );
}
