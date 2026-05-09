import { vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/api', () => ({
  api: {
    snapshots: {
      list: vi.fn(),
      get: vi.fn(),
    },
  },
}));

import { useSnapshotStore } from '@/stores/snapshotStore';
import { api } from '@/api';

const mockedApi = vi.mocked(api);

describe('SnapshotStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useSnapshotStore.setState({
        snapshots: [],
        currentSnapshot: null,
        isLoading: false,
        error: null,
      });
    });
  });

  describe('初始状态', () => {
    it('应该有正确的初始值', () => {
      const state = useSnapshotStore.getState();
      expect(state.snapshots).toEqual([]);
      expect(state.currentSnapshot).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('fetchSnapshots', () => {
    it('应该按 projectId 获取快照列表', async () => {
      const mockSnapshots = [
        { id: 's1', trigger_reason: 'manual' },
        { id: 's2', trigger_reason: 'breakpoint' },
      ];
      mockedApi.snapshots.list.mockResolvedValue({ snapshots: mockSnapshots } as any);

      await act(async () => {
        await useSnapshotStore.getState().fetchSnapshots('proj-1');
      });

      expect(useSnapshotStore.getState().snapshots).toEqual(mockSnapshots);
      expect(mockedApi.snapshots.list).toHaveBeenCalledWith({ projectId: 'proj-1' });
    });

    it('应该在获取失败时设置错误', async () => {
      mockedApi.snapshots.list.mockRejectedValue(new Error('Failed'));

      await act(async () => {
        await useSnapshotStore.getState().fetchSnapshots('proj-1');
      });

      expect(useSnapshotStore.getState().error).toBe('Failed');
      expect(useSnapshotStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchSnapshotsByBreakpoint', () => {
    it('应该按 breakpointId 获取快照列表', async () => {
      const mockSnapshots = [{ id: 's1', trigger_reason: 'breakpoint' }];
      mockedApi.snapshots.list.mockResolvedValue({ snapshots: mockSnapshots } as any);

      await act(async () => {
        await useSnapshotStore.getState().fetchSnapshotsByBreakpoint('bp-1');
      });

      expect(useSnapshotStore.getState().snapshots).toEqual(mockSnapshots);
      expect(mockedApi.snapshots.list).toHaveBeenCalledWith({ breakpointId: 'bp-1' });
    });
  });

  describe('fetchSnapshotById', () => {
    it('应该获取单个快照详情', async () => {
      const mockSnapshot = { id: 's1', trigger_reason: 'manual', state: { x: 1 } };
      mockedApi.snapshots.get.mockResolvedValue({ snapshot: mockSnapshot } as any);

      await act(async () => {
        await useSnapshotStore.getState().fetchSnapshotById('s1');
      });

      expect(useSnapshotStore.getState().currentSnapshot).toEqual(mockSnapshot);
    });

    it('应该在获取失败时设置错误', async () => {
      mockedApi.snapshots.get.mockRejectedValue(new Error('Not found'));

      await act(async () => {
        await useSnapshotStore.getState().fetchSnapshotById('nonexistent');
      });

      expect(useSnapshotStore.getState().error).toBe('Not found');
      expect(useSnapshotStore.getState().currentSnapshot).toBeNull();
    });
  });

  describe('clearCurrentSnapshot', () => {
    it('应该清除当前快照', () => {
      act(() => {
        useSnapshotStore.setState({ currentSnapshot: { id: 's1' } as any });
      });

      act(() => {
        useSnapshotStore.getState().clearCurrentSnapshot();
      });

      expect(useSnapshotStore.getState().currentSnapshot).toBeNull();
    });
  });
});
