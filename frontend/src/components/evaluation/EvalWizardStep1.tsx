import { useState, useEffect } from 'react';
import { api, Dataset } from '../../api';

interface EvalWizardStep1Props {
  projectId: string;
  traceIds: string[];
  onNext: (datasetId: string, datasetName: string) => void;
  onCancel: () => void;
}

export function EvalWizardStep1({ projectId, traceIds, onNext, onCancel }: EvalWizardStep1Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [newName, setNewName] = useState(`eval-dataset-${Date.now()}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.evaluation.datasets.list(projectId).then(setDatasets).catch(() => {});
  }, [projectId]);

  const handleNext = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'existing') {
        if (!selectedDatasetId) {
          setError('请选择一个数据集');
          setLoading(false);
          return;
        }
        const ds = datasets.find(d => d.id === selectedDatasetId);
        onNext(selectedDatasetId, ds?.name ?? '');
      } else {
        if (!newName.trim()) {
          setError('请输入数据集名称');
          setLoading(false);
          return;
        }
        const result = await api.traces.bulkExportDataset({
          projectId,
          traceIds,
          datasetName: newName.trim(),
        });
        onNext(result.dataset.id, result.dataset.name);
      }
    } catch (e: any) {
      setError(e.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        将选中的 {traceIds.length} 条 trace 导出为数据集，用于后续评测。
      </p>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
          <span className="text-sm">创建新数据集</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
          <span className="text-sm">使用已有数据集</span>
        </label>
      </div>

      {mode === 'new' ? (
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="数据集名称"
          className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      ) : (
        <select
          value={selectedDatasetId}
          onChange={e => setSelectedDatasetId(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm bg-white"
        >
          <option value="">选择数据集...</option>
          {datasets.map(ds => (
            <option key={ds.id} value={ds.id}>{ds.name} ({ds.item_count} items)</option>
          ))}
        </select>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
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
  );
}
