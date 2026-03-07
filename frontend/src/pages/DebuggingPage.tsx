import { useState, useEffect } from 'react';
import { useTranslation } from '../App';
import { useBreakpointStore } from '../stores/breakpointStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useProjectStore } from '../stores/projectStore';
import { Layout } from '../components/Layout';

export function DebuggingPage() {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const {
    breakpoints,
    fetchBreakpoints,
    createBreakpoint,
    deleteBreakpoint,
    toggleBreakpoint,
  } = useBreakpointStore();
  const {
    snapshots,
    fetchSnapshots,
  } = useSnapshotStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBreakpoint, setNewBreakpoint] = useState({
    name: '',
    type: 'keyword' as 'keyword' | 'error' | 'latency',
    condition: '',
  });

  useEffect(() => {
    if (currentProject) {
      fetchBreakpoints(currentProject.id);
      fetchSnapshots(currentProject.id);
    }
  }, [currentProject]);

  const handleCreateBreakpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      await createBreakpoint(currentProject.id, newBreakpoint);
      setShowCreateModal(false);
      setNewBreakpoint({ name: '', type: 'keyword', condition: '' });
    } catch (error) {
      console.error('Failed to create breakpoint:', error);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">{t.breakpoints}</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {t.addBreakpoint}
          </button>
        </div>

        {/* 断点列表 */}
        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">{t.breakpoints}</h2>
          </div>
          <div className="divide-y">
            {breakpoints.map((bp) => (
              <div key={bp.id} className="px-6 py-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{bp.name}</p>
                  <p className="text-sm text-gray-500">
                    {bp.type}: {bp.condition}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleBreakpoint(bp.id)}
                    className={`px-3 py-1 rounded ${
                      bp.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {bp.enabled ? t.enabled : t.disabled}
                  </button>
                  <button
                    onClick={() => deleteBreakpoint(bp.id)}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    {t.delete}
                  </button>
                </div>
              </div>
            ))}
            {breakpoints.length === 0 && (
              <div className="px-6 py-12 text-center text-gray-500">
                {t.noBreakpoints}
              </div>
            )}
          </div>
        </div>

        {/* 断点触发历史 */}
        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">{t.triggerHistory}</h2>
          </div>
          <div className="divide-y max-h-96 overflow-auto">
            {snapshots.map((snap) => (
              <div key={snap.id} className="px-6 py-4">
                <p className="font-medium">{snap.trigger_reason}</p>
                <p className="text-sm text-gray-500">{new Date(snap.timestamp).toLocaleString()}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-blue-600">{t.viewDetails}</summary>
                  <pre className="mt-2 bg-gray-50 p-3 rounded text-xs overflow-auto whitespace-pre-wrap break-words max-h-80">
                    {JSON.stringify(snap.state, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
            {snapshots.length === 0 && (
              <div className="px-6 py-12 text-center text-gray-500">
                {t.noSnapshots}
              </div>
            )}
          </div>
        </div>

        {/* 创建断点弹窗 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">{t.addBreakpoint}</h2>
              <form onSubmit={handleCreateBreakpoint} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t.name}</label>
                  <input
                    type="text"
                    value={newBreakpoint.name}
                    onChange={(e) => setNewBreakpoint({ ...newBreakpoint, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t.breakpointType}</label>
                  <select
                    value={newBreakpoint.type}
                    onChange={(e) => setNewBreakpoint({ ...newBreakpoint, type: e.target.value as 'keyword' | 'error' | 'latency' })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="keyword">{t.keyword}</option>
                    <option value="error">{t.error}</option>
                    <option value="latency">{t.latency}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t.condition}</label>
                  <input
                    type="text"
                    value={newBreakpoint.condition}
                    onChange={(e) => setNewBreakpoint({ ...newBreakpoint, condition: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                    placeholder={
                      newBreakpoint.type === 'keyword' ? 'e.g., "error", "failed"' :
                      newBreakpoint.type === 'error' ? 'e.g., "timeout|failed"' :
                      'e.g., "5000" (ms)'
                    }
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {t.create}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
