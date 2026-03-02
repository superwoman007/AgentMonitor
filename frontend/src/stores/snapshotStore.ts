import { create } from 'zustand';
import { api, Snapshot } from '../api';

interface SnapshotState {
  snapshots: Snapshot[];
  currentSnapshot: Snapshot | null;
  isLoading: boolean;
  error: string | null;
  fetchSnapshots: (projectId: string) => Promise<void>;
  fetchSnapshotsByBreakpoint: (breakpointId: string) => Promise<void>;
  fetchSnapshotById: (id: string) => Promise<void>;
  clearCurrentSnapshot: () => void;
}

export const useSnapshotStore = create<SnapshotState>((set) => ({
  snapshots: [],
  currentSnapshot: null,
  isLoading: false,
  error: null,

  fetchSnapshots: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const { snapshots } = await api.snapshots.list({ projectId });
      set({ snapshots, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch snapshots';
      set({ error: message, isLoading: false });
    }
  },

  fetchSnapshotsByBreakpoint: async (breakpointId: string) => {
    set({ isLoading: true, error: null });
    try {
      const { snapshots } = await api.snapshots.list({ breakpointId });
      set({ snapshots, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch snapshots';
      set({ error: message, isLoading: false });
    }
  },

  fetchSnapshotById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const { snapshot } = await api.snapshots.get(id);
      set({ currentSnapshot: snapshot, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch snapshot';
      set({ error: message, isLoading: false });
    }
  },

  clearCurrentSnapshot: () => {
    set({ currentSnapshot: null });
  },
}));
