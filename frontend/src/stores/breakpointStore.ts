import { create } from 'zustand';
import { api, Breakpoint } from '../api';

interface BreakpointState {
  breakpoints: Breakpoint[];
  isLoading: boolean;
  error: string | null;
  fetchBreakpoints: (projectId: string) => Promise<void>;
  createBreakpoint: (projectId: string, data: {
    name: string;
    type: 'keyword' | 'error' | 'latency' | 'custom';
    condition: string;
    enabled?: boolean;
  }) => Promise<Breakpoint>;
  updateBreakpoint: (id: string, data: {
    name?: string;
    type?: 'keyword' | 'error' | 'latency' | 'custom';
    condition?: string;
    enabled?: boolean;
  }) => Promise<void>;
  deleteBreakpoint: (id: string) => Promise<void>;
  toggleBreakpoint: (id: string) => Promise<void>;
}

export const useBreakpointStore = create<BreakpointState>((set) => ({
  breakpoints: [],
  isLoading: false,
  error: null,

  fetchBreakpoints: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const { breakpoints } = await api.breakpoints.list(projectId);
      set({ breakpoints, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch breakpoints';
      set({ error: message, isLoading: false });
    }
  },

  createBreakpoint: async (projectId: string, data) => {
    set({ isLoading: true, error: null });
    try {
      const { breakpoint } = await api.breakpoints.create(projectId, data);
      set((state) => ({
        breakpoints: [...state.breakpoints, breakpoint],
        isLoading: false,
      }));
      return breakpoint;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create breakpoint';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateBreakpoint: async (id: string, data) => {
    set({ isLoading: true, error: null });
    try {
      const { breakpoint } = await api.breakpoints.update(id, data);
      set((state) => ({
        breakpoints: state.breakpoints.map((bp) => (bp.id === id ? breakpoint : bp)),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update breakpoint';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteBreakpoint: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.breakpoints.delete(id);
      set((state) => ({
        breakpoints: state.breakpoints.filter((bp) => bp.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete breakpoint';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  toggleBreakpoint: async (id: string) => {
    try {
      const { breakpoint } = await api.breakpoints.toggle(id);
      set((state) => ({
        breakpoints: state.breakpoints.map((bp) => (bp.id === id ? breakpoint : bp)),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle breakpoint';
      set({ error: message });
      throw error;
    }
  },
}));
