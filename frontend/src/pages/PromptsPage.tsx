import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useProjectStore } from '../stores/projectStore';
import { api, Prompt, PromptVersion, PlaygroundRun, ModelConfig, Dataset, Trace, OptimizationSuggestion, EvaluationExperiment } from '../api';
import { useTranslation } from '../App';

type Tab = 'prompts' | 'versions' | 'runs' | 'configs' | 'linkedTraces';

// 去掉 JSON 中的注释（// 和 /* */），支持在 config 输入框中写注释
function stripJsonComments(jsonString: string): string {
  return jsonString
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const DEFAULT_PROMPT_CONFIG = `{
  // 控制输出随机性: 0=确定性输出, 1=完全随机 (默认 0.7)
  "temperature": 0.7,

  // 最大输出 token 数 (默认 2048)
  "max_tokens": 2048,

  // 模型调用超时毫秒数 (默认 30000)
  "timeout_ms": 30000
}`;

export function PromptsPage() {
  const { currentProject, ensureDefaultProject } = useProjectStore();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('prompts');
  const [loading, setLoading] = useState(true);

  // Prompts state
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptForm, setPromptForm] = useState({ name: '', description: '', content: '', config: DEFAULT_PROMPT_CONFIG });
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [autoRegression, setAutoRegression] = useState(false);
  const [regressionDatasetId, setRegressionDatasetId] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);

  // Versions state
  const [versions, setVersions] = useState<PromptVersion[]>([]);

  // Playground state
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [playgroundOutput, setPlaygroundOutput] = useState('');
  const [playgroundModel, setPlaygroundModel] = useState('gpt-4');
  const [running, setRunning] = useState(false);

  // Runs state
  const [runs, setRuns] = useState<PlaygroundRun[]>([]);

  // Model configs state
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configForm, setConfigForm] = useState({ name: '', provider: 'openai', model: '', config: '{}' });

  // Compare state
  const [compareResults, setCompareResults] = useState<PlaygroundRun[]>([]);

  // Linked traces state
  const [linkedTraces, setLinkedTraces] = useState<Trace[]>([]);

  // AI Optimize state
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [optimizeExperiments, setOptimizeExperiments] = useState<EvaluationExperiment[]>([]);
  const [selectedOptimizeExperiment, setSelectedOptimizeExperiment] = useState('');
  const [optimizeModelConfig, setOptimizeModelConfig] = useState('');
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeSuggestion, setOptimizeSuggestion] = useState<OptimizationSuggestion | null>(null);

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

  const fetchRuns = async () => {
    if (!currentProject) return;
    try {
      const res = await api.playground.runs(currentProject.id, selectedPrompt?.id);
      setRuns(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch runs:', e);
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

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchPrompts(), fetchRuns(), fetchModelConfigs()]);
    setLoading(false);
  };

  const fetchLinkedTraces = async (promptId: string) => {
    try {
      const res = await api.prompts.traces(promptId);
      setLinkedTraces(res.traces || []);
    } catch (e) {
      console.error('Failed to fetch linked traces:', e);
    }
  };

  const fetchExperiments = async () => {
    if (!currentProject) return;
    try {
      const res = await api.evaluation.experiments.list(currentProject.id);
      const exps = Array.isArray(res) ? res : [];
      setOptimizeExperiments(exps.filter((e: EvaluationExperiment) => e.status === 'completed'));
    } catch (e) {
      console.error('Failed to fetch experiments:', e);
    }
  };

  const openOptimizeModal = () => {
    fetchExperiments();
    setSelectedOptimizeExperiment('');
    setOptimizeModelConfig('');
    setOptimizeSuggestion(null);
    setShowOptimizeModal(true);
  };

  const handleGenerateOptimization = async () => {
    if (!selectedPrompt || !selectedOptimizeExperiment) return;
    setOptimizeLoading(true);
    try {
      const result = await api.prompts.optimize(selectedPrompt.id, {
        experiment_id: selectedOptimizeExperiment,
        model_config_id: optimizeModelConfig || undefined,
      });
      setOptimizeSuggestion(result);
    } catch (e) {
      console.error('Failed to optimize:', e);
      alert(t.optimizationFailed + ': ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setOptimizeLoading(false);
    }
  };

  const handleApplyOptimization = async () => {
    if (!selectedPrompt || !optimizeSuggestion) return;
    setOptimizeLoading(true);
    try {
      await api.prompts.applyOptimization(selectedPrompt.id, {
        optimized_prompt: optimizeSuggestion.optimized_prompt,
        description: 'AI optimized: ' + optimizeSuggestion.changes.slice(0, 3).join(', '),
      });
      setShowOptimizeModal(false);
      setOptimizeSuggestion(null);
      fetchPrompts();
      if (selectedPrompt) {
        const updated = await api.prompts.list(currentProject!.id);
        const found = (Array.isArray(updated) ? updated : []).find((p: Prompt) => p.id === selectedPrompt.id);
        if (found) setSelectedPrompt(found);
        fetchVersions(selectedPrompt.id);
      }
    } catch (e) {
      console.error('Failed to apply optimization:', e);
      alert('Apply failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setOptimizeLoading(false);
    }
  };

  useEffect(() => {
    if (!currentProject) {
      setLoading(false);
      return;
    }
    fetchAll();
  }, [currentProject?.id]);

  useEffect(() => {
    if (selectedPrompt) {
      fetchVersions(selectedPrompt.id);
      fetchLinkedTraces(selectedPrompt.id);
    }
  }, [selectedPrompt?.id]);

  const handleCreatePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      let cfg = {};
      try { cfg = JSON.parse(stripJsonComments(promptForm.config)); } catch {}
      await api.prompts.create({
        project_id: currentProject.id,
        name: promptForm.name,
        description: promptForm.description,
        content: promptForm.content,
        config: cfg,
      });
      setShowPromptModal(false);
      setPromptForm({ name: '', description: '', content: '', config: DEFAULT_PROMPT_CONFIG });
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
        const parsed = JSON.parse(stripJsonComments(promptForm.config));
        if (Object.keys(parsed).length > 0) cfg = parsed;
      } catch {}

      if (autoRegression && regressionDatasetId) {
        // Use createVersion API with auto_regression
        await api.prompts.createVersion(editingPrompt.id, {
          content: promptForm.content,
          description: promptForm.description,
          config: cfg,
          auto_regression: true,
          regression_dataset_id: regressionDatasetId,
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
      setPromptForm({ name: '', description: '', content: '', config: DEFAULT_PROMPT_CONFIG });
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
      const res = await api.playground.run({
        project_id: currentProject.id,
        prompt_id: selectedPrompt.id,
        model: playgroundModel,
        input: playgroundInput,
        output: playgroundOutput || `Simulated output for: ${playgroundInput}`,
        latency_ms: 800,
        status: 'success',
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
        input: playgroundInput,
        model_config_ids: modelConfigs.map((c) => c.id),
      });
      setCompareResults(res.results);
      fetchRuns();
    } catch (e) {
      console.error('Failed to compare:', e);
      alert('Compare failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setRunning(false);
    }
  };

  const handleCreateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      let cfg = {};
      try { cfg = JSON.parse(configForm.config); } catch {}
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
    const hasConfig = prompt.config && Object.keys(prompt.config).length > 0;
    setPromptForm({
      name: prompt.name,
      description: prompt.description || '',
      content: prompt.content,
      config: hasConfig ? JSON.stringify(prompt.config, null, 2) : DEFAULT_PROMPT_CONFIG,
    });
    fetchDatasets();
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
        {(['prompts', 'versions', 'runs', 'configs', 'linkedTraces'] as Tab[]).map((tab) => (
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
            {tab === 'runs' && t.playground}
            {tab === 'configs' && t.modelConfigs}
            {tab === 'linkedTraces' && t.linkedTraces}
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
                onClick={() => { setEditingPrompt(null); setPromptForm({ name: '', description: '', content: '', config: DEFAULT_PROMPT_CONFIG }); setShowPromptModal(true); }}
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
                      <button onClick={() => startEdit(selectedPrompt)} className="text-xs px-2 py-1 border rounded hover:bg-gray-50">{t.edit}</button>
                      <button onClick={openOptimizeModal} className="text-xs px-2 py-1 border rounded hover:bg-purple-50 text-purple-600">{t.aiOptimize}</button>
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
                        <option value="gpt-4">gpt-4</option>
                        <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                        <option value="claude-3-opus">claude-3-opus</option>
                        {modelConfigs.map((cfg) => (
                          <option key={cfg.id} value={cfg.model}>{cfg.name}</option>
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
                        disabled={running || !playgroundInput.trim()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                      >
                        {running ? t.loading : t.run}
                      </button>
                      {modelConfigs.length > 0 && (
                        <button
                          onClick={handleCompare}
                          disabled={running || !playgroundInput.trim()}
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

      {/* Linked Traces Tab */}
      {activeTab === 'linkedTraces' && (
        <div>
          {selectedPrompt ? (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">{t.linkedTraces} — {selectedPrompt.name}</h2>
              <p className="text-sm text-gray-500">{t.linkedTracesHint}</p>
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">{t.traceName}</th>
                      <th className="px-4 py-2 text-left">{t.traceType}</th>
                      <th className="px-4 py-2 text-left">{t.status}</th>
                      <th className="px-4 py-2 text-left">{t.latency}</th>
                      <th className="px-4 py-2 text-left">{t.startTime}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedTraces.map((trace) => (
                      <tr key={trace.id} className="border-t">
                        <td className="px-4 py-2 font-mono text-xs">{trace.name}</td>
                        <td className="px-4 py-2">
                          <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{trace.trace_type}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${trace.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {trace.status === 'success' ? t.success : t.failed}
                          </span>
                        </td>
                        <td className="px-4 py-2">{trace.latency_ms}ms</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{new Date(trace.started_at).toLocaleString()}</td>
                      </tr>
                    ))}
                    {linkedTraces.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{t.noTraces}</td>
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
                      <div className="mt-2">
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
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => { setShowPromptModal(false); setEditingPrompt(null); setAutoRegression(false); setRegressionDatasetId(''); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
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

      {/* AI Optimize Modal */}
      {showOptimizeModal && selectedPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium mb-2">{t.aiOptimize} — {selectedPrompt.name}</h3>
            <p className="text-sm text-gray-500 mb-4">{t.aiOptimizeHint}</p>

            {!optimizeSuggestion ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectExperiment}</label>
                  <select
                    value={selectedOptimizeExperiment}
                    onChange={(e) => setSelectedOptimizeExperiment(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">-- {t.selectExperiment} --</option>
                    {optimizeExperiments.map((exp) => (
                      <option key={exp.id} value={exp.id}>{exp.name}</option>
                    ))}
                  </select>
                  {optimizeExperiments.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">{t.noCompletedExperiments}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.optimizeModel}</label>
                  <select
                    value={optimizeModelConfig}
                    onChange={(e) => setOptimizeModelConfig(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Default (auto-select)</option>
                    {modelConfigs.map((cfg) => (
                      <option key={cfg.id} value={cfg.id}>{cfg.name} ({cfg.provider}/{cfg.model})</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowOptimizeModal(false)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={handleGenerateOptimization}
                    disabled={optimizeLoading || !selectedOptimizeExperiment}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {optimizeLoading ? t.loading : t.generateOptimization}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">{t.reasoning}</h4>
                  <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">{optimizeSuggestion.reasoning}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">{t.changes}</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                    {optimizeSuggestion.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">{t.originalPrompt}</h4>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg font-mono text-xs bg-gray-50"
                      rows={6}
                      value={optimizeSuggestion.original_prompt}
                      readOnly
                    />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">{t.optimizedPrompt}</h4>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg font-mono text-xs bg-green-50 border-green-200"
                      rows={6}
                      value={optimizeSuggestion.optimized_prompt}
                      readOnly
                    />
                  </div>
                </div>
                {optimizeSuggestion.low_score_samples.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">{t.lowScoreSamples} ({optimizeSuggestion.low_score_samples.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {optimizeSuggestion.low_score_samples.map((sample, i) => (
                        <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-2 text-xs">
                          <div className="font-medium text-red-700">Input: {sample.input}</div>
                          <div className="text-gray-600">Expected: {sample.expected_output}</div>
                          <div className="text-gray-600">Actual: {sample.output}</div>
                          <div className="text-red-600">Score: {sample.score}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setOptimizeSuggestion(null)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    {t.back}
                  </button>
                  <button
                    onClick={handleApplyOptimization}
                    disabled={optimizeLoading}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {optimizeLoading ? t.applyingOptimization : t.applyOptimization}
                  </button>
                </div>
              </div>
            )}
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
                    onChange={(e) => setConfigForm({ ...configForm, provider: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="custom">{t.custom}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.model}</label>
                  <input
                    type="text"
                    value={configForm.model}
                    onChange={(e) => setConfigForm({ ...configForm, model: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                    placeholder={t.modelListExample}
                  />
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
