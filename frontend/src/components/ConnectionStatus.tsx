import { useState, useEffect } from 'react';
import { useTranslation } from '../App';

export type ConnectionStatusType = 'connected' | 'reconnecting' | 'disconnected' | 'loading';

interface ConnectionStatusProps {
  status?: ConnectionStatusType;
}

export function ConnectionStatus({ status: externalStatus }: ConnectionStatusProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ConnectionStatusType>(externalStatus || 'loading');

  useEffect(() => {
    if (externalStatus) {
      setStatus(externalStatus);
    }
  }, [externalStatus]);

  const statusConfig = {
    connected: { bg: 'bg-green-100', text: 'text-green-800', label: t.connected },
    reconnecting: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: t.reconnecting },
    disconnected: { bg: 'bg-red-100', text: 'text-red-800', label: t.disconnected },
    loading: { bg: 'bg-gray-100', text: 'text-gray-800', label: t.loading },
  };

  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}
    >
      <span
        className={`w-2 h-2 rounded-full mr-2 ${
          status === 'connected'
            ? 'bg-green-500'
            : status === 'reconnecting'
            ? 'bg-yellow-500 animate-pulse'
            : status === 'loading'
            ? 'bg-gray-400 animate-pulse'
            : 'bg-red-500'
        }`}
      />
      {config.label}
    </span>
  );
}
