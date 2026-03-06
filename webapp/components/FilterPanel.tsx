'use client';

import { useState, useMemo } from 'react';
import { ParkingData, Filters } from '@/types/parking';

interface FilterPanelProps {
  data: ParkingData | null;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function FilterPanel({ data, filters, onFiltersChange }: FilterPanelProps) {
  const [muniSearch, setMuniSearch] = useState('');
  const [operatorSearch, setOperatorSearch] = useState('');

  const { municipalities, operators } = useMemo(() => {
    if (!data) return { municipalities: [], operators: [] };

    const muniCounts: Record<string, number> = {};
    const opCounts: Record<string, number> = {};

    data.features.forEach((f) => {
      const p = f.properties;
      muniCounts[p.municipality] = (muniCounts[p.municipality] || 0) + 1;
      opCounts[p.operator] = (opCounts[p.operator] || 0) + 1;
    });

    return {
      municipalities: Object.entries(muniCounts).sort((a, b) => b[1] - a[1]),
      operators: Object.entries(opCounts).sort((a, b) => b[1] - a[1]),
    };
  }, [data]);

  const filteredMunicipalities = municipalities.filter(
    ([name]) => name.toLowerCase().includes(muniSearch.toLowerCase())
  );

  const filteredOperators = operators.filter(
    ([name]) => name.toLowerCase().includes(operatorSearch.toLowerCase())
  );

  const toggleMunicipality = (name: string) => {
    const current = filters.municipalities;
    const updated = current.includes(name)
      ? current.filter((m) => m !== name)
      : [...current, name];
    onFiltersChange({ ...filters, municipalities: updated });
  };

  const toggleOperator = (name: string) => {
    const current = filters.operators;
    const updated = current.includes(name)
      ? current.filter((o) => o !== name)
      : [...current, name];
    onFiltersChange({ ...filters, operators: updated });
  };

  const hasActiveFilters =
    filters.municipalities.length > 0 ||
    filters.operators.length > 0 ||
    filters.statusFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Status filter</h3>
        <div className="grid grid-cols-2 gap-1">
          {[
            { value: 'all' as const, label: 'Alles' },
            { value: 'open' as const, label: 'Open' },
            { value: 'available' as const, label: 'Beschikbaar' },
            { value: 'full' as const, label: 'Vol' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onFiltersChange({ ...filters, statusFilter: opt.value })}
              className={`px-3 py-1.5 text-xs font-medium rounded transition ${
                filters.statusFilter === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Municipality filter */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          Gemeente
          {filters.municipalities.length > 0 && (
            <span className="ml-1 text-xs text-blue-600">({filters.municipalities.length})</span>
          )}
        </h3>
        <input
          type="text"
          placeholder="Zoek gemeente..."
          value={muniSearch}
          onChange={(e) => setMuniSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
          {filteredMunicipalities.slice(0, 50).map(([name, count]) => (
            <label
              key={name}
              className="flex items-center gap-2 px-1 py-0.5 hover:bg-gray-50 rounded cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.municipalities.includes(name)}
                onChange={() => toggleMunicipality(name)}
                className="rounded text-blue-600 w-3.5 h-3.5"
              />
              <span className="text-sm text-gray-700 truncate flex-1">{name}</span>
              <span className="text-xs text-gray-400">{count}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Operator filter */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          Exploitant
          {filters.operators.length > 0 && (
            <span className="ml-1 text-xs text-blue-600">({filters.operators.length})</span>
          )}
        </h3>
        <input
          type="text"
          placeholder="Zoek exploitant..."
          value={operatorSearch}
          onChange={(e) => setOperatorSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
          {filteredOperators.map(([name, count]) => (
            <label
              key={name}
              className="flex items-center gap-2 px-1 py-0.5 hover:bg-gray-50 rounded cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.operators.includes(name)}
                onChange={() => toggleOperator(name)}
                className="rounded text-blue-600 w-3.5 h-3.5"
              />
              <span className="text-sm text-gray-700 truncate flex-1">{name}</span>
              <span className="text-xs text-gray-400">{count}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={() =>
            onFiltersChange({ municipalities: [], operators: [], statusFilter: 'all' })
          }
          className="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition"
        >
          Filters wissen
        </button>
      )}
    </div>
  );
}
