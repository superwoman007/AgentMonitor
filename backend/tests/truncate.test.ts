import { describe, it, expect } from 'vitest';
import { truncateJson } from '../src/utils/truncate.js';

describe('truncateJson', () => {
  describe('字符串截断', () => {
    it('超过 10000 字符的字符串应截断并保留提示', () => {
      const longStr = 'a'.repeat(10001);
      // 传入 maxBytes=1 强制进入截断分支
      const result = truncateJson(longStr, 1) as string;
      expect(result.startsWith('a'.repeat(10000))).toBe(true);
      expect(result).toContain('... [truncated, total: 10001 chars]');
    });

    it('正好 10000 字符的字符串在强制截断下应保留提示', () => {
      const exactStr = 'b'.repeat(10000);
      const result = truncateJson(exactStr, 1) as string;
      expect(result.startsWith('b'.repeat(10000))).toBe(true);
      expect(result).toContain('... [truncated, total: 10000 chars]');
    });

    it('小字符串在默认阈值下不应截断', () => {
      const str = 'hello world';
      expect(truncateJson(str)).toBe(str);
    });

    it('空字符串不应截断', () => {
      expect(truncateJson('')).toBe('');
    });
  });

  describe('数组截断', () => {
    it('超过 50 项应截断并保留 _truncated 标记', () => {
      const arr = Array.from({ length: 51 }, (_, i) => ({ id: i }));
      const result = truncateJson(arr) as any[];
      // 前 50 项保留，第 51 个位置为截断标记
      expect(result).toHaveLength(51);
      expect(result[49]).toEqual({ id: 49 });
      expect(result[50]).toEqual({ _truncated: true, total: 51 });
    });

    it('正好 50 项不应截断', () => {
      const arr = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const result = truncateJson(arr) as any[];
      expect(result).toHaveLength(50);
      expect(result[49]).toEqual({ id: 49 });
      expect(result[49]).not.toHaveProperty('_truncated');
    });

    it('不超过 50 项的小数组不应截断', () => {
      const arr = [1, 2, 3, 'hello'];
      expect(truncateJson(arr)).toEqual(arr);
    });

    it('超过 512KB 应截断并保留 _truncated 标记', () => {
      const bigItem = 'x'.repeat(1024 * 1024); // 约 1MB
      const arr = [bigItem, bigItem];
      const result = truncateJson(arr) as any[];
      const last = result[result.length - 1];
      expect(last).toEqual({ _truncated: true, total: 2 });
    });
  });

  describe('对象截断', () => {
    it('超过 50 个键应截断并保留 _truncated 和 _total', () => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        obj[`key${i}`] = `value${i}`;
      }
      const result = truncateJson(obj) as Record<string, unknown>;
      expect(result._truncated).toBe(true);
      expect(result._total).toBe(51);
      // 应保留前 50 个键 + _truncated + _total
      expect(Object.keys(result)).toHaveLength(52);
      expect(result.key0).toBe('value0');
      expect(result.key49).toBe('value49');
      expect(result.key50).toBeUndefined();
    });

    it('正好 50 个键不应截断', () => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        obj[`key${i}`] = `value${i}`;
      }
      const result = truncateJson(obj) as Record<string, unknown>;
      expect(result._truncated).toBeUndefined();
      expect(Object.keys(result)).toHaveLength(50);
    });

    it('不超过 50 个键的小对象不应截断', () => {
      const obj = { a: 1, b: 'hello', c: [1, 2, 3], d: { nested: true } };
      expect(truncateJson(obj)).toEqual(obj);
    });

    it('超过 512KB 应截断并保留 _truncated 和 _total', () => {
      const obj = { a: 'x'.repeat(1024 * 1024) };
      const result = truncateJson(obj) as Record<string, unknown>;
      expect(result._truncated).toBe(true);
      expect(result._total).toBe(1);
    });
  });

  describe('边界与组合场景', () => {
    it('嵌套小对象在默认阈值下不应截断', () => {
      const data = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        meta: { page: 1, total: 2 },
      };
      expect(truncateJson(data)).toEqual(data);
    });

    it('null 值不应截断', () => {
      expect(truncateJson(null)).toBeNull();
    });

    it('undefined 值不应截断', () => {
      expect(truncateJson(undefined)).toBeUndefined();
    });

    it('数字值不应截断', () => {
      expect(truncateJson(42)).toBe(42);
    });

    it('布尔值不应截断', () => {
      expect(truncateJson(true)).toBe(true);
    });

    it('空数组不应截断', () => {
      expect(truncateJson([])).toEqual([]);
    });

    it('空对象不应截断', () => {
      expect(truncateJson({})).toEqual({});
    });
  });
});
