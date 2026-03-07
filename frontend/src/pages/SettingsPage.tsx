import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import {useProjectStore } from '../stores/projectStore';
import { api, ApiKey, Project } from '../api';
import { useTranslation } from '../App';

export function SettingsPage() {
  const { projects, currentProject, ensureDefaultProject, createProject, updateProject, deleteProject, setCurrentProject } = useProjectStore();
  const { t } = useTranslation();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [loadingReveal, setLoadingReveal] = useState<Record<string, boolean>>({});

  useEffect(() => {
    ensureDefaultProject().finally(() => setBootstrapped(true));
  }, [ensureDefaultProject]);

  useEffect(() => {
    if (currentProject) {
      setIsLoading(true);
      api.apiKeys.list(currentProject.id)
        .then(({ apiKeys }) => setApiKeys(apiKeys))
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [currentProject]);

  useEffect(() => {
    if (bootstrapped && !currentProject) {
      setIsLoading(false);
    }
  }, [bootstrapped, currentProject]);

  const handleCreateKey = async () => {
    if (!currentProject || !newKeyName.trim()) return;

    try {
      const { apiKey } = await api.apiKeys.create({
        projectId: currentProject.id,
        name: newKeyName.trim(),
      });
      setApiKeys([...apiKeys, apiKey]);
      setNewKeyName('');
      setShowCreateKey(false);
      if ((apiKey as any).plain_key) {
        setNewKey((apiKey as any).plain_key);
      }
    } catch (error) {
      console.error('Failed to create API key:', error);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!currentProject) return;
    if (!confirm(t.revokeConfirm)) return;

    try {
      await api.apiKeys.delete(keyId, currentProject.id);
      setApiKeys(apiKeys.filter((k) => k.id !== keyId));
    } catch (error) {
      console.error('Failed to revoke API key:', error);
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    alert(t.apiKeyCopied);
  };

  const handleRevealKey = async (keyId: string) => {
    if (!currentProject) return;
    
    // 如果已经显示，则隐藏
    if (revealedKeys[keyId]) {
      const newRevealed = { ...revealedKeys };
      delete newRevealed[keyId];
      setRevealedKeys(newRevealed);
      return;
    }
    
    // 否则从后端获取
    setLoadingReveal({ ...loadingReveal, [keyId]: true });
    try {
      const { secret } = await api.apiKeys.getSecret(keyId, currentProject.id);
      setRevealedKeys({ ...revealedKeys, [keyId]: secret });
    } catch (error) {
      console.error('Failed to reveal API key:', error);
      alert('无法获取 API Key');
    } finally {
      setLoadingReveal({ ...loadingReveal, [keyId]: false });
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      const project = await createProject(newProjectName.trim(), newProjectDesc.trim() || undefined);
      setCurrentProject(project);
      setNewProjectName('');
      setNewProjectDesc('');
      setShowCreateProject(false);
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleUpdateProject = async () => {
    if (!editingProject) return;

    try {
      await updateProject(editingProject.id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
      });
      setEditingProject(null);
      setEditName('');
      setEditDesc('');
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm(t.deleteProjectConfirm)) return;

    try {
      await deleteProject(projectId);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const startEditProject = (project: Project) => {
    setEditingProject(project);
    setEditName(project.name);
    setEditDesc(project.description || '');
  };

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.settings}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t.projects}</h2>
            <button
              onClick={() => setShowCreateProject(true)}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
            >
              + {t.createProject}
            </button>
          </div>

          {showCreateProject && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-3">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder={t.projectName || '项目名称'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <textarea
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder={t.projectDescription || '项目描述'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateProject}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                  >
                    {t.save}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateProject(false);
                      setNewProjectName('');
                      setNewProjectDesc('');
                    }}
                    className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`p-4 border rounded-lg ${
                  currentProject?.id === project.id ? 'border-blue-500 bg-blue-50' : ''
                }`}
              >
                {editingProject?.id === project.id ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleUpdateProject}
                        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                      >
                        {t.save}
                      </button>
                      <button
                        onClick={() => setEditingProject(null)}
                        className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start">
                    <div
                      className="cursor-pointer flex-1"
                      onClick={() => setCurrentProject(project)}
                    >
                      <h3 className="font-medium text-gray-900">{project.name}</h3>
                      {project.description && (
                        <p className="text-sm text-gray-500 mt-1">{project.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2 ml-2">
                      <button
                        onClick={() => startEditProject(project)}
                        className="text-gray-400 hover:text-gray-600 text-sm"
                      >
                        {t.edit}
                      </button>
                      {projects.length > 1 && (
                        <button
                          onClick={() => handleDeleteProject(project.id)}
                          className="text-red-400 hover:text-red-600 text-sm"
                        >
                          {t.deleteProject}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t.apiKeys}</h2>
            {currentProject && (
              <button
                onClick={() => setShowCreateKey(true)}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                + {t.createApiKey}
              </button>
            )}
          </div>

          {!currentProject && <p className="text-gray-500 text-sm">{t.noProject}</p>}

          {showCreateKey && currentProject && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-3">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder={t.apiKeyName || 'Key 名称'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateKey}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                  >
                    {t.save}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateKey(false);
                      setNewKeyName('');
                    }}
                    className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            </div>
          )}

          {newKey && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-medium text-green-800 mb-2">{t.apiKeyCreated}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-white rounded text-xs break-all">{newKey}</code>
                <button
                  onClick={() => {
                    handleCopyKey(newKey);
                    setNewKey(null);
                  }}
                  className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
                >
                  {t.copy}
                </button>
              </div>
              <p className="text-xs text-green-600 mt-2">请保存此 Key！之后不会再次显示。</p>
            </div>
          )}

          {isLoading ? (
            <p className="text-gray-500 text-sm">{t.loading}</p>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <div key={key.id} className="p-4 border rounded-lg">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">{key.name}</h3>
                      <p className="text-sm text-gray-500 font-mono">{key.key_prefix}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {t.createdAt}: {new Date(key.created_at).toLocaleString()}
                      </p>
                      
                      {revealedKeys[key.id] && (
                        <div className="mt-3 p-2 bg-gray-50 rounded border border-gray-200">
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs break-all font-mono text-gray-800">{revealedKeys[key.id]}</code>
                            <button
                              onClick={() => handleCopyKey(revealedKeys[key.id])}
                              className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      {key.is_active ? (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">{t.active}</span>
                      ) : (
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">{t.revoke}</span>
                      )}
                      
                      <div style={{display: 'flex', gap: '8px'}}>
                        <button
                          onClick={() => handleRevealKey(key.id)}
                          disabled={loadingReveal[key.id]}
                          className="text-blue-600 hover:text-blue-800 text-sm disabled:text-gray-400"
                        >
                          {loadingReveal[key.id] ? '加载中...' : revealedKeys[key.id] ? '隐藏' : '显示 Key'}
                        </button>
                        <button
                          onClick={() => handleRevokeKey(key.id)}
                          className="text-red-400 hover:text-red-600 text-sm"
                        >
                          {t.revoke}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {apiKeys.length === 0 && !isLoading && (
                <p className="text-gray-500 text-sm text-center py-4">{t.noApiKeys}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
