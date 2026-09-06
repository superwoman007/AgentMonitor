import { useState, useEffect } from 'react';
import { useTranslation } from '../../App';
import { api, Dataset } from '../../api';

interface EvalWizardStep1Props {
  projectId: string;
  traceIds: string[];
  onNext: (datasetId: string, datasetName: string) => void;
  onCancel: () => void;
}

/**
 * 评测向导第一步
 * @param projectId - 当前项目 ID
 * @param traceIds - 已选中的 Trace ID 列表
 * @param onNext - 进入下一步的回调
 * @param onCancel - 取消回调
 * @returns 第一步组件
 */
export function EvalWizardStep1({ projectId, traceIds, onNext, onCancel }: EvalWizardStep1Props) {
  const { t, lang } = useTranslation();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [newName, setNewName] = useState(`eval-dataset-${Date.now()}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const copy = {
    intro: lang === 'zh'
      ? `将选中的 ${traceIds.length} 条调用记录导出为数据集，用于后续评测。`
      : `Export ${traceIds.length} selected traces as a dataset for later evaluation.`,
    useExistingDataset: lang === 'zh' ? '使用已有数据集' : 'Use Existing Dataset',
    datasetNamePlaceholder: lang === 'zh' ? '数据集名称' : 'Dataset Name',
    selectDatasetPlaceholder: lang === 'zh' ? '选择数据集...' : 'Select a dataset...',
    selectDatasetRequired: lang === 'zh' ? '请选择一个数据集' : 'Please select a dataset',
    enterDatasetNameRequired: lang === 'zh' ? '请输入数据集名称' : 'Please enter a dataset name',
    actionFailed: lang === 'zh' ? '操作失败' : 'Action failed',
    processing: lang === 'zh' ? '处理中...' : 'Processing...',
    next: lang === 'zh' ? '下一步' : 'Next',
    itemCount: (count: number) => (lang === 'zh' ? `${count} 条` : `${count} items`),
  };

  useEffect(() => {
    api.evaluation.datasets.list(projectId).then(setDatasets).catch(() => {});
  }, [projectId]);

  /**
   * 校验当前选择并进入下一步
   * @returns Promise<void>
   */
  const handleNext = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'existing') {
        if (!selectedDatasetId) {
          setError(copy.selectDatasetRequired);
          setLoading(false);
          return;
        }
        const ds = datasets.find(d => d.id === selectedDatasetId);
        onNext(selectedDatasetId, ds?.name ?? '');
      } else {
        if (!newName.trim()) {
          setError(copy.enterDatasetNameRequired);
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
      setError(e.message || copy.actionFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        {copy.intro}
      </p>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
          <span className="text-sm">{t.createDataset}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
          <span className="text-sm">{copy.useExistingDataset}</span>
        </label>
      </div>

      {mode === 'new' ? (
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder={copy.datasetNamePlaceholder}
          className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      ) : (
        <select
          value={selectedDatasetId}
          onChange={e => setSelectedDatasetId(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm bg-white"
        >
          <option value="">{copy.selectDatasetPlaceholder}</option>
          {datasets.map(ds => (
            <option key={ds.id} value={ds.id}>{ds.name} ({copy.itemCount(ds.item_count)})</option>
          ))}
        </select>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
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
  );
}
