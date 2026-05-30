import { useState } from 'react';
import { api } from '../../api';

interface EvalWizardStep3Props {
  projectId: string;
  datasetId: string;
  datasetName: string;
  evaluatorName: string;
  traceCount: number;
  onComplete: (experimentId: string) => void;
  onBack: () => void;
  onCancel: () => void;
}

export function EvalWizardStep3({
  projectId,
  datasetId,
  datasetName,
  evaluatorName,
  traceCount,
  onComplete,
  onBack,
  onCancel,
}: EvalWizardStep3Props) {
  const [experimentName, setExperimentName] = useState(`experiment-${Date.now()}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setError('');
    if (!experimentName.trim()) {
      setError('请输入实验名称');
      return;
    }
    setLoading(true);
    try {
      const experiment = await api.evaluation.experiments.create({
        project_id: projectId,
        name: experimentName.trim(),
        dataset_id: datasetId,
      });
      await api.evaluation.experiments.start(experiment.id);
      onComplete(experiment.id);
    } catch (e: any) {
      setError(e.message || '启动实验失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">确认配置并启动评测实验。</p>

      <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">数据集:</span>
          <span className="font-medium">{datasetName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">评测器:</span>
          <span className="font-medium">{evaluatorName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Trace 数量:</span>
          <span className="font-medium">{traceCount}</span>
        </div>
      </div>

      <input
        type="text"
        value={experimentName}
        onChange={e => setExperimentName(e.target.value)}
        placeholder="实验名称"
        className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

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
            onClick={handleStart}
            disabled={loading}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? '启动中...' : '启动评测'}
          </button>
        </div>
      </div>
    </div>
  );
}
