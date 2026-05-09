import { vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/api', () => ({
  api: {
    traces: {
      list: vi.fn(),
    },
    stats: {
      get: vi.fn(),
    },
  },
}));

import { useTraceStore } from '@/stores/traceStore';
import { api } from '@/api';

const mockedApi = vi.mocked(api);

describe('TraceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useTraceStore.setState({
        traces: [],
        selectedTrace: null,
        stats: null,
        isLoading: false,
        error: null,
      });
    });
  });

  describe('初始状态', () => {
    it('应该有正确的初始值', () => {
      const state = useTraceStore.getState();
      expect(state.traces).toEqual([]);
      expect(state.selectedTrace).toBeNull();
      expect(state.stats).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('fetchTraces', () => {
    it('应该成功获取 traces', async () => {
      const mockTraces = [
        { id: 't1', name: 'trace-1', status: 'success' },
        { id: 't2', name: 'trace-2', status: 'error' },
      ];
      mockedApi.traces.list.mockResolvedValue({ traces: mockTraces } as any);

      await act(async () => {
        await useTraceStore.getState().fetchTraces('proj-1');
      });

      const state = useTraceStore.getState();
      expect(state.traces).toEqual(mockTraces);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockedApi.traces.list).toHaveBeenCalledWith('proj-1', { sessionId: undefined, limit: 100 });
    });

    it('应该支持按 sessionId 过滤', async () => {
      mockedApi.traces.list.mockResolvedValue({ traces: [] } as any);

      await act(async () => {
        await useTraceStore.getState().fetchTraces('proj-1', 'sess-1');
      });

      expect(mockedApi.traces.list).toHaveBeenCalledWith('proj-1', { sessionId: 'sess-1', limit: 100 });
    });

    it('应该在获取失败时设置错误', async () => {
      mockedApi.traces.list.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await useTraceStore.getState().fetchTraces('proj-1');
      });

      const state = useTraceStore.getState();
      expect(state.traces).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Network error');
    });
  });

  describe('fetchStats', () => {
    it('应该成功获取统计数据', async () => {
      const mockStats = { totalTraces: 100, totalSessions: 10 };
      mockedApi.stats.get.mockResolvedValue({ stats: mockStats } as any);

      await act(async () => {
        await useTraceStore.getState().fetchStats('proj-1');
      });

      expect(useTraceStore.getState().stats).toEqual(mockStats);
    });

    it('应该在获取失败时不崩溃', async () => {
      mockedApi.stats.get.mockRejectedValue(new Error('Failed'));

      await act(async () => {
        await useTraceStore.getState().fetchStats('proj-1');
      });

      // stats 保持 null，不抛错
      expect(useTraceStore.getState().stats).toBeNull();
    });
  });

  describe('selectTrace', () => {
    it('应该设置选中的 trace', () => {
      const trace = { id: 't1', name: 'trace-1' } as any;
      act(() => {
        useTraceStore.getState().selectTrace(trace);
      });
      expect(useTraceStore.getState().selectedTrace).toEqual(trace);
    });

    it('应该支持取消选中', () => {
      act(() => {
        useTraceStore.getState().selectTrace({ id: 't1' } as any);
      });
      act(() => {
        useTraceStore.getState().selectTrace(null);
      });
      expect(useTraceStore.getState().selectedTrace).toBeNull();
    });
  });

  describe('addTrace', () => {
    it('应该添加 trace 到列表头部', () => {
      const existing = { id: 't1', name: 'old', project_id: 'p1' } as any;
      const newTrace = { id: 't2', name: 'new', project_id: 'p1' } as any;

      act(() => {
        useTraceStore.setState({ traces: [existing] });
      });

      // Mock fetchStats since addTrace calls it
      mockedApi.stats.get.mockResolvedValue({ stats: {} } as any);

      act(() => {
        useTraceStore.getState().addTrace(newTrace);
      });

      const traces = useTraceStore.getState().traces;
      expect(traces[0]).toEqual(newTrace);
      expect(traces[1]).toEqual(existing);
    });

    it('应该限制列表最多 100 条', () => {
      const existingTraces = Array.from({ length: 100 }, (_, i) => ({
        id: `t${i}`,
        name: `trace-${i}`,
        project_id: 'p1',
      })) as any[];

      act(() => {
        useTraceStore.setState({ traces: existingTraces });
      });

      mockedApi.stats.get.mockResolvedValue({ stats: {} } as any);

      act(() => {
        useTraceStore.getState().addTrace({ id: 'new', name: 'new-trace', project_id: 'p1' } as any);
      });

      expect(useTraceStore.getState().traces.length).toBe(100);
      expect(useTraceStore.getState().traces[0].id).toBe('new');
    });
  });

  describe('reset', () => {
    it('应该重置所有状态', () => {
      act(() => {
        useTraceStore.setState({
          traces: [{ id: 't1' } as any],
          selectedTrace: { id: 't1' } as any,
          stats: { totalTraces: 10 } as any,
        });
      });

      act(() => {
        useTraceStore.getState().reset();
      });

      const state = useTraceStore.getState();
      expect(state.traces).toEqual([]);
      expect(state.selectedTrace).toBeNull();
      expect(state.stats).toBeNull();
    });
  });
});
