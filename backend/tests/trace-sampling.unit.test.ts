import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';

/**
 * 复现 services/trace-sampling.ts 中的确定性采样算法，验证其统计特性。
 * 与实现保持一致：sha256(ruleId:traceId) 前 4 字节 / 2^32 < rate。
 * @param ruleId - 规则 ID
 * @param traceId - Trace ID
 * @param rate - 采样率
 * @returns 是否命中
 */
function hitByRate(ruleId: string, traceId: string, rate: number): boolean {
  if (rate >= 1) return true;
  const digest = createHash('sha256').update(`${ruleId}:${traceId}`).digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff;
  return bucket < rate;
}

describe('PR-13b：确定性采样率统计特性', () => {
  it('rate=1 时全部命中，rate 极小时几乎不命中', () => {
    const ruleId = 'rule-1';
    let allHit = true;
    let noneHit = true;
    for (let i = 0; i < 200; i += 1) {
      const traceId = `trace-${i}`;
      if (!hitByRate(ruleId, traceId, 1)) allHit = false;
      if (hitByRate(ruleId, traceId, 0.0001)) noneHit = false;
    }
    expect(allHit).toBe(true);
    expect(noneHit).toBe(true);
  });

  it('rate=0.5 时 1000 条 trace 的命中率落在 45%~55% 区间', () => {
    const ruleId = 'rule-half';
    let hits = 0;
    const total = 1000;
    for (let i = 0; i < total; i += 1) {
      if (hitByRate(ruleId, `trace-${i}`, 0.5)) hits += 1;
    }
    const ratio = hits / total;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  it('同一 (ruleId, traceId) 的采样决策稳定（重复评估结果一致）', () => {
    const first = hitByRate('rule-stable', 'trace-42', 0.3);
    for (let i = 0; i < 10; i += 1) {
      expect(hitByRate('rule-stable', 'trace-42', 0.3)).toBe(first);
    }
  });

  it('不同 ruleId 对同一 trace 的决策相互独立', () => {
    const traceId = 'trace-shared';
    const decisions = new Set<string>();
    for (let r = 0; r < 20; r += 1) {
      decisions.add(String(hitByRate(`rule-${r}`, traceId, 0.5)));
    }
    // 20 条不同规则下应同时出现 true 与 false 两种决策
    expect(decisions.size).toBe(2);
  });
});
