import { create } from 'zustand';
import { api, Trace, Stats } from '../api';

interface TraceState {
  traces: Trace[];
  selectedTrace: Trace | null;
  stats: Stats | null;
  isLoading: boolean;
  error: string | null;
  fetchTraces: (projectId: string, sessionId?: string) => Promise<void>;
  fetchStats: (projectId?: string) => Promise<void>;
  selectTrace: (trace: Trace | null) => void;
  addTrace: (trace: Trace) => void;
  reset: () => void;
}

export const useTraceStore = create<TraceState>((set, get) => ({
  traces: [],
  selectedTrace: null,
  stats: null,
  isLoading: false,
  error: null,

  fetchTraces: async (projectId: string, sessionId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { traces } = await api.traces.list(projectId, { sessionId, limit: 100 });
      set({ traces, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch traces';
      set({ error: message, isLoading: false });
    }
  },

  fetchStats: async (projectId?: string) => {
    try {
      const { stats } = await api.stats.get(projectId);
      set({ stats });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  },

  selectTrace: (trace) => set({ selectedTrace: trace }),

  addTrace: (trace) => {
    set((state) => ({
      traces: [trace, ...state.traces].slice(0, 100),
    }));
    get().fetchStats(trace.project_id);
  },

  reset: () => set({ traces: [], selectedTrace: null, stats: null }),
}));
