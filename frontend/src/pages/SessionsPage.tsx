import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { SessionList } from '../components/SessionList';
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

  useEffect(() => {
    if (currentProject) {
      setIsLoading(true);
      api.sessions.list(currentProject.id, { limit: 100 })
        .then(({ sessions }) => setSessions(sessions))
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [currentProject]);

  useEffect(() => {
    if (bootstrapped && !currentProject) {
      setIsLoading(false);
    }
  }, [bootstrapped, currentProject]);

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.sessionList}</h1>
        <p className="text-gray-500 mt-1">{t.sessions}</p>
      </div>

      <SessionList sessions={sessions} isLoading={isLoading} />
    </Layout>
  );
}
