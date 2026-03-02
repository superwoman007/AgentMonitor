import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../api';
import { useTranslation } from '../App';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

interface CostSummary {
  today: number;
  week: number;
  month: number;
  total: number;
}

interface CostTrendPoint {
  date: string;
  cost: number;
  count: number;
}

interface CostByModel {
  model: string;
  count: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  inputTokens: number;
  outputTokens: number;
}

interface ExpensiveCall {
  id: string;
  name: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  startedAt: string;
}

interface CostSuggestion {
  type: 'downgrade' | 'cache' | 'batch' | 'optimize';
  message: string;
  potentialSaving: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function CostPage() {
  const { currentProject } = useProjectStore();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [byModel, setByModel] = useState<CostByModel[]>([]);
  const [topCalls, setTopCalls] = useState<ExpensiveCall[]>([]);
  const [suggestions, setSuggestions] = useState<CostSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentProject) {
      fetchData();
    }
  }, [currentProject]);

  const fetchData = async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const [summaryRes, byModelRes, topRes, suggestionsRes] = await Promise.all([
        api.cost.summary(currentProject.id, 7),
        api.cost.byModel(currentProject.id),
        api.cost.top(currentProject.id, 10),
        api.cost.suggestions(currentProject.id),
      ]);
      setSummary(summaryRes.summary);
      setTrend(summaryRes.trend);
      setByModel(byModelRes.byModel);
      setTopCalls(topRes.top);
      setSuggestions(suggestionsRes.suggestions);
    } catch (error) {
      console.error('Failed to fetch cost data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCost = (cost: number) => `$${cost.toFixed(4)}`;

  const pieData = byModel.map((m) => ({
    name: m.model,
    value: m.totalCost,
  }));

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">{t.loading}</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.costAnalysis}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.costDesc}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">{t.today}</div>
          <div className="text-2xl font-bold text-gray-900">{formatCost(summary?.today || 0)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">{t.thisWeek}</div>
          <div className="text-2xl font-bold text-gray-900">{formatCost(summary?.week || 0)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">{t.thisMonth}</div>
          <div className="text-2xl font-bold text-gray-900">{formatCost(summary?.month || 0)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">{t.total}</div>
          <div className="text-2xl font-bold text-gray-900">{formatCost(summary?.total || 0)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.costTrend}</h3>
          {trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={[...trend].reverse()}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip formatter={(value: number) => formatCost(value)} />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  name={t.cost}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-gray-500 py-12">{t.noData}</div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.costByModel}</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCost(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-gray-500 py-12">{t.noData}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.topExpensiveCalls}</h3>
          {topCalls.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">{t.name}</th>
                    <th className="text-left py-2">{t.model}</th>
                    <th className="text-right py-2">{t.cost}</th>
                  </tr>
                </thead>
                <tbody>
                  {topCalls.map((call, index) => (
                    <tr key={call.id} className={index < topCalls.length - 1 ? 'border-b' : ''}>
                      <td className="py-2 text-gray-700">{call.name}</td>
                      <td className="py-2 text-gray-500">{call.model}</td>
                      <td className="py-2 text-right font-mono">{formatCost(call.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">{t.noData}</div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.optimizationSuggestions}</h3>
          {suggestions.length > 0 ? (
            <div className="space-y-3">
              {suggestions.map((s, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">
                      {s.type === 'downgrade' && '⬇️'}
                      {s.type === 'cache' && '💾'}
                      {s.type === 'batch' && '📦'}
                      {s.type === 'optimize' && '⚡'}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{s.message}</p>
                      {s.potentialSaving > 0 && (
                        <p className="text-xs text-green-600 mt-1">
                          {t.potentialSaving}: {formatCost(s.potentialSaving)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">{t.noSuggestions}</div>
          )}
        </div>
      </div>
    </Layout>
  );
}
