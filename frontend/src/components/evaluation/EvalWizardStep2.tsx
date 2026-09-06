import { useState, useEffect } from 'react';
import { useTranslation } from '../../App';
import { api, Evaluator, EvaluatorTemplate } from '../../api';

interface EvalWizardStep2Props {
  projectId: string;
  datasetType?: string;
  onNext: (evaluatorId: string, evaluatorName: string, evaluatorVersionId: string) => void;
  onBack: () => void;
  onCancel: () => void;
}

/**
 * 评测向导第二步
 * @param projectId - 当前项目 ID
 * @param datasetType - 数据集类型
 * @param onNext - 进入下一步的回调
 * @param onBack - 返回上一步回调
 * @param onCancel - 取消回调
 * @returns 第二步组件
 */
export function EvalWizardStep2({ projectId, datasetType, onNext, onBack, onCancel }: EvalWizardStep2Props) {
  const { t, lang } = useTranslation();
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [templates, setTemplates] = useState<EvaluatorTemplate[]>([]);
  const [mode, setMode] = useState<'existing' | 'template'>('existing');
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const copy = {
    intro: lang === 'zh' ? '选择或创建评测器来评估数据集。' : 'Choose or create an evaluator for the dataset.',
    useExistingEvaluator: lang === 'zh' ? '使用已有评测器' : 'Use Existing Evaluator',
    createFromTemplate: lang === 'zh' ? '从模板创建' : 'Create from Template',
    selectEvaluatorPlaceholder: lang === 'zh' ? '选择评测器...' : 'Select an evaluator...',
    selectTemplatePlaceholder: lang === 'zh' ? '选择模板...' : 'Select a template...',
    evaluatorNamePlaceholder: lang === 'zh' ? '评测器名称（可选，默认使用模板名）' : 'Evaluator name (optional, defaults to template name)',
    selectEvaluatorRequired: lang === 'zh' ? '请选择一个评测器' : 'Please select an evaluator',
    selectTemplateRequired: lang === 'zh' ? '请选择一个模板' : 'Please select a template',
    actionFailed: lang === 'zh' ? '操作失败' : 'Action failed',
    processing: lang === 'zh' ? '处理中...' : 'Processing...',
    next: lang === 'zh' ? '下一步' : 'Next',
  };

  useEffect(() => {
    api.evaluation.evaluators.list(projectId).then(setEvaluators).catch(() => {});
    api.evaluation.evaluatorTemplates.list(datasetType).then((response) => {
      setTemplates(response.templates);
    }).catch(() => {});
  }, [projectId, datasetType]);

  /**
   * 校验当前评测器配置并进入下一步
   * @returns Promise<void>
   */
  const handleNext = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'existing') {
        if (!selectedEvaluatorId) {
          setError(copy.selectEvaluatorRequired);
          setLoading(false);
          return;
        }
        const ev = evaluators.find(e => e.id === selectedEvaluatorId);
        const versions = await api.evaluation.evaluators.versions.list(selectedEvaluatorId);
        const latestVersion = versions.versions[0];
        if (!latestVersion) {
          throw new Error(lang === 'zh' ? '该评测器没有可用版本' : 'No evaluator version available');
        }
        onNext(selectedEvaluatorId, ev?.name ?? '', latestVersion.id);
      } else {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) {
          setError(copy.selectTemplateRequired);
          setLoading(false);
          return;
        }
        const name = evaluatorName.trim() || template.name;
        const result = await api.evaluation.evaluators.create({
          project_id: projectId,
          name,
          type: template.type,
          config: template.default_config,
        });
        const versions = await api.evaluation.evaluators.versions.list(result.id);
        const latestVersion = versions.versions[0];
        if (!latestVersion) {
          throw new Error(lang === 'zh' ? '新建评测器未生成版本' : 'No evaluator version created');
        }
        onNext(result.id, result.name, latestVersion.id);
      }
    } catch (e: any) {
      setError(e.message || copy.actionFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">{copy.intro}</p>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
          <span className="text-sm">{copy.useExistingEvaluator}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'template'} onChange={() => setMode('template')} />
          <span className="text-sm">{copy.createFromTemplate}</span>
        </label>
      </div>

      {mode === 'existing' ? (
        <select
          value={selectedEvaluatorId}
          onChange={e => setSelectedEvaluatorId(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm bg-white"
        >
          <option value="">{copy.selectEvaluatorPlaceholder}</option>
          {evaluators.map(ev => (
            <option key={ev.id} value={ev.id}>{ev.name} ({ev.type})</option>
          ))}
        </select>
      ) : (
        <div className="space-y-3">
          <select
            value={selectedTemplateId}
            onChange={e => setSelectedTemplateId(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm bg-white"
          >
            <option value="">{copy.selectTemplatePlaceholder}</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name} - {t.description}</option>
            ))}
          </select>
          <input
            type="text"
            value={evaluatorName}
            onChange={e => setEvaluatorName(e.target.value)}
            placeholder={copy.evaluatorNamePlaceholder}
            className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

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
            onClick={handleNext}
            disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? copy.processing : copy.next}
          </button>
        </div>
      </div>
    </div>
  );
}
