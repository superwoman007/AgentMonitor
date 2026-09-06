import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useProjectStore } from '../stores/projectStore';
import { api, Prompt, PromptVersion, PlaygroundRun, ModelConfig, Dataset, EvaluationExperiment, Trace, Evaluator, PromptDeployment, PromptAbVariant, PromptAbAnalyticsReport } from '../api';
import { useTranslation } from '../App';
import { MODEL_PROVIDERS, getProviderById } from '../constants/modelProviders';

type Tab = 'prompts' | 'versions' | 'deployments' | 'runs' | 'configs';

const PROMPT_ENVIRONMENTS = ['production', 'staging', 'development'] as const;
type PromptEnvironment = (typeof PROMPT_ENVIRONMENTS)[number];

export function PromptsPage() {
  const { currentProject, ensureDefaultProject } = useProjectStore();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('prompts');
  const [loading, setLoading] = useState(true);

  // Prompts state
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptForm, setPromptForm] = useState({ name: '', description: '', content: '', config: '{}' });
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [autoRegression, setAutoRegression] = useState(false);
  const [regressionDatasetId, setRegressionDatasetId] = useState('');
  const [regressionModelConfigId, setRegressionModelConfigId] = useState('');
  const [regressionEvaluatorId, setRegressionEvaluatorId] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);

  // Versions state
  const [versions, setVersions] = useState<PromptVersion[]>([]);

  // Deployments state (PR-12)
  const [deployments, setDeployments] = useState<PromptDeployment[]>([]);
  const [deployEnv, setDeployEnv] = useState<PromptEnvironment>('production');
  const [deployVersionId, setDeployVersionId] = useState('');
  const [deployNote, setDeployNote] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [runtimeEnv, setRuntimeEnv] = useState<PromptEnvironment>('production');
  const [runtimeBucketKey, setRuntimeBucketKey] = useState('');
  const [runtimeResult, setRuntimeResult] = useState<{ etag?: string; content?: string; version?: number; variantKey?: string | null; bucket?: number | null } | null>(null);

  // A/B 实验变体状态（P1）
  const [abVariants, setAbVariants] = useState<PromptAbVariant[]>([]);
  const [abEnv, setAbEnv] = useState<PromptEnvironment>('production');
  const [abForm, setAbForm] = useState({ variantKey: 'B', versionId: '', weight: 10, note: '' });
  const [abAnalytics, setAbAnalytics] = useState<PromptAbAnalyticsReport | null>(null);
  const [abAnalyticsDays, setAbAnalyticsDays] = useState(14);
  const [abAnalyticsLoading, setAbAnalyticsLoading] = useState(false);

  // Playground state
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [playgroundOutput, setPlaygroundOutput] = useState('');
  const [playgroundModel, setPlaygroundModel] = useState('');
  const [running, setRunning] = useState(false);

  // Runs state
  const [runs, setRuns] = useState<PlaygroundRun[]>([]);

  // Model configs state
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configForm, setConfigForm] = useState({ name: '', provider: 'openai', model: '', config: '{}' });
  const configProvider = getProviderById(configForm.provider);

  // Compare state
  const [compareResults, setCompareResults] = useState<PlaygroundRun[]>([]);

  // Prompt optimization and trace linkage
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [experiments, setExperiments] = useState<EvaluationExperiment[]>([]);
  const [optimizationExperimentId, setOptimizationExperimentId] = useState('');
  const [optimizationModelConfigId, setOptimizationModelConfigId] = useState('');
  const [optimizationResult, setOptimizationResult] = useState<{ optimized_prompt: string; analysis: string; improvements: string[] } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [linkedTraces, setLinkedTraces] = useState<Trace[] | null>(null);

  useEffect(() => {
    ensureDefaultProject();
  }, [ensureDefaultProject]);

  const fetchPrompts = async () => {
    if (!currentProject) return;
    try {
      const res = await api.prompts.list(currentProject.id);
      setPrompts(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch prompts:', e);
    }
  };

  const fetchDatasets = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.datasets.list(currentProject.id);
      setDatasets(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch datasets:', e);
    }
  };

  const fetchVersions = async (promptId: string) => {
    try {
      const res = await api.prompts.versions.list(promptId);
      setVersions(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch versions:', e);
    }
  };

  /**
   * 拉取当前 Prompt 在三个环境下的部署指针。
   */
  const fetchDeployments = async (promptId: string) => {
    if (!currentProject) return;
    try {
      const res = await api.promptDeployments.list(currentProject.id, promptId);
      setDeployments(res.deployments ?? []);
    } catch (e) {
      console.error('Failed to fetch deployments:', e);
      setDeployments([]);
    }
  };

  /**
   * 拉取 A/B 实验变体（按环境）。
   */
  const fetchAbVariants = async (promptId: string, environment: string) => {
    if (!currentProject) return;
    try {
      const res = await api.promptAbVariants.list(promptId, currentProject.id, environment);
      setAbVariants(res.variants ?? []);
    } catch (e) {
      console.error('Failed to fetch A/B variants:', e);
      setAbVariants([]);
    }
  };

  /**
   * 拉取 Prompt A/B 效果分析。
   */
  const fetchAbAnalytics = async (promptId: string, environment: string, days = abAnalyticsDays) => {
    if (!currentProject) return;
    setAbAnalyticsLoading(true);
    try {
      const res = await api.promptAbVariants.analytics(promptId, currentProject.id, environment, days);
      setAbAnalytics(res.report ?? null);
    } catch (e) {
      console.error('Failed to fetch A/B analytics:', e);
      setAbAnalytics(null);
    } finally {
      setAbAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPrompt) {
      fetchVersions(selectedPrompt.id);
      fetchDeployments(selectedPrompt.id);
      fetchAbVariants(selectedPrompt.id, abEnv);
      fetchAbAnalytics(selectedPrompt.id, abEnv);
      setRuntimeResult(null);
    } else {
      setDeployments([]);
      setAbVariants([]);
      setAbAnalytics(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPrompt?.id]);

  useEffect(() => {
    if (selectedPrompt) {
      fetchAbVariants(selectedPrompt.id, abEnv);
      fetchAbAnalytics(selectedPrompt.id, abEnv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abEnv]);

  useEffect(() => {
    if (selectedPrompt) {
      fetchAbAnalytics(selectedPrompt.id, abEnv, abAnalyticsDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abAnalyticsDays]);

  /**
   * 保存 A/B 变体（upsert）。
   */
  const handleSaveAbVariant = async () => {
    if (!currentProject || !selectedPrompt || !abForm.versionId) {
      alert('请选择变体版本');
      return;
    }
    try {
      await api.promptAbVariants.upsert(selectedPrompt.id, abForm.variantKey || 'B', {
        projectId: currentProject.id,
        environment: abEnv,
        promptVersionId: abForm.versionId,
        weight: Number(abForm.weight),
        note: abForm.note || undefined,
      });
      setAbForm({ ...abForm, note: '' });
      await fetchAbVariants(selectedPrompt.id, abEnv);
      await fetchAbAnalytics(selectedPrompt.id, abEnv);
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存变体失败');
    }
  };

  /**
   * 删除 A/B 变体。
   */
  const handleDeleteAbVariant = async (variantKey: string) => {
    if (!currentProject || !selectedPrompt) return;
    if (!confirm(`确认删除变体 ${variantKey}？流量将全部回到基线版本`)) return;
    try {
      await api.promptAbVariants.remove(selectedPrompt.id, variantKey, currentProject.id, abEnv);
      await fetchAbVariants(selectedPrompt.id, abEnv);
      await fetchAbAnalytics(selectedPrompt.id, abEnv);
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除变体失败');
    }
  };

  /**
   * 格式化百分比文本。
   * @param value - 百分比
   * @returns 格式化结果
   */
  const formatPercent = (value: number | null | undefined) => (
    value === null || value === undefined ? '-' : `${value.toFixed(1)}%`
  );

  /**
   * 格式化浮点指标。
   * @param value - 数值
   * @param digits - 保留位数
   * @returns 格式化结果
   */
  const formatMetric = (value: number | null | undefined, digits = 2) => (
    value === null || value === undefined ? '-' : value.toFixed(digits)
  );

  /**
   * 把选中的 PromptVersion 发布到指定环境。
   */
  const handleDeploy = async () => {
    if (!currentProject || !selectedPrompt || !deployVersionId) return;
    setDeploying(true);
    try {
      await api.promptDeployments.deploy(selectedPrompt.id, {
        projectId: currentProject.id,
        promptVersionId: deployVersionId,
        environment: deployEnv,
        note: deployNote || undefined,
      });
      setDeployNote('');
      await fetchDeployments(selectedPrompt.id);
      // 同步刷新 Prompt 主信息（current_version_id 不变，但 updated_at 会刷新）
      const updated = await api.prompts.list(currentProject.id);
      const found = (Array.isArray(updated) ? updated : []).find((p: Prompt) => p.id === selectedPrompt.id);
      if (found) setSelectedPrompt(found);
    } catch (e) {
      alert(e instanceof Error ? e.message : '发布失败');
    } finally {
      setDeploying(false);
    }
  };

  /**
   * 下线某个环境的 Deployment。
   */
  const handleUndeploy = async (environment: string) => {
    if (!currentProject || !selectedPrompt) return;
    if (!confirm(`确认下线 ${selectedPrompt.name} 在 ${environment} 环境的发布？`)) return;
    try {
      await api.promptDeployments.remove(selectedPrompt.id, currentProject.id, environment);
      await fetchDeployments(selectedPrompt.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : '下线失败');
    }
  };

  /**
   * 通过 Runtime API 解析已发布的 Prompt，模拟 SDK 调用。
   */
  const handleResolveRuntime = async () => {
    if (!currentProject || !selectedPrompt) return;
    try {
      const res = await api.promptDeployments.resolve({
        projectId: currentProject.id,
        promptName: selectedPrompt.name,
        environment: runtimeEnv,
        bucketKey: runtimeBucketKey || undefined,
      });
      if (res.data) {
        setRuntimeResult({
          etag: res.etag,
          content: res.data.content,
          version: res.data.versionNumber,
          variantKey: res.data.variantKey ?? null,
          bucket: res.data.bucket ?? null,
        });
      } else {
        setRuntimeResult(null);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Runtime 解析失败');
      setRuntimeResult(null);
    }
  };

  const fetchRuns = async () => {
    if (!currentProject) return;
    try {
      const res = await api.playground.runs(currentProject.id, selectedPrompt?.id);
      setRuns(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch runs:', e);
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

  const fetchModelConfigs = async () => {
    if (!currentProject) return;
    try {
      const res = await api.modelConfigs.list(currentProject.id);
      const configs = Array.isArray(res) ? res : [];
      setModelConfigs(configs);
      if (!playgroundModel && configs.length > 0) {
        setPlaygroundModel(configs[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch model configs:', e);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchPrompts(), fetchRuns(), fetchModelConfigs(), fetchEvaluators()]);
    setLoading(false);
  };

  useEffect(() => {
    if (!currentProject) {
      setLoading(false);
      return;
    }
    fetchAll();
  }, [currentProject?.id]);

  const handleCreatePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      let cfg = {};
      try { cfg = JSON.parse(promptForm.config); } catch { cfg = {}; }
      await api.prompts.create({
        project_id: currentProject.id,
        name: promptForm.name,
        description: promptForm.description,
        content: promptForm.content,
        config: cfg,
      });
      setShowPromptModal(false);
      setPromptForm({ name: '', description: '', content: '', config: '{}' });
      fetchPrompts();
    } catch (e) {
      console.error('Failed to create prompt:', e);
    }
  };

  const handleUpdatePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrompt) return;
    try {
      let cfg = undefined;
      try {
        const parsed = JSON.parse(promptForm.config);
        if (Object.keys(parsed).length > 0) cfg = parsed;
      } catch {
        cfg = undefined;
      }

      if (autoRegression && regressionDatasetId) {
        if (!regressionModelConfigId || !regressionEvaluatorId) {
          alert('请选择回归实验的模型配置和评估器');
          return;
        }
        // Use createVersion API with auto_regression
        await api.prompts.createVersion(editingPrompt.id, {
          content: promptForm.content,
          description: promptForm.description,
          config: cfg,
          auto_regression: true,
          regression_dataset_id: regressionDatasetId,
          regression_model_config_id: regressionModelConfigId,
          regression_evaluator_id: regressionEvaluatorId,
        });
        alert(t.versionSavedWithRegression);
      } else {
        await api.prompts.update(editingPrompt.id, {
          content: promptForm.content,
          description: promptForm.description,
          config: cfg,
        });
      }

      setEditingPrompt(null);
      setAutoRegression(false);
      setRegressionDatasetId('');
      setRegressionModelConfigId('');
      setRegressionEvaluatorId('');
      setPromptForm({ name: '', description: '', content: '', config: '{}' });
      fetchPrompts();
      if (selectedPrompt?.id === editingPrompt.id) {
        const updated = await api.prompts.list(currentProject!.id);
        const found = (Array.isArray(updated) ? updated : []).find((p: Prompt) => p.id === editingPrompt.id);
        if (found) setSelectedPrompt(found);
        fetchVersions(editingPrompt.id);
      }
    } catch (e) {
      console.error('Failed to update prompt:', e);
    }
  };

  const handleDeletePrompt = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.prompts.delete(id);
      if (selectedPrompt?.id === id) setSelectedPrompt(null);
      fetchPrompts();
    } catch (e) {
      console.error('Failed to delete prompt:', e);
    }
  };

  const handleRollback = async (versionId: string) => {
    if (!selectedPrompt) return;
    if (!confirm(t.rollback + '?')) return;
    try {
      await api.prompts.rollback(selectedPrompt.id, versionId);
      fetchVersions(selectedPrompt.id);
      fetchPrompts();
      const updated = await api.prompts.list(currentProject!.id);
      const found = (Array.isArray(updated) ? updated : []).find((p: Prompt) => p.id === selectedPrompt.id);
      if (found) setSelectedPrompt(found);
    } catch (e) {
      console.error('Failed to rollback:', e);
    }
  };

  const handleRun = async () => {
    if (!currentProject || !selectedPrompt) return;
    setRunning(true);
    try {
      const selectedConfig = modelConfigs.find((cfg) => cfg.id === playgroundModel);
      if (!selectedConfig) {
        throw new Error('请选择可用的模型配置');
      }
      const res = await api.playground.run({
        project_id: currentProject.id,
        prompt_id: selectedPrompt.id,
        prompt_version_id: selectedPrompt.current_version_id || undefined,
        model_config_id: selectedConfig.id,
        input: playgroundInput,
      });
      setPlaygroundOutput(res.output || '');
      fetchRuns();
    } catch (e) {
      console.error('Failed to run:', e);
    } finally {
      setRunning(false);
    }
  };

  const handleCompare = async () => {
    if (!currentProject || !selectedPrompt || modelConfigs.length === 0) return;
    setRunning(true);
    try {
      const res = await api.playground.compare({
        project_id: currentProject.id,
        prompt_id: selectedPrompt.id,
        prompt_version_id: selectedPrompt.current_version_id || undefined,
        input: playgroundInput,
        model_config_ids: modelConfigs.map((cfg) => cfg.id),
      });
      setCompareResults(res.results);
      fetchRuns();
    } catch (e) {
      console.error('Failed to compare:', e);
    } finally {
      setRunning(false);
    }
  };

  const handleCreateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      let cfg = {};
      try { cfg = JSON.parse(configForm.config); } catch { cfg = {}; }
      await api.modelConfigs.create({
        project_id: currentProject.id,
        name: configForm.name,
        provider: configForm.provider,
        model: configForm.model,
        config: cfg,
      });
      setShowConfigModal(false);
      setConfigForm({ name: '', provider: 'openai', model: '', config: '{}' });
      fetchModelConfigs();
    } catch (e) {
      console.error('Failed to create config:', e);
    }
  };

  const handleDeleteConfig = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.modelConfigs.delete(id);
      fetchModelConfigs();
    } catch (e) {
      console.error('Failed to delete config:', e);
    }
  };

  const startEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setPromptForm({
      name: prompt.name,
      description: prompt.description || '',
      content: prompt.content,
      config: JSON.stringify(prompt.config || {}, null, 2),
    });
    fetchDatasets();
  };

  const openOptimizeModal = async () => {
    if (!currentProject || !selectedPrompt) return;
    setShowOptimizeModal(true);
    setOptimizationResult(null);
    try {
      const [experimentList, configList] = await Promise.all([
        api.evaluation.experiments.list(currentProject.id),
        api.modelConfigs.list(currentProject.id),
      ]);
      setExperiments(Array.isArray(experimentList) ? experimentList : []);
      setModelConfigs(Array.isArray(configList) ? configList : []);
    } catch (e) {
      console.error('Failed to load optimization options:', e);
    }
  };

  const handleOptimize = async () => {
    if (!selectedPrompt || !optimizationExperimentId) return;
    setOptimizing(true);
    try {
      const result = await api.prompts.optimize(selectedPrompt.id, {
        experiment_id: optimizationExperimentId,
        model_config_id: optimizationModelConfigId || undefined,
      });
      setOptimizationResult(result);
    } catch (e) {
      console.error('Failed to optimize prompt:', e);
    } finally {
      setOptimizing(false);
    }
  };

  const handleApplyOptimization = async () => {
    if (!selectedPrompt || !optimizationResult) return;
    try {
      await api.prompts.applyOptimization(selectedPrompt.id, {
        optimized_prompt: optimizationResult.optimized_prompt,
        description: optimizationResult.analysis,
      });
      setShowOptimizeModal(false);
      await fetchPrompts();
      await fetchVersions(selectedPrompt.id);
    } catch (e) {
      console.error('Failed to apply optimization:', e);
    }
  };

  const handleLoadLinkedTraces = async () => {
    if (!selectedPrompt) return;
    try {
      const result = await api.prompts.linkedTraces(selectedPrompt.id);
      setLinkedTraces(result.traces);
    } catch (e) {
      console.error('Failed to load linked traces:', e);
      setLinkedTraces([]);
    }
  };

  const getConfigString = (cfg: Record<string, unknown> | null) => {
    if (!cfg) return '{}';
    return JSON.stringify(cfg, null, 2);
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
        <h1 className="text-2xl font-bold text-gray-900">{t.promptEngineering}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        {(['prompts', 'versions', 'deployments', 'runs', 'configs'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'prompts' && t.prompts}
            {tab === 'versions' && t.versions}
            {tab === 'deployments' && '部署'}
            {tab === 'runs' && t.playground}
            {tab === 'configs' && t.modelConfigs}
          </button>
        ))}
      </div>

      {/* Prompts Tab */}
      {activeTab === 'prompts' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Prompt List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-medium">{t.prompts}</h2>
              <button
                onClick={() => { setEditingPrompt(null); setPromptForm({ name: '', description: '', content: '', config: '{}' }); setShowPromptModal(true); }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                {t.createPrompt}
              </button>
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  onClick={() => setSelectedPrompt(prompt)}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedPrompt?.id === prompt.id ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-sm">{prompt.name}</div>
                  <div className="text-xs text-gray-500 line-clamp-1">{prompt.description}</div>
                </div>
              ))}
              {prompts.length === 0 && (
                <div className="text-center text-gray-500 py-8 border rounded-lg">{t.noPrompts}</div>
              )}
            </div>
          </div>

          {/* Playground */}
          <div className="lg:col-span-2 space-y-4">
            {selectedPrompt ? (
              <>
                <div className="bg-white border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">{selectedPrompt.name}</h3>
                    <div className="flex gap-2">
                      <button onClick={openOptimizeModal} className="text-xs px-2 py-1 border border-purple-300 text-purple-700 rounded hover:bg-purple-50">{t.aiOptimize}</button>
                      <button onClick={handleLoadLinkedTraces} className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50">{t.linkedTraces}</button>
                      <button onClick={() => startEdit(selectedPrompt)} className="text-xs px-2 py-1 border rounded hover:bg-gray-50">{t.edit}</button>
                      <button onClick={() => handleDeletePrompt(selectedPrompt.id)} className="text-xs px-2 py-1 border text-red-600 rounded hover:bg-red-50">{t.delete}</button>
                    </div>
                  </div>
                  <textarea
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm bg-gray-50"
                    rows={6}
                    value={selectedPrompt.content}
                    readOnly
                  />
                  {selectedPrompt.config && (
                    <pre className="mt-2 text-xs text-gray-500 bg-gray-100 p-2 rounded">{getConfigString(selectedPrompt.config)}</pre>
                  )}
                  {linkedTraces && (
                    <div className="mt-4 border-t pt-3 space-y-2">
                      <h4 className="text-sm font-medium">{t.linkedTraces}</h4>
                      {linkedTraces.length === 0 ? (
                        <p className="text-sm text-gray-500">{t.noLinkedTraces}</p>
                      ) : linkedTraces.map((trace) => (
                        <a key={trace.id} href={`/traces/${trace.id}`} className="block text-sm text-blue-600 hover:underline">
                          {trace.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-medium mb-3">{t.playground}</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">{t.model}</label>
                      <select
                        value={playgroundModel}
                        onChange={(e) => setPlaygroundModel(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      >
                        <option value="">-- {t.model} --</option>
                        {modelConfigs.map((cfg) => (
                          <option key={cfg.id} value={cfg.id}>{cfg.name} ({cfg.model})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">{t.input}</label>
                      <textarea
                        value={playgroundInput}
                        onChange={(e) => setPlaygroundInput(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        rows={3}
                        placeholder={t.playgroundInputPlaceholder}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleRun}
                        disabled={running || !playgroundInput.trim() || !playgroundModel}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                      >
                        {running ? t.loading : t.run}
                      </button>
                      {modelConfigs.length > 0 && (
                        <button
                          onClick={handleCompare}
                          disabled={running || !playgroundInput.trim() || modelConfigs.length < 2}
                          className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
                        >
                          {t.compare}
                        </button>
                      )}
                    </div>
                    {playgroundOutput && (
                      <div className="bg-gray-50 border rounded-lg p-3">
                        <div className="text-xs font-medium text-gray-700 mb-1">{t.output}</div>
                        <div className="text-sm whitespace-pre-wrap">{playgroundOutput}</div>
                      </div>
                    )}
                    {compareResults.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-gray-700">{t.compareModels}</div>
                        {compareResults.map((res) => (
                          <div key={res.id} className="bg-gray-50 border rounded-lg p-3">
                            <div className="text-xs text-blue-700 font-medium">{res.model} · {res.latency_ms}ms</div>
                            <div className="text-sm whitespace-pre-wrap mt-1">{res.output}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500 border rounded-lg bg-white">
                {t.noPrompts}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Versions Tab */}
      {activeTab === 'versions' && (
        <div>
          {selectedPrompt ? (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">{t.versions} — {selectedPrompt.name}</h2>
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">{t.versionNumber}</th>
                      <th className="px-4 py-2 text-left">{t.description}</th>
                      <th className="px-4 py-2 text-left">{t.promptContent}</th>
                      <th className="px-4 py-2 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id} className="border-t">
                        <td className="px-4 py-2 font-medium">v{v.version_number}</td>
                        <td className="px-4 py-2 text-gray-500">{v.description || '-'}</td>
                        <td className="px-4 py-2">
                          <div className="max-w-xs truncate font-mono text-xs">{v.content}</div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleRollback(v.id)}
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                          >
                            {t.rollback}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {versions.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">{t.noData}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-12">{t.pleaseSelectProject}</div>
          )}
        </div>
      )}

      {/* Deployments Tab (PR-12) */}
      {activeTab === 'deployments' && (
        <div>
          {!selectedPrompt ? (
            <div className="text-center text-gray-500 py-12 bg-white border rounded-lg">
              请先在 Prompts 列表中选择一个 Prompt
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">
                  部署 — {selectedPrompt.name}
                </h2>
                <div className="text-xs text-gray-500">
                  发布只移动环境指针，不修改 PromptVersion 内容
                </div>
              </div>

              {/* 当前环境指针 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {PROMPT_ENVIRONMENTS.map((env) => {
                  const dep = deployments.find((d) => d.environment === env);
                  const tone =
                    env === 'production'
                      ? 'border-green-200 bg-green-50'
                      : env === 'staging'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-gray-50';
                  const version = dep
                    ? versions.find((v) => v.id === dep.prompt_version_id)
                    : undefined;
                  return (
                    <div key={env} className={`border rounded-lg p-4 ${tone}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium capitalize">{env}</h3>
                        {dep ? (
                          <button
                            onClick={() => handleUndeploy(env)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            下线
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">未发布</span>
                        )}
                      </div>
                      {dep ? (
                        <div className="text-sm space-y-1">
                          <div>
                            <span className="text-gray-500">版本：</span>
                            <span className="font-mono">
                              v{version?.version_number ?? '?'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 font-mono break-all">
                            {dep.prompt_version_id.slice(0, 8)}
                          </div>
                          {dep.note && (
                            <div className="text-xs text-gray-600 mt-1">📝 {dep.note}</div>
                          )}
                          <div className="text-xs text-gray-400 mt-1">
                            更新于 {new Date(dep.updated_at).toLocaleString()}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">—</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 发布表单 */}
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-medium mb-3">发布新版本到环境</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      目标环境
                    </label>
                    <select
                      value={deployEnv}
                      onChange={(e) => setDeployEnv(e.target.value as PromptEnvironment)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                      {PROMPT_ENVIRONMENTS.map((env) => (
                        <option key={env} value={env}>
                          {env}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Prompt Version
                    </label>
                    <select
                      value={deployVersionId}
                      onChange={(e) => setDeployVersionId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                      <option value="">-- 选择版本 --</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version_number} · {v.description || '(无描述)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      备注（可选）
                    </label>
                    <input
                      type="text"
                      value={deployNote}
                      onChange={(e) => setDeployNote(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder="发布说明"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleDeploy}
                    disabled={deploying || !deployVersionId}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                  >
                    {deploying ? '发布中...' : '发布'}
                  </button>
                </div>
              </div>

              {/* A/B 实验分流（P1） */}
              <div className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">A/B 实验分流</h3>
                  <select
                    value={abEnv}
                    onChange={(e) => setAbEnv(e.target.value as PromptEnvironment)}
                    className="px-2 py-1 border rounded text-xs"
                  >
                    {PROMPT_ENVIRONMENTS.map((env) => (
                      <option key={env} value={env}>{env}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  基线版本为上方环境指针；配置变体后，Runtime 按调用方传入的 <code>bucketKey</code>（用户/会话 ID）确定性分桶，同一会话永远命中同一变体。权重单位为百分点，所有变体权重之和建议 ≤ 剩余流量。
                </p>
                {abVariants.length > 0 && (
                  <table className="w-full text-xs mb-3">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left">变体</th>
                        <th className="px-2 py-1 text-left">版本</th>
                        <th className="px-2 py-1 text-left">权重</th>
                        <th className="px-2 py-1 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abVariants.map((v) => {
                        const ver = versions.find((x) => x.id === v.prompt_version_id);
                        return (
                          <tr key={v.id} className="border-t">
                            <td className="px-2 py-1 font-mono font-medium">{v.variant_key}</td>
                            <td className="px-2 py-1 font-mono">v{ver?.version_number ?? '?'} · {v.prompt_version_id.slice(0, 8)}</td>
                            <td className="px-2 py-1">{v.weight}%</td>
                            <td className="px-2 py-1 text-right">
                              <button onClick={() => handleDeleteAbVariant(v.variant_key)} className="text-red-600 hover:underline">
                                删除
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">变体 Key</label>
                    <input
                      value={abForm.variantKey}
                      onChange={(e) => setAbForm({ ...abForm, variantKey: e.target.value })}
                      className="w-full px-2 py-1.5 border rounded text-sm"
                      placeholder="B / canary"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-700 mb-1">变体版本</label>
                    <select
                      value={abForm.versionId}
                      onChange={(e) => setAbForm({ ...abForm, versionId: e.target.value })}
                      className="w-full px-2 py-1.5 border rounded text-sm"
                    >
                      <option value="">-- 选择版本 --</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>v{v.version_number} · {v.description || ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">权重 %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={abForm.weight}
                      onChange={(e) => setAbForm({ ...abForm, weight: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 border rounded text-sm"
                    />
                  </div>
                  <button
                    onClick={handleSaveAbVariant}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm"
                  >
                    保存变体
                  </button>
                </div>
              </div>

              {/* A/B 效果分析 */}
              <div className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="font-medium">A/B 效果分析</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      基于真实 Trace 聚合最近窗口内的流量、成功率、平均延迟与评测结果。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={abAnalyticsDays}
                      onChange={(e) => setAbAnalyticsDays(Number(e.target.value))}
                      className="px-2 py-1 border rounded text-xs"
                    >
                      <option value={7}>最近 7 天</option>
                      <option value={14}>最近 14 天</option>
                      <option value={30}>最近 30 天</option>
                    </select>
                    <button
                      onClick={() => selectedPrompt && fetchAbAnalytics(selectedPrompt.id, abEnv, abAnalyticsDays)}
                      className="px-3 py-1.5 border rounded text-xs hover:bg-gray-50"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                {abAnalyticsLoading ? (
                  <div className="text-xs text-gray-500">分析中...</div>
                ) : abAnalytics ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="border rounded-lg p-3 bg-gray-50">
                        <div className="text-xs text-gray-500">总样本</div>
                        <div className="text-xl font-semibold mt-1">{abAnalytics.totalSamples}</div>
                      </div>
                      <div className="border rounded-lg p-3 bg-gray-50">
                        <div className="text-xs text-gray-500">分析环境</div>
                        <div className="text-xl font-semibold mt-1">{abAnalytics.environment}</div>
                      </div>
                      <div className="border rounded-lg p-3 bg-gray-50">
                        <div className="text-xs text-gray-500">窗口</div>
                        <div className="text-xl font-semibold mt-1">{abAnalytics.days} 天</div>
                      </div>
                      <div className="border rounded-lg p-3 bg-gray-50">
                        <div className="text-xs text-gray-500">生成时间</div>
                        <div className="text-sm font-medium mt-1">{new Date(abAnalytics.generatedAt).toLocaleString('zh-CN')}</div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-2 text-left">流量臂</th>
                            <th className="px-2 py-2 text-left">版本</th>
                            <th className="px-2 py-2 text-left">配置权重</th>
                            <th className="px-2 py-2 text-left">样本量</th>
                            <th className="px-2 py-2 text-left">流量占比</th>
                            <th className="px-2 py-2 text-left">成功率</th>
                            <th className="px-2 py-2 text-left">平均延迟</th>
                            <th className="px-2 py-2 text-left">评测通过率</th>
                            <th className="px-2 py-2 text-left">平均分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {abAnalytics.variants.map((item) => (
                            <tr key={item.promptVersionId} className="border-t">
                              <td className="px-2 py-2">
                                {item.variantKey ? (
                                  <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-mono">{item.variantKey}</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-700">baseline</span>
                                )}
                              </td>
                              <td className="px-2 py-2 font-mono">v{item.versionNumber ?? '?'} · {item.promptVersionId.slice(0, 8)}</td>
                              <td className="px-2 py-2">{item.configuredWeight === null ? '剩余流量' : `${item.configuredWeight}%`}</td>
                              <td className="px-2 py-2">{item.sampleCount}</td>
                              <td className="px-2 py-2">{formatPercent(item.trafficShare)}</td>
                              <td className="px-2 py-2">{formatPercent(item.successRate)}</td>
                              <td className="px-2 py-2">{item.avgLatencyMs === null ? '-' : `${formatMetric(item.avgLatencyMs, 1)} ms`}</td>
                              <td className="px-2 py-2">{formatPercent(item.evalPassRate)}</td>
                              <td className="px-2 py-2">{formatMetric(item.avgEvalScore, 3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-2">每日趋势</h4>
                      <div className="overflow-x-auto max-h-64 border rounded-lg">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-2 py-2 text-left">日期</th>
                              <th className="px-2 py-2 text-left">流量臂</th>
                              <th className="px-2 py-2 text-left">样本量</th>
                              <th className="px-2 py-2 text-left">成功率</th>
                              <th className="px-2 py-2 text-left">平均延迟</th>
                              <th className="px-2 py-2 text-left">评测通过率</th>
                              <th className="px-2 py-2 text-left">平均分</th>
                            </tr>
                          </thead>
                          <tbody>
                            {abAnalytics.timeline.map((item, index) => (
                              <tr key={`${item.day}-${item.variantKey ?? 'baseline'}-${index}`} className="border-t">
                                <td className="px-2 py-2">{item.day}</td>
                                <td className="px-2 py-2 font-mono">{item.variantKey ?? 'baseline'}</td>
                                <td className="px-2 py-2">{item.sampleCount}</td>
                                <td className="px-2 py-2">{formatPercent(item.successRate)}</td>
                                <td className="px-2 py-2">{item.avgLatencyMs === null ? '-' : `${formatMetric(item.avgLatencyMs, 1)} ms`}</td>
                                <td className="px-2 py-2">{formatPercent(item.evalPassRate)}</td>
                                <td className="px-2 py-2">{formatMetric(item.avgEvalScore, 3)}</td>
                              </tr>
                            ))}
                            {abAnalytics.timeline.length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-2 py-6 text-center text-gray-400">
                                  当前窗口内暂无真实 Trace 数据，先通过 SDK/线上流量采集后再查看效果分析。
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">
                    当前环境尚未发布或暂无可分析数据。
                  </div>
                )}
              </div>

              {/* Runtime 解析测试 */}
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-medium mb-3">Runtime API 测试（模拟 SDK 调用）</h3>
                <div className="flex items-end gap-3 mb-3 flex-wrap">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      环境
                    </label>
                    <select
                      value={runtimeEnv}
                      onChange={(e) => setRuntimeEnv(e.target.value as PromptEnvironment)}
                      className="px-3 py-2 border rounded-lg text-sm"
                    >
                      {PROMPT_ENVIRONMENTS.map((env) => (
                        <option key={env} value={env}>
                          {env}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      bucketKey（用户/会话 ID，测试 A/B）
                    </label>
                    <input
                      value={runtimeBucketKey}
                      onChange={(e) => setRuntimeBucketKey(e.target.value)}
                      className="px-3 py-2 border rounded-lg text-sm"
                      placeholder="如 user-42"
                    />
                  </div>
                  <button
                    onClick={handleResolveRuntime}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                  >
                    GET /runtime/prompts/{selectedPrompt.name}
                  </button>
                </div>
                {runtimeResult ? (
                  <div className="bg-gray-50 border rounded p-3 text-xs space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div>
                        <span className="text-gray-500">version: </span>
                        <span className="font-mono">v{runtimeResult.version}</span>
                      </div>
                      {runtimeResult.variantKey ? (
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-mono">
                          命中变体 {runtimeResult.variantKey}（桶 {runtimeResult.bucket}）
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded">
                          基线版本{runtimeResult.bucket !== null ? `（桶 ${runtimeResult.bucket}）` : ''}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">etag: </span>
                      <span className="font-mono break-all">{runtimeResult.etag}</span>
                    </div>
                    <pre className="whitespace-pre-wrap bg-white p-2 rounded border">
                      {runtimeResult.content}
                    </pre>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">
                    点击上方按钮调用 Runtime API 验证当前环境指针是否生效
                  </div>
                )}
                <details className="mt-3 text-xs text-gray-600">
                  <summary className="cursor-pointer">curl 示例</summary>
                  <pre className="mt-2 bg-gray-900 text-green-300 p-3 rounded overflow-x-auto">
{`curl -H "Authorization: Bearer $TOKEN" \\
  -H "X-Project-Id: ${currentProject?.id ?? '<projectId>'}" \\
  "${window.location.origin}/api/v2/runtime/prompts/${encodeURIComponent(
                    selectedPrompt.name
                  )}?environment=${runtimeEnv}"`}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Runs Tab */}
      {activeTab === 'runs' && (
        <div>
          <h2 className="text-lg font-medium mb-4">{t.playground}</h2>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">{t.model}</th>
                  <th className="px-4 py-2 text-left">{t.input}</th>
                  <th className="px-4 py-2 text-left">{t.output}</th>
                  <th className="px-4 py-2 text-left">{t.latency}</th>
                  <th className="px-4 py-2 text-left">{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t">
                    <td className="px-4 py-2 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded inline-block">{run.model}</td>
                    <td className="px-4 py-2 max-w-xs truncate">{run.input}</td>
                    <td className="px-4 py-2 max-w-xs truncate">{run.output || '-'}</td>
                    <td className="px-4 py-2">{run.latency_ms}ms</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${run.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{t.noRuns}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model Configs Tab */}
      {activeTab === 'configs' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">{t.modelConfigs}</h2>
            <button
              onClick={() => setShowConfigModal(true)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              {t.createModelConfig}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modelConfigs.map((cfg) => (
              <div key={cfg.id} className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{cfg.name}</h3>
                  <button onClick={() => handleDeleteConfig(cfg.id)} className="text-xs text-red-600 hover:underline">{t.delete}</button>
                </div>
                <div className="text-xs text-gray-500">
                  <span className="inline-block px-2 py-0.5 bg-gray-100 rounded mr-2">{cfg.provider}</span>
                  <span>{cfg.model}</span>
                </div>
                {cfg.config && (
                  <pre className="mt-2 text-xs text-gray-400 bg-gray-50 p-2 rounded">{getConfigString(cfg.config)}</pre>
                )}
              </div>
            ))}
            {modelConfigs.length === 0 && (
              <div className="col-span-full text-center text-gray-500 py-12 border rounded-lg bg-white">{t.noModelConfigs}</div>
            )}
          </div>
        </div>
      )}

      {/* Prompt Modal */}
      {(showPromptModal || editingPrompt) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-medium mb-4">{editingPrompt ? t.edit : t.createPrompt}</h3>
            <form onSubmit={editingPrompt ? handleUpdatePrompt : handleCreatePrompt}>
              <div className="space-y-4">
                {!editingPrompt && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.promptName}</label>
                    <input
                      type="text"
                      value={promptForm.name}
                      onChange={(e) => setPromptForm({ ...promptForm, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.promptDescription}</label>
                  <input
                    type="text"
                    value={promptForm.description}
                    onChange={(e) => setPromptForm({ ...promptForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.promptContent}</label>
                  <textarea
                    value={promptForm.content}
                    onChange={(e) => setPromptForm({ ...promptForm, content: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
                    rows={6}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.promptConfig} (JSON)</label>
                  <textarea
                    value={promptForm.config}
                    onChange={(e) => setPromptForm({ ...promptForm, config: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-xs"
                    rows={3}
                  />
                </div>
                {editingPrompt && (
                  <div className="border-t pt-4 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoRegression}
                        onChange={(e) => setAutoRegression(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-sm font-medium text-gray-700">{t.autoRegression}</span>
                    </label>
                    {autoRegression && (
                      <div className="mt-2 space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectDataset}</label>
                          <select
                            data-testid="regression-dataset-select"
                            value={regressionDatasetId}
                            onChange={(e) => setRegressionDatasetId(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg"
                            required={autoRegression}
                          >
                            <option value="">-- {t.selectDataset} --</option>
                            {datasets.map((ds) => (
                              <option key={ds.id} value={ds.id}>{ds.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectModelConfig}</label>
                          <select
                            value={regressionModelConfigId}
                            onChange={(e) => setRegressionModelConfigId(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg"
                            required={autoRegression}
                          >
                            <option value="">-- {t.selectModelConfig} --</option>
                            {modelConfigs.map((cfg) => (
                              <option key={cfg.id} value={cfg.id}>{cfg.name} ({cfg.model})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectEvaluator}</label>
                          <select
                            value={regressionEvaluatorId}
                            onChange={(e) => setRegressionEvaluatorId(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg"
                            required={autoRegression}
                          >
                            <option value="">-- {t.selectEvaluator} --</option>
                            {evaluators.map((evaluator) => (
                              <option key={evaluator.id} value={evaluator.id}>{evaluator.name} ({evaluator.type})</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => { setShowPromptModal(false); setEditingPrompt(null); setAutoRegression(false); setRegressionDatasetId(''); setRegressionModelConfigId(''); setRegressionEvaluatorId(''); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showOptimizeModal && selectedPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium mb-4">{t.aiOptimize}: {selectedPrompt.name}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectExperiment}</label>
                <select value={optimizationExperimentId} onChange={(e) => setOptimizationExperimentId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">-- {t.selectExperiment} --</option>
                  {experiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectModelConfig}</label>
                <select value={optimizationModelConfigId} onChange={(e) => setOptimizationModelConfigId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">-- {t.selectModelConfig} --</option>
                  {modelConfigs.map((modelConfig) => <option key={modelConfig.id} value={modelConfig.id}>{modelConfig.name}</option>)}
                </select>
              </div>
              {optimizationResult && (
                <div className="space-y-3 border rounded-lg p-4 bg-purple-50">
                  <h4 className="font-medium">{t.optimizationResult}</h4>
                  <p className="text-sm text-gray-700">{optimizationResult.analysis}</p>
                  <textarea readOnly rows={8} value={optimizationResult.optimized_prompt} className="w-full px-3 py-2 border rounded-lg font-mono text-sm bg-white" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowOptimizeModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">{t.cancel}</button>
              {optimizationResult ? (
                <button type="button" onClick={handleApplyOptimization} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">{t.applyOptimization}</button>
              ) : (
                <button type="button" disabled={!optimizationExperimentId || optimizing} onClick={handleOptimize} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">{optimizing ? t.loading : t.generateOptimization}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium mb-4">{t.createModelConfig}</h3>
            <form onSubmit={handleCreateConfig}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.modelName}</label>
                  <input
                    type="text"
                    value={configForm.name}
                    onChange={(e) => setConfigForm({ ...configForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.provider}</label>
                  <select
                    value={configForm.provider}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const p = getProviderById(pid);
                      setConfigForm({
                        ...configForm,
                        provider: pid,
                        model: p?.models[0]?.id || '',
                      });
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {MODEL_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.model}</label>
                  {configProvider && configProvider.models.length > 0 ? (
                    <select
                      value={configForm.model}
                      onChange={(e) => setConfigForm({ ...configForm, model: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      required
                    >
                      {configProvider.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={configForm.model}
                      onChange={(e) => setConfigForm({ ...configForm, model: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      required
                      placeholder={t.modelListExample}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.promptConfig} (JSON)</label>
                  <textarea
                    value={configForm.config}
                    onChange={(e) => setConfigForm({ ...configForm, config: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-xs"
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowConfigModal(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                  {t.cancel}
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
