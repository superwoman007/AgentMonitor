import { useEffect, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { RefreshButton } from '../components/RefreshButton';
import { useTranslation } from '../App';
import { api, UserFeedback, FeedbackStats } from '../api';
import { useProjectStore } from '../stores/projectStore';

export function FeedbackPage() {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const [feedbacks, setFeedbacks] = useState<UserFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filterRating, setFilterRating] = useState<string>('');

  const loadData = useCallback(async () => {
    if (!currentProject?.id) return;
    setIsLoading(true);
    try {
      const [feedbacksRes, statsRes] = await Promise.all([
        api.feedbacks.list(currentProject.id, {
          rating: filterRating ? parseInt(filterRating, 10) : undefined,
          limit: 100,
        }),
        api.feedbacks.stats(currentProject.id),
      ]);
      setFeedbacks(feedbacksRes.feedbacks);
      setStats(statsRes.stats);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [currentProject?.id, filterRating]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatTime = (iso: string) => new Date(iso).toLocaleString();

  const ratingLabel = (rating: number) => {
    if (rating > 0) return { text: t.ratingPositive, class: 'bg-green-100 text-green-700' };
    if (rating < 0) return { text: t.ratingNegative, class: 'bg-red-100 text-red-700' };
    return { text: t.ratingNeutral, class: 'bg-gray-100 text-gray-700' };
  };

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.feedbackTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.feedbackSubtitle}</p>
          </div>
          <RefreshButton onRefresh={loadData} />
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm border">
              <p className="text-xs text-gray-500 uppercase">{t.totalFeedback}</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border">
              <p className="text-xs text-gray-500 uppercase">{t.positive}</p>
              <p className="text-2xl font-bold text-green-600">{stats.positive}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border">
              <p className="text-xs text-gray-500 uppercase">{t.negative}</p>
              <p className="text-2xl font-bold text-red-600">{stats.negative}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border">
              <p className="text-xs text-gray-500 uppercase">{t.positiveRate}</p>
              <p className="text-2xl font-bold text-blue-600">{(stats.positiveRate * 100).toFixed(0)}%</p>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-4 mb-4">
          <select
            value={filterRating}
            onChange={e => setFilterRating(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="">{t.allRatings}</option>
            <option value="1">{t.ratingPositive}</option>
            <option value="0">{t.ratingNeutral}</option>
            <option value="-1">{t.ratingNegative}</option>
          </select>
        </div>

        {/* Feedback List */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-gray-900">{t.feedbackEntries}</h3>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">{t.loading}</div>
          ) : feedbacks.length === 0 ? (
            <div className="p-8 text-center text-gray-500">{t.noFeedbackYet}</div>
          ) : (
            <div className="divide-y max-h-[600px] overflow-auto">
              {feedbacks.map(feedback => {
                const label = ratingLabel(feedback.rating);
                return (
                  <div key={feedback.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${label.class}`}>
                            {label.text}
                          </span>
                          {feedback.reason && (
                            <span className="text-xs text-gray-500">{feedback.reason}</span>
                          )}
                        </div>
                        {feedback.comment && (
                          <p className="text-sm text-gray-700 mb-2">{feedback.comment}</p>
                        )}
                        {feedback.dimensions && (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(feedback.dimensions).map(([key, val]) => (
                              <span key={key} className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                                {key}: {String(val)}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-gray-400 mt-2">
                          {feedback.session_id && `${t.sessionLabel}: ${feedback.session_id}`}
                          {feedback.session_id && feedback.message_id && ' · '}
                          {feedback.message_id && `${t.messageLabel}: ${feedback.message_id}`}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 ml-4 whitespace-nowrap">
                        {formatTime(feedback.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
