import { useTranslation } from '../App';
import { Stats } from '../api';

interface StatsCardsProps {
  stats: Stats | null;
  onCardClick?: (filter: Record<string, string>) => void;
}

export function StatsCards({ stats, onCardClick }: StatsCardsProps) {
  const { t } = useTranslation();

  const formatNumber = (value: unknown) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '0';
    return value.toLocaleString();
  };

  const formatPercent = (value: unknown) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
    return `${value.toFixed(2)}%`;
  };

  const formatLatency = (value: unknown) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '0ms';
    return `${value.toFixed(1)}ms`;
  };

  const cards = [
    { label: t.totalRequests, value: formatNumber(stats?.totalRequests ?? 0), color: 'text-blue-600', icon: '📊', filter: {} },
    { label: t.successful, value: formatNumber(stats?.successfulRequests ?? 0), color: 'text-green-600', icon: '✅', filter: { status: 'success' } },
    { label: t.successRate, value: formatPercent(stats?.successRate ?? 0), color: 'text-purple-600', icon: '📈', filter: { status: 'error' } },
    { label: t.avgLatency, value: formatLatency(stats?.avgLatency ?? 0), color: 'text-orange-600', icon: '⚡', filter: { latencyMin: String(Math.round(stats?.avgLatency ?? 0)) } },
    { label: t.totalTokens, value: formatNumber(stats?.totalTokens ?? 0), color: 'text-indigo-600', icon: '🔤', filter: {} },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((card, index) => (
        <div
          key={index}
          className={`bg-white p-4 rounded-lg shadow-sm border transition-all ${onCardClick ? 'cursor-pointer hover:shadow-md hover:border-blue-200' : 'hover:shadow-md'}`}
          onClick={() => onCardClick?.(card.filter)}
          role={onCardClick ? 'link' : undefined}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm text-gray-500">{card.label}</p>
            <span className="text-lg">{card.icon}</span>
          </div>
          <p className={`text-2xl font-bold ${card.color}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}

