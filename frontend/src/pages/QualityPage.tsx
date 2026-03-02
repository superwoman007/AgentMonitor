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
} from 'recharts';

interface QualityScore {
  score: number;
  speedScore: number;
  successScore: number;
  totalTraces: number;
}

interface QualityTrendPoint {
  date: string;
  score: number;
  speedScore: number;
  successScore: number;
  count: number;
}

export function QualityPage() {
  const { currentProject } = useProjectStore();
  const { t } = useTranslation();
  const [score, setScore] = useState<QualityScore | null>(null);
  const [trend, setTrend] = useState<QualityTrendPoint[]>([]);
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
      const [scoreRes, trendRes] = await Promise.all([
        api.quality.score(currentProject.id),
        api.quality.trend(currentProject.id, 7),
      ]);
      setScore(scoreRes.score);
      setTrend(trendRes.trend);
    } catch (error) {
      console.error('Failed to fetch quality data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-green-50 border-green-200';
    if (score >= 60) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

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
        <h1 className="text-2xl font-bold text-gray-900">{t.qualityAnalysis}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.qualityDesc}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className={`rounded-lg border-2 p-6 ${getScoreBg(score?.score || 0)}`}>
          <div className="text-center">
            <div className={`text-6xl font-bold ${getScoreColor(score?.score || 0)}`}>
              {score?.score ?? 0}
            </div>
            <div className="text-gray-600 mt-2">{t.qualityScore}</div>
            <div className="text-xs text-gray-400 mt-1">
              {t.basedOn} {score?.totalTraces ?? 0} {t.traces}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.speedScore}</h3>
          <div className="flex items-center justify-between">
            <div className={`text-4xl font-bold ${getScoreColor(score?.speedScore || 0)}`}>
              {score?.speedScore ?? 0}
            </div>
            <div className="text-right text-sm text-gray-500">
              <div>{t.weight}: 60%</div>
              <div className="text-xs text-gray-400">{t.latencyBased}</div>
            </div>
          </div>
          <div className="mt-4 text-xs text-gray-500">
            <div className="flex justify-between"><span>&lt; 500ms</span><span>100</span></div>
            <div className="flex justify-between"><span>&lt; 2s</span><span>80</span></div>
            <div className="flex justify-between"><span>&lt; 5s</span><span>50</span></div>
            <div className="flex justify-between"><span>&gt; 5s</span><span>20</span></div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-700 mb-4">{t.successScore}</h3>
          <div className="flex items-center justify-between">
            <div className={`text-4xl font-bold ${getScoreColor(score?.successScore || 0)}`}>
              {score?.successScore ?? 0}
            </div>
            <div className="text-right text-sm text-gray-500">
              <div>{t.weight}: 40%</div>
              <div className="text-xs text-gray-400">{t.statusBased}</div>
            </div>
          </div>
          <div className="mt-4 text-xs text-gray-500">
            <div className="flex justify-between"><span>{t.success}</span><span>100</span></div>
            <div className="flex justify-between"><span>{t.failed}</span><span>0</span></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h3 className="font-medium text-gray-700 mb-4">{t.qualityTrend}</h3>
        {trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={[...trend].reverse()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                strokeWidth={2}
                name={t.qualityScore}
              />
              <Line
                type="monotone"
                dataKey="speedScore"
                stroke="#10b981"
                strokeWidth={2}
                name={t.speedScore}
              />
              <Line
                type="monotone"
                dataKey="successScore"
                stroke="#f59e0b"
                strokeWidth={2}
                name={t.successScore}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center text-gray-500 py-12">{t.noData}</div>
        )}
      </div>
    </Layout>
  );
}
