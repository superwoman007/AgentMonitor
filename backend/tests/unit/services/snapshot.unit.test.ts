import {
  parseJsonIfString,
  parseDateIfString,
  normalizeSnapshot,
  type SnapshotRow,
} from '../../../src/services/snapshot.js';

describe('Snapshot Service 纯函数', () => {
  describe('parseJsonIfString', () => {
    it('应该解析有效 JSON 对象字符串', () => {
      expect(parseJsonIfString('{"a":1}')).toEqual({ a: 1 });
    });

    it('应该解析有效 JSON 数组字符串', () => {
      expect(parseJsonIfString('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('应该解析 JSON 字符串值', () => {
      expect(parseJsonIfString('"hello"')).toBe('hello');
    });

    it('应该原样返回非字符串值', () => {
      const obj = { a: 1 };
      expect(parseJsonIfString(obj)).toBe(obj);
      expect(parseJsonIfString(null)).toBe(null);
      expect(parseJsonIfString(undefined)).toBe(undefined);
      expect(parseJsonIfString(42)).toBe(42);
    });

    it('应该对空字符串返回原值', () => {
      expect(parseJsonIfString('')).toBe('');
    });

    it('应该对非 JSON 开头的字符串返回原值', () => {
      expect(parseJsonIfString('hello')).toBe('hello');
      expect(parseJsonIfString('123abc')).toBe('123abc');
    });

    it('应该对无效 JSON 返回原字符串', () => {
      expect(parseJsonIfString('{invalid}')).toBe('{invalid}');
      expect(parseJsonIfString('[broken')).toBe('[broken');
    });
  });

  describe('parseDateIfString', () => {
    it('应该原样返回 Date 对象', () => {
      const date = new Date('2024-01-15T10:00:00Z');
      expect(parseDateIfString(date)).toBe(date);
    });

    it('应该解析有效日期字符串', () => {
      const result = parseDateIfString('2024-01-15T10:00:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });

    it('应该解析 ISO 日期字符串', () => {
      const result = parseDateIfString('2024-06-20');
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
    });

    it('应该对无效日期字符串返回当前时间', () => {
      const before = Date.now();
      const result = parseDateIfString('not-a-date');
      const after = Date.now();
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('应该对非字符串非 Date 值返回当前时间', () => {
      const before = Date.now();
      const result = parseDateIfString(null);
      const after = Date.now();
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('normalizeSnapshot', () => {
    it('应该正确规范化快照行', () => {
      const row: SnapshotRow = {
        id: 'snap-1',
        session_id: 'sess-1',
        breakpoint_id: null,
        trigger_reason: 'manual',
        state: '{"variables":{"x":1}}',
        timestamp: '2024-01-15T10:00:00Z',
        created_at: '2024-01-15T10:00:00Z',
      };

      const result = normalizeSnapshot(row);
      expect(result.id).toBe('snap-1');
      expect(result.session_id).toBe('sess-1');
      expect(result.state).toEqual({ variables: { x: 1 } });
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('应该处理已经是对象的 state', () => {
      const row: SnapshotRow = {
        id: 'snap-2',
        session_id: 'sess-1',
        breakpoint_id: 'bp-1',
        trigger_reason: 'breakpoint',
        state: { step: 'after_tool_call' },
        timestamp: new Date('2024-01-15'),
        created_at: new Date('2024-01-15'),
      };

      const result = normalizeSnapshot(row);
      expect(result.state).toEqual({ step: 'after_tool_call' });
    });

    it('应该处理双重 JSON 编码的 state', () => {
      const innerJson = JSON.stringify({ x: 1 });
      const doubleEncoded = JSON.stringify(innerJson);

      const row: SnapshotRow = {
        id: 'snap-3',
        session_id: 'sess-1',
        breakpoint_id: null,
        trigger_reason: 'test',
        state: doubleEncoded,
        timestamp: '2024-01-15T10:00:00Z',
        created_at: '2024-01-15T10:00:00Z',
      };

      const result = normalizeSnapshot(row);
      expect(result.state).toEqual({ x: 1 });
    });

    it('应该对非对象 state 包装为 { raw: value }', () => {
      const row: SnapshotRow = {
        id: 'snap-4',
        session_id: 'sess-1',
        breakpoint_id: null,
        trigger_reason: 'test',
        state: 'plain-string-not-json',
        timestamp: '2024-01-15T10:00:00Z',
        created_at: '2024-01-15T10:00:00Z',
      };

      const result = normalizeSnapshot(row);
      expect(result.state).toEqual({ raw: 'plain-string-not-json' });
    });

    it('应该对 null state 包装为 { raw: null }', () => {
      const row: SnapshotRow = {
        id: 'snap-5',
        session_id: 'sess-1',
        breakpoint_id: null,
        trigger_reason: 'test',
        state: null,
        timestamp: '2024-01-15T10:00:00Z',
        created_at: '2024-01-15T10:00:00Z',
      };

      const result = normalizeSnapshot(row);
      expect(result.state).toEqual({ raw: null });
    });
  });
});
