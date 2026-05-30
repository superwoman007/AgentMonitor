import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

export interface TraceFilters {
  name?: string;
  traceType?: string;
  status?: string;
  evalStatus?: string;
  startDate?: string;
  endDate?: string;
  latencyMin?: number;
  latencyMax?: number;
  sessionId?: string;
}

const STRING_KEYS: (keyof TraceFilters)[] = ['name', 'traceType', 'status', 'evalStatus', 'startDate', 'endDate', 'sessionId'];
const NUMBER_KEYS: (keyof TraceFilters)[] = ['latencyMin', 'latencyMax'];

export function useFilterParams(): [TraceFilters, (filters: Partial<TraceFilters>) => void, () => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<TraceFilters>(() => {
    const result: TraceFilters = {};
    for (const key of STRING_KEYS) {
      const val = searchParams.get(key);
      if (val) (result as any)[key] = val;
    }
    for (const key of NUMBER_KEYS) {
      const val = searchParams.get(key);
      if (val) {
        const n = parseInt(val, 10);
        if (!isNaN(n)) (result as any)[key] = n;
      }
    }
    return result;
  }, [searchParams]);

  const setFilters = useCallback((updates: Partial<TraceFilters>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '' || value === null) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      return next;
    });
  }, [setSearchParams]);

  const clearFilters = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  return [filters, setFilters, clearFilters];
}
