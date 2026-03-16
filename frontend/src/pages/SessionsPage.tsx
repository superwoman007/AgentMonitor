import { useEffect, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { SessionList } from '../components/SessionList';
import { RefreshButton } from '../components/RefreshButton';
import { useProjectStore } from '../stores/projectStore';
import { api, Session } from '../api';
import { useTranslation } from '../App';

export function SessionsPage() {
  const { currentProject, ensureDefaultProject } = useProjectStore();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    ensureDefaultProject().finally(() => setBootstrapped(true));
  }, [ensureDefaultProject]);

  const loadSessions = useCallback(async () => {
    if (!currentProject) return;
    setIsLoading(true);
    try {
      const { sessions } = await api.sessions.list(currentProject.id, { limit: 100 });
      setSessions(sessions);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    if (currentProject) {
      loadSessions();
    }
  }, [currentProject, loadSessions]);

  useEffect(() => {
    if (bootstrapped && !currentProject) {
      setIsLoading(false);
    }
  }, [bootstrapped, currentProject]);

  const handleRefresh = useCallback(async () => {
    await loadSessions();
  }, [loadSessions]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.sessionList}</h1>
          <p className="text-gray-500 mt-1">{t.sessions}</p>
        </div>
        <RefreshButton onRefresh={handleRefresh} />
      </div>

      <SessionList sessions={sessions} isLoading={isLoading} />
    </Layout>
  );
}
