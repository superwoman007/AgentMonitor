import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../App';
import { AgentTargetType, api, ModelConfig, Prompt } from '../../api';

interface EvalWizardStep3Props {
  projectId: string;
  datasetId: string;
  datasetName: string;
  evaluatorId: string;
  evaluatorName: string;
  evaluatorVersionId: string;
  traceCount: number;
  onComplete: (experimentId: string) => void;
  onBack: () => void;
  onCancel: () => void;
}

/**
 * 评测向导第三步
 * @param projectId - 当前项目 ID
 * @param datasetId - 数据集 ID
 * @param datasetName - 数据集名称
 * @param evaluatorId - 评测器 ID
 * @param evaluatorName - 评测器名称
 * @param evaluatorVersionId - 评测器版本 ID
 * @param traceCount - Trace 数量
 * @param onComplete - 完成后的回调
 * @param onBack - 返回上一步回调
 * @param onCancel - 取消回调
 * @returns 第三步组件
 */
export function EvalWizardStep3({
  projectId,
  datasetId,
  datasetName,
  evaluatorId,
  evaluatorName,
  evaluatorVersionId,
  traceCount,
  onComplete,
  onBack,
  onCancel,
}: EvalWizardStep3Props) {
  const { t, lang } = useTranslation();
  const [experimentName, setExperimentName] = useState(`experiment-${Date.now()}`);
  const [targetType, setTargetType] = useState<AgentTargetType>('prompt_model');
  const [targetName, setTargetName] = useState(`target-${Date.now()}`);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [targetPromptId, setTargetPromptId] = useState('');
  const [targetModelConfigId, setTargetModelConfigId] = useState('');
  const [temperature, setTemperature] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [httpUrl, setHttpUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState('POST');
  const [httpHeaders, setHttpHeaders] = useState('{\n  "X-Agent-Eval": "AgentMonitor"\n}');
  const [httpTimeoutMs, setHttpTimeoutMs] = useState('60000');
  const [httpOutputPath, setHttpOutputPath] = useState('/output');
  const [httpTraceIdPath, setHttpTraceIdPath] = useState('/traceId');
  const [httpUsagePath, setHttpUsagePath] = useState('/metrics/tokenUsage');
  const [httpRequestTemplate, setHttpRequestTemplate] = useState(
    '{\n  "input": "{{sample.input}}",\n  "expected": "{{sample.expected}}",\n  "metadata": "{{sample.metadata}}",\n  "runId": "{{run.id}}",\n  "runItemId": "{{runItem.id}}"\n}'
  );
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'api_key'>('none');
  const [authSecretRef, setAuthSecretRef] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('X-API-Key');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const copy = {
    intro: lang === 'zh' ? '确认配置并启动评测实验。' : 'Confirm the configuration and start the evaluation experiment.',
    traceCountLabel: lang === 'zh' ? '调用数量:' : 'Trace Count:',
    experimentNamePlaceholder: lang === 'zh' ? '实验名称' : 'Experiment Name',
    enterExperimentNameRequired: lang === 'zh' ? '请输入实验名称' : 'Please enter an experiment name',
    enterTargetNameRequired: lang === 'zh' ? '请输入 Target 名称' : 'Please enter a target name',
    modelConfigRequired: lang === 'zh' ? 'prompt_model 需要选择模型配置' : 'Please select a model config for prompt_model',
    httpUrlRequired: lang === 'zh' ? 'http_agent 需要填写调用 URL' : 'Please enter the target URL for http_agent',
    invalidJson: lang === 'zh' ? '存在无效的 JSON 配置，请检查请求模板或请求头' : 'Invalid JSON configuration detected',
    startExperimentFailed: lang === 'zh' ? '启动实验失败' : 'Failed to start experiment',
    starting: lang === 'zh' ? '启动中...' : 'Starting...',
    targetSection: lang === 'zh' ? '被测 Target' : 'Target',
    targetNamePlaceholder: lang === 'zh' ? 'Target 名称' : 'Target name',
    promptModelLabel: lang === 'zh' ? '平台托管 Prompt + 模型' : 'Prompt + Model',
    httpAgentLabel: lang === 'zh' ? 'HTTP Agent' : 'HTTP Agent',
    traceReplayLabel: lang === 'zh' ? 'Trace Replay' : 'Trace Replay',
    promptOptional: lang === 'zh' ? 'Prompt（可选）' : 'Prompt (optional)',
    modelConfigLabel: lang === 'zh' ? '模型配置' : 'Model Config',
    temperatureLabel: lang === 'zh' ? '温度（可选）' : 'Temperature (optional)',
    maxTokensLabel: lang === 'zh' ? '最大输出 Tokens（可选）' : 'Max Tokens (optional)',
    httpUrlLabel: lang === 'zh' ? '请求 URL' : 'Request URL',
    httpMethodLabel: lang === 'zh' ? '请求方法' : 'HTTP Method',
    httpHeadersLabel: lang === 'zh' ? '请求头 JSON' : 'Headers JSON',
    httpTimeoutLabel: lang === 'zh' ? '超时毫秒' : 'Timeout (ms)',
    httpOutputPathLabel: lang === 'zh' ? '输出 JSON Pointer' : 'Output JSON Pointer',
    httpTracePathLabel: lang === 'zh' ? 'TraceId JSON Pointer' : 'TraceId JSON Pointer',
    httpUsagePathLabel: lang === 'zh' ? 'TokenUsage JSON Pointer' : 'TokenUsage JSON Pointer',
    httpTemplateLabel: lang === 'zh' ? '请求模板 JSON' : 'Request Template JSON',
    authTypeLabel: lang === 'zh' ? '鉴权方式' : 'Authentication',
    authSecretLabel: lang === 'zh' ? '密钥 / SecretRef' : 'Secret / SecretRef',
    authHeaderLabel: lang === 'zh' ? 'API Key Header' : 'API Key Header',
    traceReplayHint: lang === 'zh'
      ? 'trace_replay 不会实时调用 Agent，而是直接使用采样回流数据中的历史输出进行评分。'
      : 'trace_replay scores historical outputs directly without live invocation.',
  };

  const targetTypeOptions = useMemo(
    () => [
      { value: 'prompt_model' as const, label: copy.promptModelLabel },
      { value: 'http_agent' as const, label: copy.httpAgentLabel },
      { value: 'trace_replay' as const, label: copy.traceReplayLabel },
    ],
    [copy.httpAgentLabel, copy.promptModelLabel, copy.traceReplayLabel]
  );

  useEffect(() => {
    api.modelConfigs.list(projectId).then(setModelConfigs).catch(() => {});
    api.prompts.list(projectId).then(setPrompts).catch(() => {});
  }, [projectId]);

  /**
   * 将文本 JSON 解析为对象。
   * @param raw - JSON 文本
   * @returns 解析后的对象
   */
  const parseJsonObject = (raw: string): Record<string, unknown> => {
    const text = raw.trim();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(copy.invalidJson);
    }
    return parsed as Record<string, unknown>;
  };

  /**
   * 生成 suite member alias，避免空格和特殊字符。
   * @param name - 原始名称
   * @returns 归一化 alias
   */
  const buildAlias = (name: string): string =>
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'primary';

  /**
   * 组装 Target 调用配置。
   * @returns target 创建所需配置
   */
  const buildTargetConfig = (): { type: AgentTargetType; invocationConfig: Record<string, unknown> } => {
    if (targetType === 'prompt_model') {
      if (!targetModelConfigId) {
        throw new Error(copy.modelConfigRequired);
      }
      const selectedPrompt = prompts.find((prompt) => prompt.id === targetPromptId);
      const runConfig: Record<string, unknown> = {};
      if (temperature.trim()) {
        runConfig.temperature = Number(temperature);
      }
      if (maxTokens.trim()) {
        runConfig.maxTokens = Number(maxTokens);
      }
      return {
        type: 'prompt_model',
        invocationConfig: {
          promptId: targetPromptId || undefined,
          promptVersionId: selectedPrompt?.current_version_id ?? undefined,
          modelConfigId: targetModelConfigId,
          runConfig: Object.keys(runConfig).length > 0 ? runConfig : undefined,
        },
      };
    }

    if (targetType === 'http_agent') {
      if (!httpUrl.trim()) {
        throw new Error(copy.httpUrlRequired);
      }
      const timeoutMs = httpTimeoutMs.trim() ? Number(httpTimeoutMs) : 60000;
      const authentication =
        authType === 'none'
          ? { type: 'none' }
          : authType === 'bearer'
            ? { type: 'bearer', secretRef: authSecretRef.trim() }
            : { type: 'api_key', secretRef: authSecretRef.trim(), headerName: authHeaderName.trim() || 'X-API-Key' };

      return {
        type: 'http_agent',
        invocationConfig: {
          method: httpMethod,
          url: httpUrl.trim(),
          headers: parseJsonObject(httpHeaders),
          timeoutMs,
          asyncMode: false,
          requestTemplate: parseJsonObject(httpRequestTemplate),
          outputPath: httpOutputPath.trim() || '/output',
          traceIdPath: httpTraceIdPath.trim() || '/traceId',
          usagePath: httpUsagePath.trim() || '/metrics/tokenUsage',
          authentication,
        },
      };
    }

    return {
      type: 'trace_replay',
      invocationConfig: {},
    };
  };

  /**
   * 创建并启动实验
   * @returns Promise<void>
   */
  const handleStart = async () => {
    setError('');
    if (!experimentName.trim()) {
      setError(copy.enterExperimentNameRequired);
      return;
    }
    if (!targetName.trim()) {
      setError(copy.enterTargetNameRequired);
      return;
    }
    setLoading(true);
    try {
      const targetConfig = buildTargetConfig();
      const datasetVersion = await api.evaluation.datasets.versions.create(datasetId, {
        description: `Wizard snapshot for ${experimentName.trim()}`,
      });
      const createdTarget = await api.targetsV2.create({
        projectId,
        name: targetName.trim(),
        type: targetConfig.type,
        invocationConfig: targetConfig.invocationConfig,
        sourceRevision: {
          createdFrom: 'eval_wizard',
          targetType,
          evaluatorId,
        },
      });
      const suite = await api.suitesV2.create({
        projectId,
        name: `${experimentName.trim()}-suite`,
        description: `Suite for ${experimentName.trim()}`,
        members: [
          {
            evaluatorVersionId,
            alias: buildAlias(evaluatorName),
            required: true,
            ordinal: 1,
          },
        ],
        aggregationConfig: {
          strategy: 'all_required',
        },
      });
      const experiment = await api.evaluation.experiments.create({
        project_id: projectId,
        name: experimentName.trim(),
        dataset_id: datasetId,
        evaluator_id: evaluatorId,
        dataset_version_id: datasetVersion.id,
        target_version_id: createdTarget.version.id,
        evaluator_suite_version_id: suite.version.id,
        default_run_config:
          targetType === 'prompt_model' && (temperature.trim() || maxTokens.trim())
            ? {
                temperature: temperature.trim() ? Number(temperature) : undefined,
                maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
              }
            : undefined,
      });
      await api.evaluation.experiments.start(experiment.id);
      onComplete(experiment.id);
    } catch (e: any) {
      setError(e.message || copy.startExperimentFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">{copy.intro}</p>

      <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">{t.dataset}:</span>
          <span className="font-medium">{datasetName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">{t.evaluator}:</span>
          <span className="font-medium">{evaluatorName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">{copy.traceCountLabel}</span>
          <span className="font-medium">{traceCount}</span>
        </div>
      </div>

      <div className="space-y-3 border rounded-lg p-4">
        <h3 className="text-sm font-medium">{copy.targetSection}</h3>
        <input
          type="text"
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          placeholder={copy.targetNamePlaceholder}
          className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {targetTypeOptions.map((option) => (
            <label key={option.value} className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer">
              <input
                type="radio"
                checked={targetType === option.value}
                onChange={() => setTargetType(option.value)}
              />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </div>

        {targetType === 'prompt_model' && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">{copy.promptOptional}</div>
              <select
                value={targetPromptId}
                onChange={(e) => setTargetPromptId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm bg-white"
              >
                <option value="">{lang === 'zh' ? '不绑定 Prompt' : 'No Prompt'}</option>
                {prompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">{copy.modelConfigLabel}</div>
              <select
                value={targetModelConfigId}
                onChange={(e) => setTargetModelConfigId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm bg-white"
              >
                <option value="">{lang === 'zh' ? '选择模型配置' : 'Select model config'}</option>
                {modelConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name} ({config.provider}/{config.model})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.temperatureLabel}</div>
                <input
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.maxTokensLabel}</div>
                <input
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {targetType === 'http_agent' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.httpUrlLabel}</div>
                <input
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.httpMethodLabel}</div>
                <select
                  value={httpMethod}
                  onChange={(e) => setHttpMethod(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="GET">GET</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.authTypeLabel}</div>
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as 'none' | 'bearer' | 'api_key')}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                >
                  <option value="none">none</option>
                  <option value="bearer">bearer</option>
                  <option value="api_key">api_key</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.httpTimeoutLabel}</div>
                <input
                  value={httpTimeoutMs}
                  onChange={(e) => setHttpTimeoutMs(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
            </div>
            {authType !== 'none' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">{copy.authSecretLabel}</div>
                  <input
                    value={authSecretRef}
                    onChange={(e) => setAuthSecretRef(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                  />
                </div>
                {authType === 'api_key' && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">{copy.authHeaderLabel}</div>
                    <input
                      value={authHeaderName}
                      onChange={(e) => setAuthHeaderName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                  </div>
                )}
              </div>
            )}
            <div>
              <div className="text-xs text-gray-500 mb-1">{copy.httpHeadersLabel}</div>
              <textarea
                value={httpHeaders}
                onChange={(e) => setHttpHeaders(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">{copy.httpTemplateLabel}</div>
              <textarea
                value={httpRequestTemplate}
                onChange={(e) => setHttpRequestTemplate(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 border rounded-md text-sm font-mono"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.httpOutputPathLabel}</div>
                <input
                  value={httpOutputPath}
                  onChange={(e) => setHttpOutputPath(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.httpTracePathLabel}</div>
                <input
                  value={httpTraceIdPath}
                  onChange={(e) => setHttpTraceIdPath(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{copy.httpUsagePathLabel}</div>
                <input
                  value={httpUsagePath}
                  onChange={(e) => setHttpUsagePath(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {targetType === 'trace_replay' && (
          <div className="text-sm text-gray-600 bg-gray-50 rounded-md p-3">{copy.traceReplayHint}</div>
        )}
      </div>

      <input
        type="text"
        value={experimentName}
        onChange={e => setExperimentName(e.target.value)}
        placeholder={copy.experimentNamePlaceholder}
        className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
          {t.back}
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            {t.cancel}
          </button>
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? copy.starting : t.startExperiment}
          </button>
        </div>
      </div>
    </div>
  );
}
