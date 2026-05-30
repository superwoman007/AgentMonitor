import { useEffect, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { useTranslation } from '../App';
import { api, ModelConfig } from '../api';
import { useProjectStore } from '../stores/projectStore';

export function ModelConfigsPage() {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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
    if (!currentProject) return;
    setLoading(true);
    try {
      const res = await api.modelConfigs.list(currentProject.id);
      setConfigs(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Failed to fetch model configs:', e);
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    try {
      const cfg: Record<string, unknown> = {};
      if (form.temperature) cfg.temperature = parseFloat(form.temperature);
      if (form.max_tokens) cfg.max_tokens = parseInt(form.max_tokens, 10);
      await api.modelConfigs.create({
        project_id: currentProject.id,
        name: form.name,
        provider: form.provider,
        model: form.model,
        api_key: form.api_key || undefined,
        base_url: form.base_url || undefined,
        config: Object.keys(cfg).length > 0 ? cfg : undefined,
      });
      setShowModal(false);
      setForm({ name: '', provider: 'openai', model: '', api_key: '', base_url: '', temperature: '', max_tokens: '' });
      fetchConfigs();
    } catch (e) {
      console.error('Failed to create model config:', e);
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

  return (
    <Layout>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.modelConfigPage}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.modelConfigPage}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          {t.createModelConfig}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {configs.map((cfg) => (
          <div key={cfg.id} className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900">{cfg.name}</h3>
              <button
                onClick={() => handleDelete(cfg.id)}
                className="text-xs text-red-600 hover:underline"
              >
                {t.delete}
              </button>
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

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
            <h3 className="text-lg font-medium mb-4">{t.createModelConfig}</h3>
            <form onSubmit={handleCreate} className="space-y-4">
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
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="doubao">Doubao</option>
                  <option value="custom">{t.custom}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.model}</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder={t.modelIdExample}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.apiKey}</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder={t.apiKeyExample}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.baseUrl}</label>
                <input
                  type="text"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder={t.baseUrlExample}
                />
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
                  {t.create}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
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
