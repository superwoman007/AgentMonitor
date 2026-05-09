import { vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/api', () => ({
  api: {
    breakpoints: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      toggle: vi.fn(),
    },
  },
}));

import { useBreakpointStore } from '@/stores/breakpointStore';
import { api } from '@/api';

const mockedApi = vi.mocked(api);

describe('BreakpointStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useBreakpointStore.setState({
        breakpoints: [],
        isLoading: false,
        error: null,
      });
    });
  });

  describe('fetchBreakpoints', () => {
    it('应该成功获取断点列表', async () => {
      const mockBps = [
        { id: 'bp1', name: 'keyword-bp', type: 'keyword', enabled: true },
        { id: 'bp2', name: 'error-bp', type: 'error', enabled: false },
      ];
      mockedApi.breakpoints.list.mockResolvedValue({ breakpoints: mockBps } as any);

      await act(async () => {
        await useBreakpointStore.getState().fetchBreakpoints('proj-1');
      });

      const state = useBreakpointStore.getState();
      expect(state.breakpoints).toEqual(mockBps);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('应该在获取失败时设置错误', async () => {
      mockedApi.breakpoints.list.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await useBreakpointStore.getState().fetchBreakpoints('proj-1');
      });

      expect(useBreakpointStore.getState().error).toBe('Network error');
      expect(useBreakpointStore.getState().isLoading).toBe(false);
    });
  });

  describe('createBreakpoint', () => {
    it('应该创建断点并添加到列表', async () => {
      const newBp = { id: 'bp-new', name: 'new-bp', type: 'latency', enabled: true };
      mockedApi.breakpoints.create.mockResolvedValue({ breakpoint: newBp } as any);

      await act(async () => {
        const result = await useBreakpointStore.getState().createBreakpoint('proj-1', {
          name: 'new-bp',
          type: 'latency',
          condition: '1000',
        });
        expect(result).toEqual(newBp);
      });

      expect(useBreakpointStore.getState().breakpoints).toContainEqual(newBp);
    });

    it('应该在创建失败时设置错误并抛出', async () => {
      mockedApi.breakpoints.create.mockRejectedValue(new Error('Validation error'));

      await act(async () => {
        await expect(
          useBreakpointStore.getState().createBreakpoint('proj-1', {
            name: '',
            type: 'keyword',
            condition: '',
          })
        ).rejects.toThrow('Validation error');
      });

      expect(useBreakpointStore.getState().error).toBe('Validation error');
    });
  });

  describe('updateBreakpoint', () => {
    it('应该更新列表中的断点', async () => {
      const original = { id: 'bp1', name: 'old', type: 'keyword', enabled: true };
      const updated = { id: 'bp1', name: 'updated', type: 'keyword', enabled: true };

      act(() => {
        useBreakpointStore.setState({ breakpoints: [original as any] });
      });

      mockedApi.breakpoints.update.mockResolvedValue({ breakpoint: updated } as any);

      await act(async () => {
        await useBreakpointStore.getState().updateBreakpoint('bp1', { name: 'updated' });
      });

      expect(useBreakpointStore.getState().breakpoints[0]).toEqual(updated);
    });
  });

  describe('deleteBreakpoint', () => {
    it('应该从列表中移除断点', async () => {
      act(() => {
        useBreakpointStore.setState({
          breakpoints: [
            { id: 'bp1', name: 'keep' } as any,
            { id: 'bp2', name: 'delete' } as any,
          ],
        });
      });

      mockedApi.breakpoints.delete.mockResolvedValue(undefined as any);

      await act(async () => {
        await useBreakpointStore.getState().deleteBreakpoint('bp2');
      });

      const bps = useBreakpointStore.getState().breakpoints;
      expect(bps.length).toBe(1);
      expect(bps[0].id).toBe('bp1');
    });
  });

  describe('toggleBreakpoint', () => {
    it('应该切换断点启用状态', async () => {
      const bp = { id: 'bp1', name: 'test', enabled: true };
      const toggled = { id: 'bp1', name: 'test', enabled: false };

      act(() => {
        useBreakpointStore.setState({ breakpoints: [bp as any] });
      });

      mockedApi.breakpoints.toggle.mockResolvedValue({ breakpoint: toggled } as any);

      await act(async () => {
        await useBreakpointStore.getState().toggleBreakpoint('bp1');
      });

      expect(useBreakpointStore.getState().breakpoints[0].enabled).toBe(false);
    });
  });
});
