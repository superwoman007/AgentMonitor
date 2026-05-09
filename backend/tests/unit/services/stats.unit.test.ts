import { toInt, toFloat } from '../../../src/services/stats.js';

describe('Stats Service 纯函数', () => {
  describe('toInt', () => {
    it('应该转换有效数字', () => {
      expect(toInt(42)).toBe(42);
      expect(toInt(3.7)).toBe(3);
      expect(toInt(-5.9)).toBe(-5);
    });

    it('应该转换有效数字字符串', () => {
      expect(toInt('42')).toBe(42);
      expect(toInt('100')).toBe(100);
      expect(toInt('0')).toBe(0);
      expect(toInt('-10')).toBe(-10);
    });

    it('应该对无效值返回 fallback', () => {
      expect(toInt(null)).toBe(0);
      expect(toInt(undefined)).toBe(0);
      expect(toInt('abc')).toBe(0);
      expect(toInt('')).toBe(0);
      expect(toInt(NaN)).toBe(0);
      expect(toInt(Infinity)).toBe(0);
    });

    it('应该支持自定义 fallback', () => {
      expect(toInt(null, -1)).toBe(-1);
      expect(toInt('abc', 99)).toBe(99);
      expect(toInt(undefined, 5)).toBe(5);
    });

    it('应该截断浮点数字符串', () => {
      expect(toInt('3.14')).toBe(3);
      expect(toInt('99.99')).toBe(99);
    });

    it('应该处理对象和数组', () => {
      expect(toInt({})).toBe(0);
      expect(toInt([])).toBe(0);
      expect(toInt(true)).toBe(0);
    });
  });

  describe('toFloat', () => {
    it('应该转换有效数字', () => {
      expect(toFloat(3.14)).toBe(3.14);
      expect(toFloat(42)).toBe(42);
      expect(toFloat(0)).toBe(0);
      expect(toFloat(-1.5)).toBe(-1.5);
    });

    it('应该转换有效数字字符串', () => {
      expect(toFloat('3.14')).toBe(3.14);
      expect(toFloat('42')).toBe(42);
      expect(toFloat('0')).toBe(0);
      expect(toFloat('-1.5')).toBe(-1.5);
    });

    it('应该对 null/undefined 返回 null', () => {
      expect(toFloat(null)).toBeNull();
      expect(toFloat(undefined)).toBeNull();
    });

    it('应该对无效字符串返回 null', () => {
      expect(toFloat('abc')).toBeNull();
      expect(toFloat('')).toBeNull();
      expect(toFloat('not-a-number')).toBeNull();
    });

    it('应该对 NaN/Infinity 返回 null', () => {
      expect(toFloat(NaN)).toBeNull();
      expect(toFloat(Infinity)).toBeNull();
      expect(toFloat(-Infinity)).toBeNull();
    });

    it('应该对非数字类型返回 null', () => {
      expect(toFloat({})).toBeNull();
      expect(toFloat([])).toBeNull();
      expect(toFloat(true)).toBeNull();
    });
  });
});
