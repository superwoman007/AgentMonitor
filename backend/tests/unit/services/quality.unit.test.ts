import { calculateQualityScore, calculateSpeedScore, calculateSuccessScore } from '../../../src/services/quality.js';

describe('Quality Service 纯函数', () => {
  describe('calculateSpeedScore', () => {
    it('应该对 null 延迟返回 50', () => {
      expect(calculateSpeedScore(null)).toBe(50);
    });

    it('应该对 <500ms 延迟返回 100', () => {
      expect(calculateSpeedScore(0)).toBe(100);
      expect(calculateSpeedScore(100)).toBe(100);
      expect(calculateSpeedScore(499)).toBe(100);
    });

    it('应该对 500-2000ms 延迟返回 80', () => {
      expect(calculateSpeedScore(500)).toBe(80);
      expect(calculateSpeedScore(1000)).toBe(80);
      expect(calculateSpeedScore(1999)).toBe(80);
    });

    it('应该对 2000-5000ms 延迟返回 50', () => {
      expect(calculateSpeedScore(2000)).toBe(50);
      expect(calculateSpeedScore(3500)).toBe(50);
      expect(calculateSpeedScore(4999)).toBe(50);
    });

    it('应该对 >=5000ms 延迟返回 20', () => {
      expect(calculateSpeedScore(5000)).toBe(20);
      expect(calculateSpeedScore(10000)).toBe(20);
      expect(calculateSpeedScore(99999)).toBe(20);
    });
  });

  describe('calculateSuccessScore', () => {
    it('应该对 success 状态返回 100', () => {
      expect(calculateSuccessScore('success')).toBe(100);
    });

    it('应该对非 success 状态返回 0', () => {
      expect(calculateSuccessScore('error')).toBe(0);
      expect(calculateSuccessScore('pending')).toBe(0);
      expect(calculateSuccessScore('failed')).toBe(0);
      expect(calculateSuccessScore('')).toBe(0);
    });
  });

  describe('calculateQualityScore', () => {
    it('应该对快速成功的 trace 返回高分', () => {
      const trace = { latency_ms: 100, status: 'success' } as any;
      // speedScore=100, successScore=100 → 100*0.6 + 100*0.4 = 100
      expect(calculateQualityScore(trace)).toBe(100);
    });

    it('应该对快速失败的 trace 返回中等分', () => {
      const trace = { latency_ms: 100, status: 'error' } as any;
      // speedScore=100, successScore=0 → 100*0.6 + 0*0.4 = 60
      expect(calculateQualityScore(trace)).toBe(60);
    });

    it('应该对慢速成功的 trace 返回中等分', () => {
      const trace = { latency_ms: 6000, status: 'success' } as any;
      // speedScore=20, successScore=100 → 20*0.6 + 100*0.4 = 52
      expect(calculateQualityScore(trace)).toBe(52);
    });

    it('应该对慢速失败的 trace 返回低分', () => {
      const trace = { latency_ms: 6000, status: 'error' } as any;
      // speedScore=20, successScore=0 → 20*0.6 + 0*0.4 = 12
      expect(calculateQualityScore(trace)).toBe(12);
    });

    it('应该对 null 延迟的成功 trace 返回合理分数', () => {
      const trace = { latency_ms: null, status: 'success' } as any;
      // speedScore=50, successScore=100 → 50*0.6 + 100*0.4 = 70
      expect(calculateQualityScore(trace)).toBe(70);
    });

    it('应该对中等延迟的 trace 正确计算加权分', () => {
      const trace = { latency_ms: 1500, status: 'success' } as any;
      // speedScore=80, successScore=100 → 80*0.6 + 100*0.4 = 88
      expect(calculateQualityScore(trace)).toBe(88);
    });
  });
});
