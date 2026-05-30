import { useState, useEffect, useRef } from 'react';
import { TraceFilters } from '../hooks/useFilterParams';

interface FilterBarProps {
  filters: TraceFilters;
  onFilterChange: (updates: Partial<TraceFilters>) => void;
  onClear: () => void;
  traceTypes?: string[];
  t: Record<string, string>;
}

export function FilterBar({ filters, onFilterChange, onClear, traceTypes = [], t }: FilterBarProps) {
  const [nameInput, setNameInput] = useState(filters.name || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setNameInput(filters.name || '');
  }, [filters.name]);

  const handleNameChange = (value: string) => {
    setNameInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFilterChange({ name: value || undefined });
    }, 300);
  };

  const hasFilters = Object.values(filters).some(v => v !== undefined && v !== '');

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-lg border">
      {/* Name search */}
      <input
        type="text"
        placeholder={t.searchByName || 'Search by name...'}
        value={nameInput}
        onChange={e => handleNameChange(e.target.value)}
        className="px-3 py-1.5 text-sm border rounded-md w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {/* Trace type */}
      <select
        value={filters.traceType || ''}
        onChange={e => onFilterChange({ traceType: e.target.value || undefined })}
        className="px-2 py-1.5 text-sm border rounded-md bg-white"
      >
        <option value="">{t.allTypes || 'All Types'}</option>
        {traceTypes.map(type => (
          <option key={type} value={type}>{type}</option>
        ))}
      </select>

      {/* Status */}
      <select
        value={filters.status || ''}
        onChange={e => onFilterChange({ status: e.target.value || undefined })}
        className="px-2 py-1.5 text-sm border rounded-md bg-white"
      >
        <option value="">{t.allStatus || 'All Status'}</option>
        <option value="success">{t.success || 'Success'}</option>
        <option value="error">{t.error || 'Error'}</option>
      </select>

      {/* Eval status */}
      <select
        value={filters.evalStatus || ''}
        onChange={e => onFilterChange({ evalStatus: e.target.value || undefined })}
        className="px-2 py-1.5 text-sm border rounded-md bg-white"
      >
        <option value="">{t.allEval || 'All Eval'}</option>
        <option value="needs_attention">{t.needsAttention || 'Needs Attention'}</option>
        <option value="passed">{t.passed || 'Passed'}</option>
        <option value="unevaluated">{t.unevaluated || 'Unevaluated'}</option>
      </select>

      {/* Date range */}
      <input
        type="date"
        value={filters.startDate?.split('T')[0] || ''}
        onChange={e => onFilterChange({ startDate: e.target.value ? `${e.target.value}T00:00:00Z` : undefined })}
        className="px-2 py-1.5 text-sm border rounded-md"
        title={t.startDate || 'Start date'}
      />
      <span className="text-gray-400 text-sm">-</span>
      <input
        type="date"
        value={filters.endDate?.split('T')[0] || ''}
        onChange={e => onFilterChange({ endDate: e.target.value ? `${e.target.value}T23:59:59Z` : undefined })}
        className="px-2 py-1.5 text-sm border rounded-md"
        title={t.endDate || 'End date'}
      />

      {/* Latency range */}
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder={t.latencyMin || 'Min ms'}
          value={filters.latencyMin ?? ''}
          onChange={e => onFilterChange({ latencyMin: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          className="px-2 py-1.5 text-sm border rounded-md w-20"
          min={0}
        />
        <span className="text-gray-400 text-sm">-</span>
        <input
          type="number"
          placeholder={t.latencyMax || 'Max ms'}
          value={filters.latencyMax ?? ''}
          onChange={e => onFilterChange({ latencyMax: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          className="px-2 py-1.5 text-sm border rounded-md w-20"
          min={0}
        />
        <span className="text-gray-400 text-xs">ms</span>
      </div>

      {/* Clear button */}
      {hasFilters && (
        <button
          onClick={onClear}
          className="px-2 py-1.5 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md"
        >
          {t.clearFilters || 'Clear'}
        </button>
      )}
    </div>
  );
}
