import { describe, expect, it } from 'vitest';
import {
  EvaluatorSuiteVersion,
  aggregateScores,
} from '../src/services/evaluator-suite.js';
import { EvaluatorSuiteMember } from '../src/services/evaluator-suite.js';

function buildVersion(overrides: Partial<EvaluatorSuiteVersion['aggregation_config']> = {}): EvaluatorSuiteVersion {
  return {
    id: 'sv-1',
    suite_id: 's-1',
    version_number: 1,
    description: null,
    aggregation_config: {
      strategy: 'weighted_avg',
      passThreshold: 0.8,
      ...overrides,
    },
    created_by: null,
    created_at: new Date(),
  };
}

function buildMembers(): EvaluatorSuiteMember[] {
  return [
    {
      id: 'm-1', suite_version_id: 'sv-1', evaluator_version_id: 'ev-1',
      alias: 'accuracy', weight: 2, required: true, pass_threshold: 0.7, ordinal: 0,
    },
    {
      id: 'm-2', suite_version_id: 'sv-1', evaluator_version_id: 'ev-2',
      alias: 'style', weight: 1, required: false, pass_threshold: null, ordinal: 1,
    },
  ];
}

describe('Evaluator Suite 聚合规则 (PR-07)', () => {
  it('weighted_avg：按权重计算综合分并与 passThreshold 比较', () => {
    const result = aggregateScores(buildVersion({ strategy: 'weighted_avg', passThreshold: 0.8 }), buildMembers(), [
      { alias: 'accuracy', score: 0.9 },
      { alias: 'style', score: 0.6 },
    ]);
    // (0.9*2 + 0.6*1) / 3 = 0.8
    expect(result.compositeScore).toBeCloseTo(0.8, 5);
    expect(result.passed).toBe(true);
    expect(result.perAlias.accuracy.passed).toBe(true);
    // style 0.6 低于版本阈值 0.8，故 alias 级别失败；但加权综合分仍通过
    expect(result.perAlias.style.passed).toBe(false);
  });

  it('weighted_avg：低于阈值时失败并返回原因', () => {
    const result = aggregateScores(buildVersion({ strategy: 'weighted_avg', passThreshold: 0.95 }), buildMembers(), [
      { alias: 'accuracy', score: 0.5 },
      { alias: 'style', score: 0.5 },
    ]);
    expect(result.compositeScore).toBeCloseTo(0.5, 5);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('threshold');
  });

  it('all_required：必须通过所有必填评估器，非必填失败不阻塞', () => {
    const result = aggregateScores(buildVersion({ strategy: 'all_required' }), buildMembers(), [
      { alias: 'accuracy', score: 0.9, passed: true },
      { alias: 'style', score: 0.1, passed: false },
    ]);
    expect(result.passed).toBe(true);
  });

  it('all_required：必填评估器失败时整体失败', () => {
    const result = aggregateScores(buildVersion({ strategy: 'all_required' }), buildMembers(), [
      { alias: 'accuracy', score: 0.1, passed: false },
      { alias: 'style', score: 1.0, passed: true },
    ]);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('required');
  });

  it('any_pass：任一评估器通过即整体通过', () => {
    const result = aggregateScores(buildVersion({ strategy: 'any_pass' }), buildMembers(), [
      { alias: 'accuracy', score: 0.0, passed: false },
      { alias: 'style', score: 1.0, passed: true },
    ]);
    expect(result.passed).toBe(true);
  });

  it('未提供分数的成员按未通过处理（score 为 null）', () => {
    const result = aggregateScores(buildVersion({ strategy: 'all_required' }), buildMembers(), [
      { alias: 'style', score: 1.0, passed: true },
    ]);
    expect(result.passed).toBe(false);
    expect(result.perAlias.accuracy.score).toBeNull();
    expect(result.perAlias.accuracy.passed).toBe(false);
  });

  it('成员级别 pass_threshold 优先于版本级阈值', () => {
    const result = aggregateScores(buildVersion({ strategy: 'weighted_avg', passThreshold: 0.99 }), buildMembers(), [
      { alias: 'accuracy', score: 0.75 },
      { alias: 'style', score: 1.0 },
    ]);
    // accuracy 自身阈值 0.7，故 0.75 通过；style 走版本阈值 0.99，1.0 通过
    expect(result.perAlias.accuracy.passed).toBe(true);
    expect(result.perAlias.style.passed).toBe(true);
  });
});
