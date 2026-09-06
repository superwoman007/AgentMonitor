import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { api, Dataset, V2BadCasesReport, V2Run, V2RunEvent, V2RunItem } from '../api';

/**
 * Run 状态 → Tailwind 样式映射。
 * @param status - Run 或 RunItem 状态
 * @returns 对应的徽章样式
 */
function statusColor(status: string): string {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'cancelled':
    case 'cancelling':
      return 'bg-gray-200 text-gray-700';
    case 'running':
      return 'bg-blue-100 text-blue-700';
    case 'queued':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/**
 * 将快照对象格式化为便于展示的字符串。
 * @param value - 任意快照值
 * @returns 优先展示文本，否则展示格式化 JSON
 */
function formatSnapshotValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 从样本快照中提取适合表格预览的文本。
 * @param snapshot - input/expected 快照对象
 * @returns 预览文本
 */
function snapshotPreview(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return '-';
  const keys = ['query', 'input', 'content', 'text', 'answer', 'expected', 'output'];
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return formatSnapshotValue(snapshot);
}

/**
 * PR-11 / DoD-8 Run 详情页：展示 Run 汇总、Bad Cases、逐条详情、回归集操作和事件流。
 * @returns Run 详情页面
 */
export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<V2Run | null>(null);
  const [items, setItems] = useState<V2RunItem[]>([]);
  const [badCases, setBadCases] = useState<V2BadCasesReport | null>(null);
  const [events, setEvents] = useState<V2RunEvent[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [newDatasetName, setNewDatasetName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [passedFilter, setPassedFilter] = useState<string>('');
  const [aliasFilter, setAliasFilter] = useState<string>('');

  /**
   * 拉取 Run 详情、事件、Bad Cases 与项目数据集列表。
   */
  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [runRes, itemsRes, eventsRes, badRes] = await Promise.all([
        api.runsV2.get(id),
        api.runsV2.items(id, { limit: 200 }),
        api.runsV2.events(id),
        api.runsV2.badCases(id, 20),
      ]);
      const projectDatasets = await api.evaluation.datasets.list(runRes.run.project_id);
      setRun(runRes.run);
      setItems(itemsRes.items);
      setEvents(eventsRes.events ?? []);
      setBadCases(badRes);
      setDatasets(projectDatasets);
      setSelectedDatasetId((current) => {
        if (current && projectDatasets.some((dataset) => dataset.id === current)) {
          return current;
        }
        return projectDatasets[0]?.id ?? '';
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * 解析当前“加入回归集”动作的目标数据集参数。
   * @returns 数据集 ID 或新建数据集名称
   */
  const getDatasetTarget = (): { datasetId?: string; datasetName?: string } => {
    if (selectedDatasetId) {
      return { datasetId: selectedDatasetId };
    }
    if (newDatasetName.trim()) {
      return { datasetName: newDatasetName.trim() };
    }
    throw new Error('请先选择目标数据集，或输入一个新的回归集名称');
  };

  /**
   * 触发单条样本重跑。
   * @param runItemId - RunItem ID
   */
  const handleRetryItem = async (runItemId: string) => {
    setActionLoadingId(`retry:${runItemId}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await api.runsV2.retryItem(runItemId);
      setActionMessage(`已创建单条重跑 Run #${result.run.run_number}`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '单条重跑失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  /**
   * 将单条 Bad Case 加入回归集。
   * @param runItemId - RunItem ID
   */
  const handleAddToDataset = async (runItemId: string) => {
    setActionLoadingId(`dataset:${runItemId}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const target = getDatasetTarget();
      const result = await api.runsV2.addItemToDataset(runItemId, target);
      setSelectedDatasetId(result.dataset.id);
      setNewDatasetName('');
      setActionMessage(`已加入回归集：${result.dataset.name}`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '加入回归集失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  /**
   * 导出 JUnit XML 到本地文件。
   */
  const handleExportJunit = async () => {
    if (!id) return;
    try {
      const xml = await api.runsV2.exportJunit(id);
      const blob = new Blob([xml], { type: 'application/junit+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-${id}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '导出失败');
    }
  };

  /**
   * 导出完整 JSON 报告。
   */
  const handleExportJson = async () => {
    if (!id) return;
    try {
      const data = await api.runsV2.exportJson(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '导出失败');
    }
  };

  /**
   * 按状态 / 是否通过 / evaluator alias 过滤 items。
   */
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (statusFilter && it.status !== statusFilter) return false;
      if (passedFilter === 'true' && !it.scores.some((s) => s.passed === true)) return false;
      if (passedFilter === 'false' && !it.scores.some((s) => s.passed === false)) return false;
      if (aliasFilter && !it.scores.some((s) => s.evaluator_alias === aliasFilter)) return false;
      return true;
    });
  }, [items, statusFilter, passedFilter, aliasFilter]);

  const aliases = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => it.scores.forEach((s) => set.add(s.evaluator_alias)));
    return Array.from(set).sort();
  }, [items]);

  if (loading) {
    return (
      <Layout>
        <div className="text-gray-500">加载中...</div>
      </Layout>
    );
  }

  if (error || !run) {
    return (
      <Layout>
        <div className="text-red-600">{error ?? 'Run 不存在'}</div>
      </Layout>
    );
  }

  const summary = run.summary;
  const versionSnapshot = run.config_snapshot?.experiment;

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/evaluation" className="text-sm text-blue-600 hover:underline">
          ← 返回实验
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Run #{run.run_number}
            <span className={`ml-3 text-xs px-2 py-0.5 rounded ${statusColor(run.status)}`}>
              {run.status}
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            触发器：{run.trigger_type}
            {run.retry_of_run_id ? ` · 重试自 ${run.retry_of_run_id.slice(0, 8)}` : ''}
            {' · '}
            {run.started_at ? new Date(run.started_at).toLocaleString() : '尚未开始'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            刷新
          </button>
          <Link
            to={`/evaluation/runs/compare?baseline=${run.id}`}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            对比
          </Link>
          <button
            onClick={handleExportJson}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            导出 JSON
          </button>
          <button
            onClick={handleExportJunit}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            导出 JUnit
          </button>
        </div>
      </div>

      {(run.error || run.status_reason) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {run.error ?? run.status_reason}
        </div>
      )}

      {actionMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500">总样本</div>
          <div className="text-2xl font-semibold mt-1">{summary?.totalItems ?? items.length}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500">通过</div>
          <div className="text-2xl font-semibold mt-1 text-green-700">
            {summary?.passedItems ?? 0}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500">失败</div>
          <div className="text-2xl font-semibold mt-1 text-red-700">
            {summary?.failedItems ?? 0}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500">平均得分</div>
          <div className="text-2xl font-semibold mt-1">
            {summary?.avgScore !== null && summary?.avgScore !== undefined
              ? summary.avgScore.toFixed(3)
              : '-'}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500">平均延迟(ms)</div>
          <div className="text-2xl font-semibold mt-1">{summary?.avgLatencyMs ?? '-'}</div>
        </div>
      </div>

      <section className="mb-6 bg-white border rounded-lg p-4">
        <h2 className="text-lg font-medium mb-3">版本快照</h2>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">Dataset Version</div>
            <div className="font-mono text-xs mt-1 break-all">
              {versionSnapshot?.datasetVersionId ?? '-'}
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">Target Version</div>
            <div className="font-mono text-xs mt-1 break-all">
              {versionSnapshot?.targetVersionId ?? '-'}
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500">Suite Version</div>
            <div className="font-mono text-xs mt-1 break-all">
              {versionSnapshot?.suiteVersionId ?? '-'}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-medium">回归集操作</h2>
          <div className="text-xs text-gray-500">
            选择一个现有数据集，或输入新回归集名称，然后在 Bad Case 或 Run Item 上直接执行操作
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">现有数据集</div>
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">不使用现有数据集</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name} ({dataset.item_count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">新回归集名称</div>
            <input
              value={newDatasetName}
              onChange={(e) => setNewDatasetName(e.target.value)}
              placeholder="留空则使用上面的现有数据集"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div className="text-xs text-gray-500 flex items-end">
            当前目标：
            <span className="ml-1 text-gray-700">
              {datasets.find((dataset) => dataset.id === selectedDatasetId)?.name ||
                newDatasetName ||
                '未选择'}
            </span>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-3">Bad Cases</h2>
        {badCases && badCases.failedItems === 0 ? (
          <div className="bg-white border rounded-lg p-6 text-center text-gray-500 text-sm">
            没有失败样例
          </div>
        ) : (
          <div className="space-y-3">
            {badCases?.targetErrors?.map((targetCase) => (
              <div key={targetCase.runItemId} className="bg-white border border-red-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">
                        Target 错误
                      </span>
                      <span className="text-sm font-mono text-gray-600">{targetCase.caseKey}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Trace：
                      {targetCase.traceId ? (
                        <Link to={`/traces/${targetCase.traceId}`} className="text-blue-600 hover:underline">
                          {targetCase.traceId}
                        </Link>
                      ) : (
                        ' -'
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAddToDataset(targetCase.runItemId)}
                      disabled={actionLoadingId === `dataset:${targetCase.runItemId}`}
                      className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      加入回归集
                    </button>
                    <button
                      onClick={() => handleRetryItem(targetCase.runItemId)}
                      disabled={actionLoadingId === `retry:${targetCase.runItemId}`}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                    >
                      单条重跑
                    </button>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500 mb-1">Input</div>
                    <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                      {formatSnapshotValue(targetCase.inputSnapshot)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Expected</div>
                    <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                      {formatSnapshotValue(targetCase.expectedSnapshot)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Raw Output</div>
                    <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                      {targetCase.targetOutput ?? '-'}
                    </pre>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Target Error</div>
                    <pre className="bg-red-50 border border-red-100 rounded p-3 whitespace-pre-wrap text-red-700">
                      {targetCase.targetError}
                    </pre>
                  </div>
                </div>
              </div>
            ))}

            {badCases?.byEvaluator?.map((group) => (
              <div key={group.evaluatorAlias} className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">{group.evaluatorAlias}</h3>
                  <span className="text-xs text-gray-500">失败 {group.failedCount}</span>
                </div>
                <div className="space-y-3">
                  {group.cases.map((failedCase) => (
                    <div key={failedCase.runItemId} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-gray-500">{failedCase.caseKey}</span>
                            {failedCase.score !== null && (
                              <span className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded">
                                分 {failedCase.score}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Trace：
                            {failedCase.traceId ? (
                              <Link
                                to={`/traces/${failedCase.traceId}`}
                                className="text-blue-600 hover:underline"
                              >
                                {failedCase.traceId}
                              </Link>
                            ) : (
                              ' -'
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAddToDataset(failedCase.runItemId)}
                            disabled={actionLoadingId === `dataset:${failedCase.runItemId}`}
                            className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-60"
                          >
                            加入回归集
                          </button>
                          <button
                            onClick={() => handleRetryItem(failedCase.runItemId)}
                            disabled={actionLoadingId === `retry:${failedCase.runItemId}`}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                          >
                            单条重跑
                          </button>
                        </div>
                      </div>

                      {failedCase.error && (
                        <div className="text-xs text-red-600 mb-3">{failedCase.error}</div>
                      )}

                      <div className="grid md:grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-gray-500 mb-1">Input</div>
                          <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                            {formatSnapshotValue(failedCase.inputSnapshot)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Expected</div>
                          <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                            {formatSnapshotValue(failedCase.expectedSnapshot)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Raw Output</div>
                          <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                            {failedCase.targetOutput ?? '-'}
                          </pre>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">评分理由</div>
                          <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                            {failedCase.reasoning ?? failedCase.rawOutput ?? '-'}
                          </pre>
                        </div>
                      </div>

                      {failedCase.targetError && (
                        <pre className="text-xs text-red-700 bg-red-50 border border-red-100 rounded p-3 mt-3 whitespace-pre-wrap">
                          {failedCase.targetError}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-medium">Run Items ({filteredItems.length})</h2>
          <div className="flex gap-2 text-sm flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 border rounded"
            >
              <option value="">全部状态</option>
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
              <option value="skipped">skipped</option>
            </select>
            <select
              value={passedFilter}
              onChange={(e) => setPassedFilter(e.target.value)}
              className="px-2 py-1 border rounded"
            >
              <option value="">全部通过情况</option>
              <option value="true">通过</option>
              <option value="false">未通过</option>
            </select>
            <select
              value={aliasFilter}
              onChange={(e) => setAliasFilter(e.target.value)}
              className="px-2 py-1 border rounded"
            >
              <option value="">全部 Evaluator</option>
              {aliases.map((alias) => (
                <option key={alias} value={alias}>
                  {alias}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Case</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">评分</th>
                <th className="px-3 py-2 text-left">Input / Expected</th>
                <th className="px-3 py-2 text-left">输出 / 错误</th>
                <th className="px-3 py-2 text-left">延迟</th>
                <th className="px-3 py-2 text-left">Trace</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <Fragment key={item.id}>
                  <tr className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{item.case_key}</div>
                      <div className="text-[11px] text-gray-400 mt-1">
                        DVI: {item.dataset_version_item_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColor(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        {item.scores.length === 0 && <span className="text-gray-400">-</span>}
                        {item.scores.map((score) => (
                          <div key={score.evaluator_alias} className="text-xs">
                            <span className="font-medium">{score.evaluator_alias}</span>
                            {score.score !== null && <span className="ml-1">{score.score.toFixed(2)}</span>}
                            <span
                              className={`ml-2 px-1.5 py-0.5 rounded ${
                                score.passed
                                  ? 'bg-green-50 text-green-700'
                                  : score.passed === false
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {score.passed === null ? '-' : score.passed ? 'PASS' : 'FAIL'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-sm">
                      <div className="text-xs text-gray-700 line-clamp-2">
                        {snapshotPreview(item.input_snapshot)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 line-clamp-2">
                        {snapshotPreview(item.expected_snapshot)}
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      {item.target_error ? (
                        <pre className="text-xs text-red-600 whitespace-pre-wrap">
                          {item.target_error}
                        </pre>
                      ) : (
                        <div className="text-xs text-gray-700 line-clamp-3">{item.target_output}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{item.latency_ms ?? '-'}</td>
                    <td className="px-3 py-2">
                      {item.trace_id ? (
                        <Link
                          to={`/traces/${item.trace_id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          查看
                        </Link>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
                        >
                          {expandedItemId === item.id ? '收起' : '详情'}
                        </button>
                        <button
                          onClick={() => handleAddToDataset(item.id)}
                          disabled={actionLoadingId === `dataset:${item.id}`}
                          className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-60"
                        >
                          加入回归集
                        </button>
                        <button
                          onClick={() => handleRetryItem(item.id)}
                          disabled={actionLoadingId === `retry:${item.id}`}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                        >
                          单条重跑
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedItemId === item.id && (
                    <tr className="border-t bg-gray-50/60">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid lg:grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="text-gray-500 mb-1">Input Snapshot</div>
                            <pre className="bg-white border rounded p-3 whitespace-pre-wrap">
                              {formatSnapshotValue(item.input_snapshot)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Expected Snapshot</div>
                            <pre className="bg-white border rounded p-3 whitespace-pre-wrap">
                              {formatSnapshotValue(item.expected_snapshot)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Target Output</div>
                            <pre className="bg-white border rounded p-3 whitespace-pre-wrap">
                              {item.target_output ?? '-'}
                            </pre>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Target Error</div>
                            <pre className="bg-white border rounded p-3 whitespace-pre-wrap">
                              {item.target_error ?? '-'}
                            </pre>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {item.scores.map((score) => (
                            <div key={`${item.id}:${score.evaluator_alias}`} className="bg-white border rounded p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium">{score.evaluator_alias}</span>
                                {score.score !== null && (
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                                    {score.score.toFixed(2)}
                                  </span>
                                )}
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    score.passed
                                      ? 'bg-green-50 text-green-700'
                                      : score.passed === false
                                      ? 'bg-red-50 text-red-700'
                                      : 'bg-gray-100 text-gray-500'
                                  }`}
                                >
                                  {score.passed === null ? '-' : score.passed ? 'PASS' : 'FAIL'}
                                </span>
                              </div>
                              <div className="grid lg:grid-cols-2 gap-3">
                                <div>
                                  <div className="text-gray-500 mb-1">评分理由</div>
                                  <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                                    {score.reasoning ?? score.error ?? '-'}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-gray-500 mb-1">Evaluator Raw Output</div>
                                  <pre className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
                                    {score.raw_output ?? '-'}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          ))}
                          {item.scores.length === 0 && (
                            <div className="text-xs text-gray-500">暂无评测结果</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                    无匹配的 Run Item
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">事件流 ({events.length})</h2>
        <div className="bg-white border rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
          {events.map((event) => (
            <div key={event.sequence} className="flex gap-3">
              <span className="text-gray-400 w-8 shrink-0">#{event.sequence}</span>
              <span className="text-blue-600 w-40 shrink-0">{event.event_type}</span>
              <span className="text-gray-700 break-all">
                {event.payload ? JSON.stringify(event.payload) : ''}
              </span>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
