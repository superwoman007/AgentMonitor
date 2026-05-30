import { useState, useEffect } from 'react';
import { api, Evaluator, EvaluatorTemplate } from '../../api';

interface EvalWizardStep2Props {
  projectId: string;
  datasetType?: string;
  onNext: (evaluatorId: string, evaluatorName: string) => void;
  onBack: () => void;
  onCancel: () => void;
}

export function EvalWizardStep2({ projectId, datasetType, onNext, onBack, onCancel }: EvalWizardStep2Props) {
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [templates, setTemplates] = useState<EvaluatorTemplate[]>([]);
  const [mode, setMode] = useState<'existing' | 'template'>('existing');
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.evaluation.evaluators.list(projectId).then(setEvaluators).catch(() => {});
    api.evaluation.evaluatorTemplates(datasetType).then(r => setTemplates(r.templates)).catch(() => {});
  }, [projectId, datasetType]);

  const handleNext = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'existing') {
        if (!selectedEvaluatorId) {
          setError('请选择一个评测器');
          setLoading(false);
          return;
        }
        const ev = evaluators.find(e => e.id === selectedEvaluatorId);
        onNext(selectedEvaluatorId, ev?.name ?? '');
      } else {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) {
          setError('请选择一个模板');
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
        onNext(result.id, result.name);
      }
    } catch (e: any) {
      setError(e.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">选择或创建评测器来评估数据集。</p>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
          <span className="text-sm">使用已有评测器</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'template'} onChange={() => setMode('template')} />
          <span className="text-sm">从模板创建</span>
        </label>
      </div>

      {mode === 'existing' ? (
        <select
          value={selectedEvaluatorId}
          onChange={e => setSelectedEvaluatorId(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm bg-white"
        >
          <option value="">选择评测器...</option>
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
            <option value="">选择模板...</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name} - {t.description}</option>
            ))}
          </select>
          <input
            type="text"
            value={evaluatorName}
            onChange={e => setEvaluatorName(e.target.value)}
            placeholder="评测器名称（可选，默认使用模板名）"
            className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
          上一步
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            取消
          </button>
          <button
            onClick={handleNext}
            disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '处理中...' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
