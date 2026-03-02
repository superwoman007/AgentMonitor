import { useEffect, useRef, useState } from 'react';
import { Layout } from '../components/Layout';
import { StatsCards } from '../components/StatsCards';
import { TraceList } from '../components/TraceList';
import { TraceDetail } from '../components/TraceDetail';
import { ConnectionStatus, ConnectionStatusType } from '../components/ConnectionStatus';
import { useAuthStore } from '../stores/authStore';
import { useProjectStore } from '../stores/projectStore';
import { useTraceStore } from '../stores/traceStore';
import { useTranslation } from '../App';
import { Trace } from '../api';

export function DashboardPage() {
  const { token, user, fetchUser } = useAuthStore();
  const { projects, currentProject, fetchProjects, ensureDefaultProject } = useProjectStore();
  const { traces, selectedTrace, stats, fetchTraces, fetchStats, selectTrace, addTrace } = useTraceStore();
  const { t } = useTranslation();
  const [wsStatus, setWsStatus] = useState<ConnectionStatusType>('loading');
  const wsRef = useRef<WebSocket | null>(null);
  const initializedRef = useRef(false);

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
    if (currentProject) {
      fetchTraces(currentProject.id);
      fetchStats(currentProject.id);
    }
  }, [currentProject?.id, fetchTraces, fetchStats]);

  useEffect(() => {
    if (!currentProject) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws?projectId=${currentProject.id}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setWsStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'new_trace' && data.data) {
            addTrace(data.data as Trace);
          }
          if (data.type === 'init' && data.data?.traces) {
            // Initial data handled by fetchTraces
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setWsStatus('reconnecting');
        setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setWsStatus('disconnected');
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [currentProject]);

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t.dashboard}</h1>
        <ConnectionStatus status={wsStatus} />
      </div>

      <StatsCards stats={stats} />

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
