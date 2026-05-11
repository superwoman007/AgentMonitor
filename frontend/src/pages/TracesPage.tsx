import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { RefreshButton } from '../components/RefreshButton';
import { useTranslation } from '../App';
import { api, Trace, Dataset, TraceEvalResult, TraceTreeResponse } from '../api';
import { useProjectStore } from '../stores/projectStore';

export function TracesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProject } = useProjectStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [traceTree, setTraceTree] = useState<TraceTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState(searchParams.get('type') || '');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');
  const [filterEvalStatus, setFilterEvalStatus] = useState(searchParams.get('evalStatus') || '');
  const [selectedTraceIds, setSelectedTraceIds] = useState<Set<string>>(new Set());
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [showReflowModal, setShowReflowModal] = useState(false);
  const [reflowMode, setReflowMode] = useState<'single' | 'bulk'>('single');
  const [reflowForm, setReflowForm] = useState({ datasetId: '', datasetName: '', expectedOutput: '' });
  const [reflowLoading, setReflowLoading] = useState(false);
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [evalForm, setEvalForm] = useState({ evaluator: 'manual', score: 0.8, passed: true, details: '' });
  const [evalLoading, setEvalLoading] = useState(false);
  const [evaluations, setEvaluations] = useState<TraceEvalResult[]>([]);

  const loadTraces = useCallback(async () => {
    if (!currentProject?.id) return;
    setIsLoading(true);
    try {
      const params: { parentTraceId?: string; traceType?: string; status?: string; evalStatus?: string; limit: number } = {
        limit: 100,
      };
      if (filterType) params.traceType = filterType;
      if (filterStatus) params.status = filterStatus;
      if (filterEvalStatus) params.evalStatus = filterEvalStatus;
      const { traces } = await api.traces.list(currentProject.id, params);
      // Only show root traces by default (no parent)
      const rootTraces = traces.filter(t => !t.parent_trace_id);
      setTraces(rootTraces);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [currentProject?.id, filterType, filterStatus, filterEvalStatus]);

  const loadDatasets = useCallback(async () => {
    if (!currentProject?.id) return;
    try {
      const res = await api.evaluation.datasets.list(currentProject.id);
      setDatasets(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to load datasets:', e);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  const loadTraceTree = useCallback(async (traceId: string) => {
    try {
      const tree = await api.traces.getTree(traceId);
      setTraceTree(tree);
      setSelectedTrace(tree.trace);
      // Load eval results
      const { evaluations } = await api.traces.getEvals(traceId);
      setEvaluations(evaluations);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleSelectTrace = (trace: Trace) => {
    navigate(`/traces/${trace.id}`);
  };

  const handleRefresh = useCallback(async () => {
    await loadTraces();
    if (selectedTrace) {
      await loadTraceTree(selectedTrace.id);
    }
  }, [loadTraces, selectedTrace, loadTraceTree]);

  const handleAddEval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrace) return;
    setEvalLoading(true);
    try {
      const details = evalForm.details ? JSON.parse(evalForm.details) : undefined;
      await api.traces.addEval(selectedTrace.id, {
        evaluator: evalForm.evaluator,
        score: evalForm.score,
        passed: evalForm.passed ? 1 : 0,
        details,
      });
      setShowEvalModal(false);
      setEvalForm({ evaluator: 'manual', score: 0.8, passed: true, details: '' });
      await loadTraceTree(selectedTrace.id);
      await loadTraces();
    } catch (e: any) {
      alert(e.message || t.failedAddEvaluation);
    } finally {
      setEvalLoading(false);
    }
  };

  const openEvalModal = () => {
    setEvalForm({ evaluator: 'manual', score: 0.8, passed: true, details: '' });
    setShowEvalModal(true);
  };

  const toggleTraceSelection = (traceId: string) => {
    setSelectedTraceIds(prev => {
      const next = new Set(prev);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  };

  const selectAllTraces = () => {
    if (selectedTraceIds.size === traces.length) {
      setSelectedTraceIds(new Set());
    } else {
      setSelectedTraceIds(new Set(traces.map(t => t.id)));
    }
  };

  const openSingleReflow = (trace: Trace) => {
    setSelectedTraceIds(new Set([trace.id]));
    setReflowMode('single');
    setReflowForm({ datasetId: '', datasetName: '', expectedOutput: '' });
    setShowReflowModal(true);
  };

  const openBulkReflow = () => {
    setReflowMode('bulk');
    setReflowForm({ datasetId: '', datasetName: '', expectedOutput: '' });
    setShowReflowModal(true);
  };

  const handleReflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    setReflowLoading(true);
    try {
      if (reflowMode === 'single' && selectedTraceIds.size === 1) {
        const traceId = Array.from(selectedTraceIds)[0];
        await api.traces.addToDataset(traceId, {
          datasetId: reflowForm.datasetId || undefined,
          datasetName: reflowForm.datasetName || undefined,
          expectedOutput: reflowForm.expectedOutput || undefined,
        });
      } else if (reflowMode === 'bulk') {
        await api.traces.bulkExportDataset({
          projectId: currentProject.id,
          traceIds: Array.from(selectedTraceIds),
          datasetId: reflowForm.datasetId || undefined,
          datasetName: reflowForm.datasetName || undefined,
        });
      }
      setShowReflowModal(false);
      setReflowForm({ datasetId: '', datasetName: '', expectedOutput: '' });
      alert(t.exportDatasetSuccess);
    } catch (e: any) {
      alert(e.message || t.failedAddDataset);
    } finally {
      setReflowLoading(false);
    }
  };

  const formatDuration = (ms?: number) => {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (iso: string) => new Date(iso).toLocaleString();

  const traceTypes = Array.from(new Set(traces.map(t => t.trace_type)));

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.traceNav}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.traceList}</p>
          </div>
          <RefreshButton onRefresh={handleRefresh} />
        </div>

        <div className="flex gap-4 mb-4">
          <select
            value={filterType}
            onChange={e => {
              setFilterType(e.target.value);
              const sp = new URLSearchParams(searchParams);
              if (e.target.value) sp.set('type', e.target.value);
              else sp.delete('type');
              setSearchParams(sp);
            }}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="">{t.allTypes}</option>
            {traceTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => {
              setFilterStatus(e.target.value);
              const sp = new URLSearchParams(searchParams);
              if (e.target.value) sp.set('status', e.target.value);
              else sp.delete('status');
              setSearchParams(sp);
            }}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="">{t.allStatus}</option>
            <option value="success">{t.success}</option>
            <option value="error">{t.failed}</option>
          </select>
          <select
            value={filterEvalStatus}
            onChange={e => {
              setFilterEvalStatus(e.target.value);
              const sp = new URLSearchParams(searchParams);
              if (e.target.value) sp.set('evalStatus', e.target.value);
              else sp.delete('evalStatus');
              setSearchParams(sp);
            }}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="">{t.allEvalStatus}</option>
            <option value="needs_attention">⚠️ {t.needsAttention}</option>
            <option value="passed">✅ {t.passedLabel}</option>
            <option value="unevaluated">❓ {t.unevaluated}</option>
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{t.traceList}</h3>
                  {selectedTraceIds.size > 0 && (
                    <button
                      onClick={openBulkReflow}
                      className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                    >
                      + Dataset ({selectedTraceIds.size})
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={selectedTraceIds.size === traces.length && traces.length > 0}
                    onChange={selectAllTraces}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-xs text-gray-500">
                    {selectedTraceIds.size > 0 ? `${selectedTraceIds.size} ${t.selectedSuffix}` : t.selectAll}
                  </span>
                </div>
              </div>
              <div className="divide-y max-h-[600px] overflow-auto">
                {isLoading ? (
                  <div className="p-8 text-center text-gray-500">{t.loading}</div>
                ) : traces.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">{t.noTraces}</div>
                ) : (
                  traces.map(trace => (
                    <div
                      key={trace.id}
                      onClick={() => handleSelectTrace(trace)}
                      className={`p-4 cursor-pointer transition-colors ${
                        selectedTrace?.id === trace.id ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedTraceIds.has(trace.id)}
                          onClick={(e) => { e.stopPropagation(); toggleTraceSelection(trace.id); }}
                          onChange={() => {}}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm text-gray-900 truncate">{trace.name}</p>
                            {trace.status === 'error' && (
                              <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] rounded font-medium">{t.recommend}</span>
                            )}
                            {trace.latest_eval_score !== null && trace.latest_eval_score !== undefined && (
                              <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                                trace.latest_eval_passed
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {(trace.latest_eval_score * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{trace.trace_type} · {formatTime(trace.started_at)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {trace.latest_eval_passed === 0 && trace.latest_eval_score !== null && (
                            <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] rounded font-medium" title={t.needsAttention}>⚠️</span>
                          )}
                          <span className={`ml-2 px-2 py-1 rounded text-xs font-medium ${
                            trace.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {trace.status === 'success' ? t.success : t.failed}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-400 pl-7">{formatDuration(trace.latency_ms)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedTrace && traceTree ? (
              <div className="space-y-4">
                <div className="bg-white p-6 rounded-lg shadow-sm border">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">{t.traceDetails}</h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={openEvalModal}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                      >
                        Eval
                      </button>
                      <button
                        onClick={() => { setSelectedTraceIds(new Set([selectedTrace.id])); openSingleReflow(selectedTrace); }}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        + Dataset
                      </button>
                      {'children' in traceTree && traceTree.children.length > 0 && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {traceTree.children.length} {t.childTraces}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500">{t.traceType}</p>
                      <p className="text-sm font-mono">{selectedTrace.trace_type}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t.status}</p>
                      <p className={`text-sm ${selectedTrace.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {selectedTrace.status === 'success' ? t.success : t.failed}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t.latency}</p>
                      <p className="text-sm">{formatDuration(selectedTrace.latency_ms)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t.evalScore}</p>
                      <p className={`text-sm font-medium ${
                        selectedTrace.latest_eval_score !== null && selectedTrace.latest_eval_score !== undefined
                          ? (selectedTrace.latest_eval_passed ? 'text-green-600' : 'text-red-600')
                          : 'text-gray-400'
                      }`}>
                        {selectedTrace.latest_eval_score !== null && selectedTrace.latest_eval_score !== undefined
                          ? `${(selectedTrace.latest_eval_score * 100).toFixed(0)}% ${selectedTrace.latest_eval_passed ? '✅' : '❌'}`
                          : t.notEvaluated}
                      </p>
                    </div>
                  </div>

                  {evaluations.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-2">{t.evaluationHistory}</p>
                      <div className="space-y-2">
                        {evaluations.map(ev => (
                          <div key={ev.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${ev.passed ? 'bg-green-500' : 'bg-red-500'}`} />
                              <span className="font-medium">{ev.evaluator || t.manual}</span>
                              <span className="text-gray-500">{formatTime(ev.created_at)}</span>
                            </div>
                            <span className={`font-mono font-medium ${ev.passed ? 'text-green-600' : 'text-red-600'}`}>
                              {ev.score !== null ? (ev.score * 100).toFixed(0) + '%' : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedTrace.input !== undefined && selectedTrace.input !== null && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-1">{t.input}</p>
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-40">
                        {typeof selectedTrace.input === 'string' ? selectedTrace.input : JSON.stringify(selectedTrace.input, null, 2)}
                      </pre>
                    </div>
                  )}

                  {selectedTrace.output !== undefined && selectedTrace.output !== null && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-1">{t.output}</p>
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-40">
                        {typeof selectedTrace.output === 'string' ? selectedTrace.output : JSON.stringify(selectedTrace.output, null, 2)}
                      </pre>
                    </div>
                  )}

                  {selectedTrace.error && (
                    <div className="mb-4">
                      <p className="text-xs text-red-500 mb-1">{t.error}</p>
                      <pre className="bg-red-50 p-3 rounded text-xs text-red-700 overflow-auto max-h-40">
                        {selectedTrace.error}
                      </pre>
                    </div>
                  )}
                </div>

                {'children' in traceTree && traceTree.children.length > 0 && (
                  <div className="bg-white p-6 rounded-lg shadow-sm border">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.childTraces}</h3>
                    <div className="space-y-3">
                      {traceTree.children.map(child => (
                        <div key={child.id} className="p-3 border rounded-md hover:bg-gray-50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">{child.name}</p>
                              <p className="text-xs text-gray-500">{child.trace_type} · {formatDuration(child.latency_ms)}</p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              child.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {child.status === 'success' ? t.success : t.failed}
                            </span>
                          </div>
                          {child.output !== undefined && child.output !== null && (
                            <pre className="mt-2 bg-gray-50 p-2 rounded text-xs overflow-auto max-h-24">
                              {typeof child.output === 'string' ? child.output : JSON.stringify(child.output, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white p-8 rounded-lg shadow-sm border text-center text-gray-500">
                {t.selectTrace}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Eval Modal */}
      {showEvalModal && selectedTrace && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.addEvaluation}</h3>
            <form onSubmit={handleAddEval} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.evaluator}</label>
                <input
                  type="text"
                  value={evalForm.evaluator}
                  onChange={(e) => setEvalForm({ ...evalForm, evaluator: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder={t.evaluatorExample}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.scoreRange}</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={evalForm.score}
                  onChange={(e) => setEvalForm({ ...evalForm, score: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={evalForm.passed}
                    onChange={(e) => setEvalForm({ ...evalForm, passed: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-purple-600"
                  />
                  <span className="text-gray-700">{t.passedLabel}</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.detailsOptional}</label>
                <textarea
                  value={evalForm.details}
                  onChange={(e) => setEvalForm({ ...evalForm, details: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                  rows={3}
                  placeholder={t.matchedJsonExample}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEvalModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={evalLoading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm disabled:opacity-50"
                >
                  {evalLoading ? t.saving : t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reflow Modal */}
      {showReflowModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">
              {reflowMode === 'single' ? t.addToDataset : `${t.addTracesToDataset} (${selectedTraceIds.size})`}
            </h3>
            <form onSubmit={handleReflow} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.dataset}</label>
                <select
                  value={reflowForm.datasetId}
                  onChange={(e) => setReflowForm({ ...reflowForm, datasetId: e.target.value, datasetName: '' })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">{t.createNewDataset}</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.item_count} {t.datasetItemsSuffix})</option>
                  ))}
                </select>
              </div>
              {!reflowForm.datasetId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.newDatasetName}</label>
                  <input
                    type="text"
                    value={reflowForm.datasetName}
                    onChange={(e) => setReflowForm({ ...reflowForm, datasetName: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder={t.datasetNameExample}
                    required={!reflowForm.datasetId}
                  />
                </div>
              )}
              {reflowMode === 'single' && (
                <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.expectedOutputOptional}</label>
                  <textarea
                    value={reflowForm.expectedOutput}
                    onChange={(e) => setReflowForm({ ...reflowForm, expectedOutput: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    rows={3}
                    placeholder={t.expectedCorrectAnswer}
                  />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReflowModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={reflowLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                >
                  {reflowLoading ? t.saving : t.add}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
