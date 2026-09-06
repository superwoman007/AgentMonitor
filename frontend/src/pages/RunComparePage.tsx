import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { api, V2Run, V2RunComparison } from '../api';

/**
 * 按分类渲染一组 caseKey 列表。
 */
function CaseGroup({
  title,
  cases,
  tone,
}: {
  title: string;
  cases: string[];
  tone: 'green' | 'red' | 'amber' | 'gray';
}) {
  const colors: Record<string, string> = {
    green: 'border-green-200 bg-green-50',
    red: 'border-red-200 bg-red-50',
    amber: 'border-amber-200 bg-amber-50',
    gray: 'border-gray-200 bg-gray-50',
  };
  return (
    <div className={`border rounded-lg p-4 ${colors[tone]}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">{title}</h3>
        <span className="text-sm text-gray-600">{cases.length}</span>
      </div>
      {cases.length === 0 ? (
        <div className="text-sm text-gray-500">无</div>
      ) : (
        <ul className="text-sm font-mono space-y-1 max-h-64 overflow-y-auto">
          {cases.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * PR-11 Run 对比页：选择基线 Run 与候选 Run，展示 fixed / regressed /
 * still-failing / new-failed 四类 case 以及通过率变化。
 */
export function RunComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [experimentId, setExperimentId] = useState(searchParams.get('experimentId') ?? '');
  const [runs, setRuns] = useState<V2Run[]>([]);
  const [baseline, setBaseline] = useState(searchParams.get('baseline') ?? '');
  const [candidate, setCandidate] = useState(searchParams.get('candidate') ?? '');
  const [result, setResult] = useState<V2RunComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 按实验 ID 拉取该实验下的所有 Run。
   */
  const loadRuns = async () => {
    if (!experimentId.trim()) return;
    setError(null);
    try {
      const res = await api.runsV2.listByExperiment(experimentId.trim());
      const sorted = [...res.runs].sort((a, b) => b.run_number - a.run_number);
      setRuns(sorted);
      // 未显式选择时，默认填充最新两次 Run 作为基线 / 候选
      if (sorted.length >= 2) {
        if (!baseline) setBaseline(sorted[1].id);
        if (!candidate) setCandidate(sorted[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * 执行对比请求。
   */
  const runCompare = async () => {
    if (!baseline || !candidate) {
      setError('请同时选择基线 Run 与候选 Run');
      return;
    }
    if (baseline === candidate) {
      setError('基线 Run 与候选 Run 不能相同');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.runsV2.compare(baseline, candidate);
      setResult(res);
      setSearchParams({ baseline, candidate });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (experimentId.trim()) {
      loadRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当 loadRuns 自动填充最新两个 Run 后触发一次对比
  useEffect(() => {
    if (baseline && candidate && !result) {
      runCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, candidate]);

  const passRate = (s: V2Run['summary']): string => {
    if (!s || s.totalItems === 0) return '-';
    return `${((s.passedItems / s.totalItems) * 100).toFixed(1)}%`;
  };

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/evaluation" className="text-sm text-blue-600 hover:underline">
          ← 返回实验
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Run 对比</h1>

      <div className="bg-white border rounded-lg p-4 mb-6 space-y-4">
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="输入实验 ID 以加载其 Run 列表"
            value={experimentId}
            onChange={(e) => setExperimentId(e.target.value)}
            className="flex-1 min-w-[280px] px-3 py-2 border rounded-lg text-sm"
          />
          <button
            onClick={loadRuns}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
          >
            加载 Run
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">基线 Run</label>
            <select
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">-- 选择基线 Run --</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.run_number} · {r.status} · {passRate(r.summary)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">候选 Run</label>
            <select
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">-- 选择候选 Run --</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.run_number} · {r.status} · {passRate(r.summary)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={runCompare}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {loading ? '对比中...' : '开始对比'}
          </button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border rounded-lg p-4">
              <div className="text-xs text-gray-500">基线通过率</div>
              <div className="text-xl font-semibold mt-1">
                {passRate(result.baseline.summary)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {result.baseline.summary?.passedItems ?? 0}/
                {result.baseline.summary?.totalItems ?? 0}
              </div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-xs text-gray-500">候选通过率</div>
              <div className="text-xl font-semibold mt-1">
                {passRate(result.candidate.summary)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {result.candidate.summary?.passedItems ?? 0}/
                {result.candidate.summary?.totalItems ?? 0}
              </div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-xs text-gray-500">通过率变化</div>
              <div
                className={`text-xl font-semibold mt-1 ${
                  result.passRateDelta === null
                    ? 'text-gray-500'
                    : result.passRateDelta >= 0
                    ? 'text-green-700'
                    : 'text-red-700'
                }`}
              >
                {result.passRateDelta === null
                  ? '-'
                  : `${result.passRateDelta >= 0 ? '+' : ''}${(result.passRateDelta * 100).toFixed(2)}%`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CaseGroup title="✅ 已修复（Fixed）" cases={result.fixedCases} tone="green" />
            <CaseGroup
              title="⚠️ 新回归（Regressed）"
              cases={result.regressedCases}
              tone="red"
            />
            <CaseGroup
              title="❌ 仍然失败（Still Failing）"
              cases={result.stillFailing}
              tone="amber"
            />
            <CaseGroup
              title="🆕 新增失败（New Failed）"
              cases={result.newFailed}
              tone="gray"
            />
          </div>
        </>
      )}
    </Layout>
  );
}
