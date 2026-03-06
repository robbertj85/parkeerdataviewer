'use client';

import { useMemo } from 'react';
import { ParkingData, Filters, getOccupancyColor } from '@/types/parking';

interface StatsPanelProps {
  data: ParkingData | null;
  filters: Filters;
}

export default function StatsPanel({ data, filters }: StatsPanelProps) {
  const stats = useMemo(() => {
    if (!data) return null;

    const filtered = data.features.filter((feature) => {
      const props = feature.properties;
      if (filters.municipalities.length > 0 && !filters.municipalities.includes(props.municipality)) return false;
      if (filters.operators.length > 0 && !filters.operators.includes(props.operator)) return false;
      if (filters.statusFilter === 'open' && !props.open) return false;
      if (filters.statusFilter === 'full' && !props.full) return false;
      if (filters.statusFilter === 'available' && (props.full || !props.open)) return false;
      return true;
    });

    let totalCapacity = 0;
    let totalVacant = 0;
    let openCount = 0;
    let fullCount = 0;
    const muniCounts: Record<string, number> = {};

    filtered.forEach((f) => {
      const p = f.properties;
      totalCapacity += p.capacity || 0;
      totalVacant += p.vacantSpaces || 0;
      if (p.open) openCount++;
      if (p.full) fullCount++;
      muniCounts[p.municipality] = (muniCounts[p.municipality] || 0) + 1;
    });

    const topMunicipalities = Object.entries(muniCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const occupancyPct = totalCapacity > 0
      ? Math.round(((totalCapacity - totalVacant) / totalCapacity) * 100)
      : null;

    return {
      total: data.metadata.total_facilities,
      filtered: filtered.length,
      totalCapacity,
      totalVacant,
      totalOccupied: totalCapacity - totalVacant,
      occupancyPct,
      openCount,
      fullCount,
      topMunicipalities,
      uniqueMunicipalities: data.metadata.municipalities.length,
    };
  }, [data, filters]);

  if (!stats) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="h-8 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-8 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  const occupancyColor = getOccupancyColor(stats.occupancyPct);

  return (
    <div className="space-y-3">
      {/* Main stats */}
      <div className="stats-gradient rounded-lg p-4 text-white">
        <div className="text-sm opacity-80">Parkeergarages</div>
        <div className="text-3xl font-bold">{stats.filtered.toLocaleString('nl-NL')}</div>
        {stats.filtered !== stats.total && (
          <div className="text-xs opacity-70">van {stats.total} totaal</div>
        )}
        <div className="text-sm mt-1 opacity-80">{stats.uniqueMunicipalities} gemeenten</div>
      </div>

      {/* Occupancy overview */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Bezettingsoverzicht</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Totale capaciteit</span>
            <span className="font-medium">{stats.totalCapacity.toLocaleString('nl-NL')}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Bezet</span>
            <span className="font-medium">{stats.totalOccupied.toLocaleString('nl-NL')}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Vrij</span>
            <span className="font-medium text-green-600">{stats.totalVacant.toLocaleString('nl-NL')}</span>
          </div>
          {stats.occupancyPct !== null && (
            <div className="mt-2">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Bezettingsgraad</span>
                <span className="font-bold" style={{ color: occupancyColor }}>{stats.occupancyPct}%</span>
              </div>
              <div className="occupancy-bar">
                <div
                  className="occupancy-fill"
                  style={{ width: `${Math.min(stats.occupancyPct, 100)}%`, background: occupancyColor }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status counts */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Status</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-green-600">{stats.openCount}</div>
            <div className="text-xs text-green-700">Open</div>
          </div>
          <div className="bg-red-50 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-red-600">{stats.fullCount}</div>
            <div className="text-xs text-red-700">Vol</div>
          </div>
        </div>
      </div>

      {/* Top municipalities */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Top gemeenten</h3>
        <div className="space-y-2">
          {stats.topMunicipalities.map(([name, count]) => (
            <div key={name} className="flex justify-between items-center text-sm">
              <span className="text-gray-600 truncate mr-2">{name}</span>
              <span className="text-gray-900 font-medium flex-shrink-0">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
