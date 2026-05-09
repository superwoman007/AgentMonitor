import { useEffect, useState, useRef } from 'react';
import { Layout } from '../components/Layout';
import { useProjectStore } from '../stores/projectStore';
import { api, Dataset, DatasetItem, Evaluator, EvaluationExperiment, EvaluatorTemplate, ExperimentProgress, AutoEvalTask, ModelConfig } from '../api';
import { useTranslation } from '../App';

type Tab = 'datasets' | 'evaluators' | 'experiments' | 'tasks';

export function EvaluationPage() {
  const { currentProject, ensureDefaultProject } = useProjectStore();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('datasets');
  const [loading, setLoading] = useState(true);

  // Datasets state
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [datasetForm, setDatasetForm] = useState({ name: '', description: '', type: 'custom', auto_create_evaluators: false });
  const [itemInputs, setItemInputs] = useState([{ input: '', expected_output: '' }]);

  // Evaluators state
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [showEvaluatorModal, setShowEvaluatorModal] = useState(false);
  const [evaluatorForm, setEvaluatorForm] = useState({ name: '', type: 'exact_match', description: '', config: '{}', model_config_id: '' });

  // Experiments state
  const [experiments, setExperiments] = useState<EvaluationExperiment[]>([]);
  const [showExperimentModal, setShowExperimentModal] = useState(false);
  const [experimentForm, setExperimentForm] = useState({ name: '', description: '', dataset_id: '', model_config_id: '' });
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [experimentReports, setExperimentReports] = useState<Record<string, any>>({});
  const [showReportModal, setShowReportModal] = useState<string | null>(null);
  const [badCases, setBadCases] = useState<Record<string, any[]>>({});
  const [calibratingResult, setCalibratingResult] = useState<string | null>(null);
  const [calibrationForm, setCalibrationForm] = useState({ score: 0, passed: false, note: '' });

  // Auto eval tasks state
  const [autoEvalTasks, setAutoEvalTasks] = useState<AutoEvalTask[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({
    name: '', dataset_id: '', evaluator_id: '', interval_hours: 24, sample_count: 10, trace_type_filter: '', enabled: true,
  });
  const [experimentProgress, setExperimentProgress] = useState<Record<string, ExperimentProgress>>({});
  const [evaluatorTemplates, setEvaluatorTemplates] = useState<EvaluatorTemplate[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    ensureDefaultProject();
  }, [ensureDefaultProject]);

  // WebSocket for real-time experiment progress
  useEffect(() => {
    if (!currentProject) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isDev = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    const wsHost = isDev ? `${window.location.hostname}:3000` : window.location.host;
    const wsUrl = `${protocol}//${wsHost}/ws`;
    let alive = true;
    let retryTimer: number | undefined;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ type: 'subscribe', projectId: currentProject.id }));
        } catch {
          // ignore
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'experiment_progress' && data.experiment_id) {
            setExperimentProgress((prev) => ({
              ...prev,
              [data.experiment_id]: {
                experiment_id: data.experiment_id,
                status: 'running',
                total_items: data.total,
                completed_items: data.current,
                completion_rate: data.completion_rate,
              },
            }));
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        retryTimer = window.setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        if (!alive) return;
      };
    };

    connect();

    return () => {
      alive = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentProject?.id]);

  const fetchDatasets = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.datasets.list(currentProject.id);
      setDatasets(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch datasets:', e);
    }
  };

  const fetchModelConfigs = async () => {
    if (!currentProject) return;
    try {
      const res = await api.modelConfigs.list(currentProject.id);
      setModelConfigs(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch model configs:', e);
    }
  };

  const fetchEvaluators = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.evaluators.list(currentProject.id);
      setEvaluators(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch evaluators:', e);
    }
  };

  const fetchExperiments = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.experiments.list(currentProject.id);
      setExperiments(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch experiments:', e);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchDatasets(), fetchEvaluators(), fetchExperiments(), fetchModelConfigs()]);
    setLoading(false);
  };

  useEffect(() => {
    if (!currentProject) {
      setLoading(false);
      return;
    }
    fetchAll();
    fetchEvaluatorTemplates();
  }, [currentProject?.id]);

  // Dataset actions
  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      const result = await api.evaluation.datasets.create({
        project_id: currentProject.id,
        name: datasetForm.name,
        description: datasetForm.description,
        type: datasetForm.type,
        auto_create_evaluators: datasetForm.auto_create_evaluators,
      });
      if (result.preset_evaluators && result.preset_evaluators.length > 0) {
        alert(t.autoEvaluatorsCreated.replace('{count}', String(result.preset_evaluators.length)));
      }
      setShowDatasetModal(false);
      setDatasetForm({ name: '', description: '', type: 'custom', auto_create_evaluators: false });
      fetchDatasets();
      fetchEvaluators();
    } catch (e) {
      console.error('Failed to create dataset:', e);
    }
  };

  const handleDeleteDataset = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.evaluation.datasets.delete(id);
      if (selectedDataset?.id === id) setSelectedDataset(null);
      fetchDatasets();
    } catch (e) {
      console.error('Failed to delete dataset:', e);
    }
  };

  const handleSelectDataset = async (dataset: Dataset) => {
    setSelectedDataset(dataset);
    try {
      const items = await api.evaluation.datasets.items.list(dataset.id);
      setDatasetItems(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error('Failed to fetch dataset items:', e);
    }
  };

  const handleAddItems = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDataset) return;
    try {
      const validItems = itemInputs.filter(i => i.input.trim());
      if (validItems.length === 0) return;
      await api.evaluation.datasets.items.add(selectedDataset.id, validItems);
      setShowItemsModal(false);
      setItemInputs([{ input: '', expected_output: '' }]);
      handleSelectDataset(selectedDataset);
      fetchDatasets();
    } catch (e) {
      console.error('Failed to add items:', e);
    }
  };

  // Evaluator actions
  const handleCreateEvaluator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      let config = {};
      try {
        config = JSON.parse(evaluatorForm.config);
      } catch {
        config = {};
      }
      await api.evaluation.evaluators.create({
        project_id: currentProject.id,
        name: evaluatorForm.name,
        type: evaluatorForm.type,
        description: evaluatorForm.description,
        config,
        model_config_id: evaluatorForm.model_config_id || undefined,
      });
      setShowEvaluatorModal(false);
      setEvaluatorForm({ name: '', type: 'exact_match', description: '', config: '{}', model_config_id: '' });
      fetchEvaluators();
    } catch (e) {
      console.error('Failed to create evaluator:', e);
    }
  };

  const handleDeleteEvaluator = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.evaluation.evaluators.delete(id);
      fetchEvaluators();
    } catch (e) {
      console.error('Failed to delete evaluator:', e);
    }
  };

  // Experiment actions
  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      const selectedConfig = modelConfigs.find(c => c.id === experimentForm.model_config_id);
      await api.evaluation.experiments.create({
        project_id: currentProject.id,
        name: experimentForm.name,
        description: experimentForm.description,
        dataset_id: experimentForm.dataset_id,
        model_config: selectedConfig ? {
          name: selectedConfig.name,
          provider: selectedConfig.provider,
          model: selectedConfig.model,
          base_url: selectedConfig.base_url,
          config: selectedConfig.config,
        } : undefined,
      });
      setShowExperimentModal(false);
      setExperimentForm({ name: '', description: '', dataset_id: '', model_config_id: '' });
      fetchExperiments();
    } catch (e) {
      console.error('Failed to create experiment:', e);
    }
  };

  const handleStartExperiment = async (id: string) => {
    try {
      await api.evaluation.experiments.start(id);
      fetchExperiments();
    } catch (e) {
      console.error('Failed to start experiment:', e);
    }
  };

  const handleDeleteExperiment = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.evaluation.experiments.delete(id);
      fetchExperiments();
    } catch (e) {
      console.error('Failed to delete experiment:', e);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return t.experimentStatusPending;
      case 'running': return t.experimentStatusRunning;
      case 'completed': return t.experimentStatusCompleted;
      case 'failed': return t.experimentStatusFailed;
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-700';
      case 'running': return 'bg-blue-100 text-blue-700';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100';
    }
  };

  const fetchAutoEvalTasks = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.autoEvalTasks.list(currentProject.id);
      setAutoEvalTasks(res.tasks || []);
    } catch (e) {
      console.error('Failed to fetch auto eval tasks:', e);
    }
  };

  const handleCreateAutoEvalTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      await api.evaluation.autoEvalTasks.create({
        project_id: currentProject.id,
        name: taskForm.name,
        dataset_id: taskForm.dataset_id,
        evaluator_id: taskForm.evaluator_id || undefined,
        interval_hours: taskForm.interval_hours,
        sample_count: taskForm.sample_count,
        trace_type_filter: taskForm.trace_type_filter || undefined,
        enabled: taskForm.enabled,
      });
      setShowTaskModal(false);
      setTaskForm({ name: '', dataset_id: '', evaluator_id: '', interval_hours: 24, sample_count: 10, trace_type_filter: '', enabled: true });
      fetchAutoEvalTasks();
    } catch (e) {
      console.error('Failed to create auto eval task:', e);
    }
  };

  const handleDeleteAutoEvalTask = async (id: string) => {
    if (!confirm(t.autoEvalTaskDeleteConfirm)) return;
    try {
      await api.evaluation.autoEvalTasks.delete(id);
      fetchAutoEvalTasks();
    } catch (e) {
      console.error('Failed to delete auto eval task:', e);
    }
  };

  const handleTriggerAutoEvalTask = async (id: string) => {
    try {
      await api.evaluation.autoEvalTasks.trigger(id);
      alert(t.taskTriggered);
      fetchAutoEvalTasks();
    } catch (e) {
      console.error('Failed to trigger auto eval task:', e);
    }
  };

  const fetchExperimentReport = async (id: string) => {
    try {
      const report = await api.evaluation.experiments.report(id);
      setExperimentReports(prev => ({ ...prev, [id]: report }));
      setShowReportModal(id);
      fetchExperimentBadCases(id);
    } catch (e) {
      console.error('Failed to fetch experiment report:', e);
    }
  };

  const fetchExperimentBadCases = async (id: string) => {
    try {
      const res = await api.evaluation.experiments.badcases(id);
      setBadCases(prev => ({ ...prev, [id]: res.badcases || [] }));
    } catch (e) {
      console.error('Failed to fetch bad cases:', e);
    }
  };

  const handleCalibrateResult = async (resultId: string) => {
    try {
      await api.evaluation.results.calibrate(resultId, {
        calibrated_score: calibrationForm.score,
        calibrated_passed: calibrationForm.passed,
        calibration_note: calibrationForm.note,
      });
      if (showReportModal) {
        fetchExperimentReport(showReportModal);
        fetchExperimentBadCases(showReportModal);
      }
      setCalibratingResult(null);
      setCalibrationForm({ score: 0, passed: false, note: '' });
    } catch (e) {
      console.error('Failed to calibrate result:', e);
    }
  };

  const fetchExperimentProgress = async (id: string) => {
    try {
      const progress = await api.evaluation.experiments.progress(id);
      setExperimentProgress(prev => ({ ...prev, [id]: progress }));
    } catch (e) {
      console.error('Failed to fetch experiment progress:', e);
    }
  };

  const fetchEvaluatorTemplates = async () => {
    try {
      const res = await api.evaluation.evaluatorTemplates.list();
      setEvaluatorTemplates(res.templates || []);
    } catch (e) {
      console.error('Failed to fetch evaluator templates:', e);
    }
  };

  const handleDownloadScript = async (id: string, lang: 'typescript' | 'python') => {
    try {
      const template = await api.evaluation.experiments.scriptTemplate(id);
      const content = template[lang];
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `experiment-run-${id}.${lang === 'typescript' ? 'ts' : 'py'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to download script:', e);
    }
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
        <h1 className="text-2xl font-bold text-gray-900">{t.evaluationCenter}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        {(['datasets', 'evaluators', 'experiments', 'tasks'] as Tab[]).map((tab) => (
          <button
            key={tab}
            data-testid={`${tab}-tab`}
            onClick={() => {
              setActiveTab(tab);
              setSelectedDataset(null);
              if (tab === 'tasks') fetchAutoEvalTasks();
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'datasets' && t.datasets}
            {tab === 'evaluators' && t.evaluators}
            {tab === 'experiments' && t.experiments}
            {tab === 'tasks' && t.autoEvalTasks}
          </button>
        ))}
      </div>

      {/* Datasets Tab */}
      {activeTab === 'datasets' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.datasets}</h2>
            <button
              data-testid="create-dataset-btn"
              onClick={() => setShowDatasetModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createDataset}
            </button>
          </div>

          {selectedDataset ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedDataset(null)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  ← {t.back}
                </button>
                <button
                  data-testid="add-items-btn"
                  onClick={() => setShowItemsModal(true)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  {t.addItems}
                </button>
              </div>
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-medium text-lg">{selectedDataset.name}</h3>
                <p className="text-sm text-gray-500">{selectedDataset.description}</p>
                <p className="text-xs text-gray-400 mt-1">{t.itemCount}: {datasetItems.length}</p>
              </div>
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">{t.itemInput}</th>
                      <th className="px-4 py-2 text-left">{t.itemExpectedOutput}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasetItems.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-4 py-2">{item.input}</td>
                        <td className="px-4 py-2">{item.expected_output || '-'}</td>
                      </tr>
                    ))}
                    {datasetItems.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-8 text-center text-gray-500">{t.noData}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  data-testid={`dataset-card-${dataset.id}`}
                  onClick={() => handleSelectDataset(dataset)}
                  className="bg-white border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{dataset.name}</h3>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{dataset.type}</span>
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2">{dataset.description}</p>
                  <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                    <span>{dataset.item_count} {t.items}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDataset(dataset.id);
                      }}
                      className="text-red-600 hover:underline"
                    >
                      {t.delete}
                    </button>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-12 bg-white border rounded-lg">
                  {t.noDatasets}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Evaluators Tab */}
      {activeTab === 'evaluators' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.evaluators}</h2>
            <button
              data-testid="create-evaluator-btn"
              onClick={() => setShowEvaluatorModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createEvaluator}
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.evaluatorName}</th>
                  <th className="px-4 py-2 text-left">{t.evaluatorType}</th>
                  <th className="px-4 py-2 text-left">{t.judgeModel}</th>
                  <th className="px-4 py-2 text-left">{t.description}</th>
                  <th className="px-4 py-2 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {evaluators.map((ev) => (
                  <tr key={ev.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{ev.name}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{ev.type}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {ev.type === 'llm_judge' && ev.model_config_id
                        ? (modelConfigs.find(c => c.id === ev.model_config_id)?.name || ev.model_config_id.slice(0, 8))
                        : '-'}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{ev.description || '-'}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleDeleteEvaluator(ev.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t.delete}
                      </button>
                    </td>
                  </tr>
                ))}
                {evaluators.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{t.noEvaluators}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Experiments Tab */}
      {activeTab === 'experiments' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.experiments}</h2>
            <button
              data-testid="create-experiment-btn"
              onClick={() => setShowExperimentModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createExperiment}
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.experimentName}</th>
                  <th className="px-4 py-2 text-left">{t.status}</th>
                  <th className="px-4 py-2 text-left">{t.dataset}</th>
                  <th className="px-4 py-2 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map((exp) => {
                  const progress = experimentProgress[exp.id];
                  return (
                    <tr key={exp.id} className="border-t">
                      <td className="px-4 py-2 font-medium">{exp.name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(exp.status)}`}>
                          {getStatusLabel(exp.status)}
                        </span>
                        {progress && progress.total_items > 0 && (
                          <div className="mt-1 text-xs text-gray-500">
                            {t.progress}: {progress.completed_items}/{progress.total_items} ({progress.completion_rate}%)
                          </div>
                        )}
                        {progress && progress.total_items > 0 && (
                          <div className="w-24 h-1.5 bg-gray-200 rounded mt-1">
                            <div
                              className="h-1.5 bg-blue-500 rounded"
                              style={{ width: `${progress.completion_rate}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {datasets.find(d => d.id === exp.dataset_id)?.name || exp.dataset_id}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {exp.status === 'pending' && (
                            <button
                              data-testid="start-experiment-btn"
                              onClick={() => handleStartExperiment(exp.id)}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              {t.startExperiment}
                            </button>
                          )}
                          <button
                            onClick={() => fetchExperimentProgress(exp.id)}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            title={t.refreshProgress}
                          >
                            {t.progress}
                          </button>
                          <button
                            onClick={() => handleDownloadScript(exp.id, 'typescript')}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            title={t.downloadTsScript}
                          >
                            TS
                          </button>
                          <button
                            onClick={() => handleDownloadScript(exp.id, 'python')}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            title={t.downloadPyScript}
                          >
                            Py
                          </button>
                          <button
                            onClick={() => fetchExperimentReport(exp.id)}
                            className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                            title={t.viewReport}
                          >
                            {t.viewReport}
                          </button>
                          <button
                            onClick={() => handleDeleteExperiment(exp.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            {t.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {experiments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">{t.noExperiments}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Auto Eval Tasks Tab */}
      {activeTab === 'tasks' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.autoEvalTasks}</h2>
            <button
              onClick={() => setShowTaskModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createTask}
            </button>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.taskName}</th>
                  <th className="px-4 py-2 text-left">{t.interval}</th>
                  <th className="px-4 py-2 text-left">{t.sampleCount}</th>
                  <th className="px-4 py-2 text-left">{t.taskStatus}</th>
                  <th className="px-4 py-2 text-right">{t.taskOperations}</th>
                </tr>
              </thead>
              <tbody>
                {autoEvalTasks.map((task) => (
                  <tr key={task.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{task.name}</td>
                    <td className="px-4 py-2">{task.interval_hours}h</td>
                    <td className="px-4 py-2">{task.sample_count}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${task.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {task.enabled ? t.enabled : t.disabled}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTriggerAutoEvalTask(task.id)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          {t.trigger}
                        </button>
                        <button
                          onClick={() => handleDeleteAutoEvalTask(task.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {autoEvalTasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{t.noAutoEvalTasks}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Experiment Report Modal */}
      {showReportModal && experimentReports[showReportModal] && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">{t.experimentReport}</h3>
              <button onClick={() => setShowReportModal(null)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            {(() => {
              const report = experimentReports[showReportModal];
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.totalCases}</div>
                      <div className="text-lg font-medium">{report.totalItems}</div>
                    </div>
                    <div className="bg-green-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.passedCases}</div>
                      <div className="text-lg font-medium text-green-700">{report.passedCount}</div>
                    </div>
                    <div className="bg-red-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.failedCases}</div>
                      <div className="text-lg font-medium text-red-700">{report.failedCount}</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded">
                      <div className="text-xs text-gray-500">{t.passRate}</div>
                      <div className="text-lg font-medium text-blue-700">{report.passRate}%</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">{t.badCases}</h4>
                    <div className="space-y-2">
                      {report.failedCount === 0 && (
                        <div className="text-sm text-gray-500">{t.noBadCases}</div>
                      )}
                      {(badCases[showReportModal] || []).map((bc) => (
                        <div key={bc.id} className="border rounded p-3 text-sm">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-500 mb-1">{t.inputLabel}</div>
                              <div className="truncate">{bc.input}</div>
                              {bc.expected_output && (
                                <div className="mt-1">
                                  <div className="text-xs text-gray-500">{t.expectedOutput}</div>
                                  <div className="truncate text-green-700">{bc.expected_output}</div>
                                </div>
                              )}
                              <div className="mt-1">
                                <div className="text-xs text-gray-500">{t.actualOutput}</div>
                                <div className="truncate">{bc.output || '-'}</div>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">{t.scoreLabel}: {bc.score}</span>
                                {bc.calibrated_score !== undefined && bc.calibrated_score !== null && (
                                  <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">{t.calibratedAfter}: {bc.calibrated_score}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => { setCalibratingResult(bc.id); setCalibrationForm({ score: bc.calibrated_score ?? bc.score ?? 0, passed: !!(bc.calibrated_passed ?? bc.passed), note: bc.calibration_note || '' }); }}
                              className="text-xs px-2 py-1 border rounded hover:bg-gray-50 ml-2 shrink-0"
                            >
                              {t.calibrate}
                            </button>
                          </div>
                          {calibratingResult === bc.id && (
                            <div className="mt-3 border-t pt-3 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-xs text-gray-500">{t.calibrateScore}</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={calibrationForm.score}
                                    onChange={(e) => setCalibrationForm({ ...calibrationForm, score: Number(e.target.value) })}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-gray-500">{t.calibratePassed}</label>
                                  <input
                                    type="checkbox"
                                    checked={calibrationForm.passed}
                                    onChange={(e) => setCalibrationForm({ ...calibrationForm, passed: e.target.checked })}
                                    className="w-4 h-4"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500">{t.calibrateNote}</label>
                                <input
                                  type="text"
                                  value={calibrationForm.note}
                                  onChange={(e) => setCalibrationForm({ ...calibrationForm, note: e.target.value })}
                                  className="w-full px-2 py-1 border rounded text-sm"
                                  placeholder={t.calibrateReason}
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleCalibrateResult(bc.id)}
                                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  {t.saveCalibrate}
                                </button>
                                <button
                                  onClick={() => setCalibratingResult(null)}
                                  className="text-xs px-3 py-1 border rounded hover:bg-gray-50"
                                >
                                  {t.cancelCalibrate}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {report.calibratedCount > 0 && (
                    <div className="text-sm text-amber-600">
                      {t.calibratedSummary.replace('{count}', String(report.calibratedCount)).replace('{rate}', String(report.calibrationRate))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createAutoEvalTask}</h3>
            <form onSubmit={handleCreateAutoEvalTask}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.taskName}</label>
                  <input
                    type="text"
                    value={taskForm.name}
                    onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectDataset}</label>
                  <select
                    value={taskForm.dataset_id}
                    onChange={(e) => setTaskForm({ ...taskForm, dataset_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  >
                    <option value="">-- {t.selectDataset} --</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectEvaluator}</label>
                  <select
                    value={taskForm.evaluator_id}
                    onChange={(e) => setTaskForm({ ...taskForm, evaluator_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">-- {t.selectEvaluator} --</option>
                    {evaluators.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalHours}</label>
                    <input
                      type="number"
                      value={taskForm.interval_hours}
                      onChange={(e) => setTaskForm({ ...taskForm, interval_hours: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.sampleCount}</label>
                    <input
                      type="number"
                      value={taskForm.sample_count}
                      onChange={(e) => setTaskForm({ ...taskForm, sample_count: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg"
                      min={1}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="task-enabled"
                    type="checkbox"
                    checked={taskForm.enabled}
                    onChange={(e) => setTaskForm({ ...taskForm, enabled: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="task-enabled" className="text-sm text-gray-700">{t.enableTask}</label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowTaskModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancelCreate}
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.createTask}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dataset Modal */}
      {showDatasetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createDataset}</h3>
            <form onSubmit={handleCreateDataset}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.datasetName}</label>
                  <input
                    data-testid="dataset-name-input"
                    type="text"
                    value={datasetForm.name}
                    onChange={(e) => setDatasetForm({ ...datasetForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.datasetDescription}</label>
                  <input
                    data-testid="dataset-desc-input"
                    type="text"
                    value={datasetForm.description}
                    onChange={(e) => setDatasetForm({ ...datasetForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.datasetType}</label>
                  <select
                    data-testid="dataset-type-select"
                    value={datasetForm.type}
                    onChange={(e) => setDatasetForm({ ...datasetForm, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="custom">custom</option>
                    <option value="qa">qa</option>
                    <option value="chat">chat</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="auto-create-evaluators"
                    type="checkbox"
                    checked={datasetForm.auto_create_evaluators}
                    onChange={(e) => setDatasetForm({ ...datasetForm, auto_create_evaluators: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="auto-create-evaluators" className="text-sm text-gray-700">
                    {t.autoCreatePresetEvaluators}
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowDatasetModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="dataset-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Items Modal */}
      {showItemsModal && selectedDataset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-medium mb-4">{t.addItems}</h3>
            <form onSubmit={handleAddItems}>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {itemInputs.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2">
                    <input
                      data-testid={`item-input-${idx}`}
                      type="text"
                      placeholder={t.itemInput}
                      value={item.input}
                      onChange={(e) => {
                        const newItems = [...itemInputs];
                        newItems[idx].input = e.target.value;
                        setItemInputs(newItems);
                      }}
                      className="px-3 py-2 border rounded-lg"
                    />
                    <input
                      data-testid={`item-expected-${idx}`}
                      type="text"
                      placeholder={t.itemExpectedOutput}
                      value={item.expected_output}
                      onChange={(e) => {
                        const newItems = [...itemInputs];
                        newItems[idx].expected_output = e.target.value;
                        setItemInputs(newItems);
                      }}
                      className="px-3 py-2 border rounded-lg"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setItemInputs([...itemInputs, { input: '', expected_output: '' }])}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                + {t.addItems}
              </button>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowItemsModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="items-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evaluator Modal */}
      {showEvaluatorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createEvaluator}</h3>
            <form onSubmit={handleCreateEvaluator}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.evaluatorName}</label>
                  <input
                    data-testid="evaluator-name-input"
                    type="text"
                    value={evaluatorForm.name}
                    onChange={(e) => setEvaluatorForm({ ...evaluatorForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.presetTemplate}</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const tmpl = evaluatorTemplates.find(t => t.id === e.target.value);
                      if (tmpl) {
                        setEvaluatorForm({
                          name: tmpl.name,
                          type: tmpl.type,
                          description: tmpl.description,
                          config: JSON.stringify(tmpl.default_config, null, 2),
                          model_config_id: '',
                        });
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">{t.selectPresetTemplate}</option>
                    {evaluatorTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.evaluatorType}</label>
                  <select
                    data-testid="evaluator-type-select"
                    value={evaluatorForm.type}
                    onChange={(e) => setEvaluatorForm({ ...evaluatorForm, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="exact_match">exact_match</option>
                    <option value="contains">contains</option>
                    <option value="llm_judge">llm_judge</option>
                    <option value="regex">regex</option>
                    <option value="similarity">similarity</option>
                  </select>
                </div>
                {evaluatorForm.type === 'llm_judge' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.judgeModel}</label>
                    <select
                      value={evaluatorForm.model_config_id}
                      onChange={(e) => setEvaluatorForm({ ...evaluatorForm, model_config_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">{t.judgeModelHint}</option>
                      {modelConfigs.map((cfg) => (
                        <option key={cfg.id} value={cfg.id}>{cfg.name} ({cfg.model})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.description}</label>
                  <input
                    type="text"
                    value={evaluatorForm.description}
                    onChange={(e) => setEvaluatorForm({ ...evaluatorForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowEvaluatorModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="evaluator-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Experiment Modal */}
      {showExperimentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createExperiment}</h3>
            <form onSubmit={handleCreateExperiment}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.experimentName}</label>
                  <input
                    data-testid="experiment-name-input"
                    type="text"
                    value={experimentForm.name}
                    onChange={(e) => setExperimentForm({ ...experimentForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectDataset}</label>
                  <select
                    data-testid="experiment-dataset-select"
                    value={experimentForm.dataset_id}
                    onChange={(e) => setExperimentForm({ ...experimentForm, dataset_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  >
                    <option value="">-- {t.selectDataset} --</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.modelConfig}</label>
                  <select
                    value={experimentForm.model_config_id}
                    onChange={(e) => setExperimentForm({ ...experimentForm, model_config_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">-- {t.modelConfig} --</option>
                    {modelConfigs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.description}</label>
                  <input
                    type="text"
                    value={experimentForm.description}
                    onChange={(e) => setExperimentForm({ ...experimentForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowExperimentModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button data-testid="experiment-submit-btn" type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
