import { useTranslation } from '../App';
import { Session } from '../api';
import { useNavigate } from 'react-router-dom';

interface SessionListProps {
  sessions: Session[];
  isLoading?: boolean;
}

export function SessionList({ sessions, isLoading }: SessionListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="text-center py-12 text-gray-500">{t.loading}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="bg-white p-4 rounded-lg shadow-sm border hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => navigate(`/sessions/${session.id}`)}
        >
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0">
              <p className="font-mono text-sm font-medium text-gray-900 truncate">
                {session.id.slice(0, 20)}...
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {formatTime(session.started_at)}
              </p>
              {session.agent_id && (
                <p className="text-xs text-gray-400 mt-1">
                  Agent: {session.agent_id}
                </p>
              )}
            </div>
            <div className="text-right ml-2">
              <span
                className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                  session.status === 'active'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {session.status === 'active' ? t.active : t.ended}
              </span>
              <p className="text-xs text-gray-500 mt-1">
                {formatDuration(session.started_at, session.ended_at)}
              </p>
            </div>
          </div>
        </div>
      ))}
      {sessions.length === 0 && (
        <div className="bg-white p-12 rounded-lg shadow-sm border text-center text-gray-500">
          {t.noSessions}
        </div>
      )}
    </div>
  );
}
