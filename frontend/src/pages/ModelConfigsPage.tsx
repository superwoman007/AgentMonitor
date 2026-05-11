import { useEffect, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { useTranslation } from '../App';
import { api, ModelConfig } from '../api';
import { useProjectStore } from '../stores/projectStore';

const PRESET_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  doubao: ['doubao-pro-128k', 'doubao-lite-128k'],
  xiaomi: ['mimo-v2.5-pro', 'mimo-v2.5-preview'],
  custom: [],
};

export function ModelConfigsPage() {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ModelConfig | null>(null);
  const [testingConfigId, setTestingConfigId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latency_ms: number; error?: string }>>({});
  const [form, setForm] = useState({
    name: '',
    provider: 'openai',
    model: '',
    api_key: '',
    base_url: '',
    temperature: '',
    max_tokens: '',
  });

  const fetchConfigs = useCallback(async () => {
    if (!currentProject) {
      setLoading(false);
      setConfigs([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.modelConfigs.list(currentProject.id);
      setConfigs(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch model configs:', e);
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const resetForm = () => {
    setForm({ name: '', provider: 'openai', model: '', api_key: '', base_url: '', temperature: '', max_tokens: '' });
    setEditingConfig(null);
  };

  const openCreateModal = () => {
    resetForm();
    const presets = PRESET_MODELS['openai'];
    setForm(prev => ({ ...prev, provider: 'openai', model: presets[0] || '' }));
    setShowModal(true);
  };

  const openEditModal = (cfg: ModelConfig) => {
    setEditingConfig(cfg);
    setForm({
      name: cfg.name,
      provider: cfg.provider,
      model: cfg.model,
      api_key: '',
      base_url: cfg.base_url || '',
      temperature: cfg.config?.temperature?.toString() || '',
      max_tokens: cfg.config?.max_tokens?.toString() || '',
    });
    setShowModal(true);
  };

  const PROVIDER_BASE_URLS: Record<string, string> = {
    openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com',
    deepseek: 'https://api.deepseek.com',
    doubao: 'https://ark.cn-beijing.volces.com',
    xiaomi: 'https://api.xiaomimimo.com',
  };

  const handleProviderChange = (provider: string) => {
    const presets = PRESET_MODELS[provider] || [];
    setForm(prev => ({
      ...prev,
      provider,
      model: presets.length > 0 && !presets.includes(prev.model) ? presets[0] : prev.model,
      base_url: PROVIDER_BASE_URLS[provider] || prev.base_url,
    }));
  };

  const buildConfig = () => {
    const cfg: Record<string, unknown> = {};
    if (form.temperature) cfg.temperature = parseFloat(form.temperature);
    if (form.max_tokens) cfg.max_tokens = parseInt(form.max_tokens, 10);
    return Object.keys(cfg).length > 0 ? cfg : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      const payload = {
        project_id: currentProject.id,
        name: form.name,
        provider: form.provider,
        model: form.model,
        api_key: form.api_key || undefined,
        base_url: form.base_url || undefined,
        config: buildConfig(),
      };

      if (editingConfig) {
        await api.modelConfigs.update(editingConfig.id, payload);
      } else {
        await api.modelConfigs.create(payload);
      }
      setShowModal(false);
      resetForm();
      fetchConfigs();
    } catch (e) {
      console.error('Failed to save model config:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await api.modelConfigs.delete(id);
      fetchConfigs();
    } catch (e) {
      console.error('Failed to delete model config:', e);
    }
  };

  const handleTest = async (id: string) => {
    setTestingConfigId(id);
    try {
      const result = await api.modelConfigs.test(id);
      setTestResults(prev => ({ ...prev, [id]: result }));
    } catch (e) {
      setTestResults(prev => ({ ...prev, [id]: { success: false, latency_ms: 0, error: 'Request failed' } }));
    } finally {
      setTestingConfigId(null);
    }
  };

  const getConfigString = (cfg: Record<string, unknown> | null) => {
    if (!cfg) return '';
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

  const presets = PRESET_MODELS[form.provider] || [];
  const isCustomModel = form.model && !presets.includes(form.model) && presets.length > 0;

  return (
    <Layout>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.modelConfigPage}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.modelConfigPage}</p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          {t.createModelConfig}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {configs.map((cfg) => (
          <div key={cfg.id} className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900">{cfg.name}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTest(cfg.id)}
                  disabled={testingConfigId === cfg.id}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  {testingConfigId === cfg.id ? t.testing : t.testConnection}
                </button>
                <button
                  onClick={() => openEditModal(cfg)}
                  className="text-xs text-gray-600 hover:underline"
                >
                  {t.edit}
                </button>
                <button
                  onClick={() => handleDelete(cfg.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  {t.delete}
                </button>
              </div>
            </div>
            <div className="space-y-1 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 bg-gray-100 rounded">{cfg.provider}</span>
                <span>{cfg.model}</span>
              </div>
              {cfg.base_url && (
                <div className="text-gray-400 truncate" title={cfg.base_url}>
                  {cfg.base_url}
                </div>
              )}
              {cfg.api_key && (
                <div className="text-gray-400">
                  API Key: {cfg.api_key.slice(0, 4)}...{cfg.api_key.slice(-4)}
                </div>
              )}
            </div>
            {testResults[cfg.id] && (
              <div className={`mt-2 p-2 rounded text-xs ${testResults[cfg.id].success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testResults[cfg.id].success
                  ? `✅ ${t.connectionSuccess} (${testResults[cfg.id].latency_ms}ms)`
                  : `❌ ${t.connectionFailed}: ${testResults[cfg.id].error}`}
              </div>
            )}
            {cfg.config && Object.keys(cfg.config).length > 0 && (
              <pre className="mt-2 text-xs text-gray-400 bg-gray-50 p-2 rounded overflow-auto max-h-24">
                {getConfigString(cfg.config)}
              </pre>
            )}
          </div>
        ))}
        {configs.length === 0 && (
          <div className="col-span-full text-center text-gray-500 py-12 border rounded-lg bg-white">
            {t.noModelConfigs}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
            <h3 className="text-lg font-medium mb-4">
              {editingConfig ? t.editModelConfig : t.createModelConfig}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.modelName}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder={t.modelNameExample}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.provider}</label>
                <select
                  value={form.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="doubao">Doubao</option>
                  <option value="xiaomi">小米 (MiMo)</option>
                  <option value="custom">{t.custom}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.model}</label>
                {presets.length > 0 ? (
                  <>
                    <select
                      value={isCustomModel ? '__custom__' : form.model}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm(prev => ({ ...prev, model: val === '__custom__' ? '' : val }));
                      }}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    >
                      {presets.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      <option value="__custom__">{t.customModel}</option>
                    </select>
                    {(isCustomModel || !presets.includes(form.model)) && (
                      <input
                        type="text"
                        value={form.model}
                        onChange={(e) => setForm({ ...form, model: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md text-sm mt-2"
                        placeholder={t.modelIdExample}
                        required
                      />
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder={t.modelIdExample}
                    required
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t.apiKey} {editingConfig && <span className="text-gray-400 font-normal">({t.leaveBlankToKeep})</span>}
                </label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder={editingConfig ? '********' : t.apiKeyExample}
                  required={!editingConfig}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.baseUrl}</label>
                <input
                  type="text"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="https://api.openai.com/v1"
                />
                <p className="text-xs text-gray-400 mt-1">{t.baseUrlHint}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.temperature}</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="0.7"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.maxTokens}</label>
                  <input
                    type="number"
                    min="1"
                    value={form.max_tokens}
                    onChange={(e) => setForm({ ...form, max_tokens: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="4096"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                >
                  {editingConfig ? t.save : t.create}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
