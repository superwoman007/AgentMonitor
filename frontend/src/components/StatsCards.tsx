import { useTranslation } from '../App';
import { Stats } from '../api';

interface StatsCardsProps {
  stats: Stats | null;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const { t } = useTranslation();

  const cards = [
    { label: t.totalRequests, value: stats?.totalRequests || 0, color: 'text-blue-600', icon: '📊' },
    { label: t.successful, value: stats?.successfulRequests || 0, color: 'text-green-600', icon: '✅' },
    { label: t.successRate, value: `${stats?.successRate || 0}%`, color: 'text-purple-600', icon: '📈' },
    { label: t.avgLatency, value: `${stats?.avgLatency || 0}ms`, color: 'text-orange-600', icon: '⚡' },
    { label: t.totalTokens, value: stats?.totalTokens || 0, color: 'text-indigo-600', icon: '🔤' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((card, index) => (
        <div key={index} className="bg-white p-4 rounded-lg shadow-sm border hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm text-gray-500">{card.label}</p>
            <span className="text-lg">{card.icon}</span>
          </div>
          <p className={`text-2xl font-bold ${card.color}`}>
            {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
