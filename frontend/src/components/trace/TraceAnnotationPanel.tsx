import { useCallback, useEffect, useState } from 'react';
import { api, TraceAnnotation } from '../../api';
import { useProjectStore } from '../../stores/projectStore';

/**
 * 根因中文标签。
 */
const ROOT_CAUSE_LABELS: Record<string, string> = {
  prompt: 'Prompt 提示词',
  model: '模型能力',
  tool: '工具调用',
  retrieval: '检索',
  data: '业务数据',
  evaluator: 'Evaluator 误判',
  unknown: '未知',
};

/**
 * 结论中文标签。
 */
const VERDICT_LABELS: Record<string, { label: string; tone: string }> = {
  good: { label: '符合预期', tone: 'bg-green-100 text-green-700' },
  bad: { label: '存在问题', tone: 'bg-red-100 text-red-700' },
  uncertain: { label: '无法判断', tone: 'bg-gray-100 text-gray-700' },
};

interface Props {
  traceId: string;
}

/**
 * Trace 人工标注面板：根因分类、结论、备注。
 * 同一 Trace 唯一，PUT 为 UPSERT。用于 Bad Case 根因聚类分析。
 */
export function TraceAnnotationPanel({ traceId }: Props) {
  const { currentProject } = useProjectStore();
  const [enums, setEnums] = useState<{ rootCauses: string[]; verdicts: string[] }>({
    rootCauses: [],
    verdicts: [],
  });
  const [annotation, setAnnotation] = useState<TraceAnnotation | null>(null);
  const [rootCause, setRootCause] = useState<string>('');
  const [verdict, setVerdict] = useState<string>('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.traceAnnotations.enums().then(setEnums).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!currentProject) return;
    const res = await api.traceAnnotations.get(traceId, currentProject.id);
    if (res?.annotation) {
      const a = res.annotation;
      setAnnotation(a);
      setRootCause(a.root_cause ?? '');
      setVerdict(a.verdict ?? '');
      setNote(a.note ?? '');
      setTags((a.tags ?? []).join(', '));
    } else {
      setAnnotation(null);
    }
  }, [currentProject, traceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 保存标注。
   */
  const handleSave = async () => {
    if (!currentProject) return;
    setSaving(true);
    try {
      const res = await api.traceAnnotations.save(traceId, {
        projectId: currentProject.id,
        rootCause: rootCause || null,
        verdict: verdict || null,
        note: note || null,
        tags: tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setAnnotation(res.annotation);
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存标注失败');
    } finally {
      setSaving(false);
    }
  };

  /**
   * 删除标注。
   */
  const handleDelete = async () => {
    if (!currentProject || !confirm('确认删除该标注？')) return;
    await api.traceAnnotations.remove(traceId, currentProject.id);
    setAnnotation(null);
    setRootCause('');
    setVerdict('');
    setNote('');
    setTags('');
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">人工标注</h2>
        {annotation && (
          <span className="text-xs text-gray-400">
            更新于 {new Date(annotation.updated_at).toLocaleString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">结论</label>
          <div className="flex gap-1.5 flex-wrap">
            {enums.verdicts.map((v) => {
              const meta = VERDICT_LABELS[v];
              const active = verdict === v;
              return (
                <button
                  key={v}
                  onClick={() => setVerdict(active ? '' : v)}
                  className={`px-2.5 py-1 rounded text-xs border ${
                    active
                      ? meta?.tone ?? 'bg-blue-100 text-blue-700 border-blue-300'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {meta?.label ?? v}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">根因分类</label>
          <select
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            className="w-full px-2.5 py-1.5 border rounded text-sm"
          >
            <option value="">-- 未分类 --</option>
            {enums.rootCauses.map((c) => (
              <option key={c} value={c}>
                {ROOT_CAUSE_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs text-gray-600 mb-1">备注</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full px-2.5 py-1.5 border rounded text-sm"
          placeholder="问题描述、复现步骤、修复建议…"
        />
      </div>

      <div className="mt-3">
        <label className="block text-xs text-gray-600 mb-1">标签（逗号分隔）</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full px-2.5 py-1.5 border rounded text-sm"
          placeholder="如：回归, v2.1, 退款场景"
        />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {annotation && (
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
          >
            删除标注
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !currentProject}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存标注'}
        </button>
      </div>
    </div>
  );
}
