'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ParkingData, ParkingFeature, Filters, getOccupancyColor, getOccupancyLabel } from '@/types/parking';

interface MapProps {
  data: ParkingData | null;
  filters: Filters;
}

export default function Map({ data, filters }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [52.1, 5.3],
      zoom: 8,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers when data or filters change
  useEffect(() => {
    if (!mapRef.current || !markersRef.current || !data) return;

    markersRef.current.clearLayers();

    const filtered = data.features.filter((feature) => {
      const props = feature.properties;

      if (filters.municipalities.length > 0 && !filters.municipalities.includes(props.municipality)) {
        return false;
      }

      if (filters.operators.length > 0 && !filters.operators.includes(props.operator)) {
        return false;
      }

      if (filters.statusFilter === 'open' && !props.open) return false;
      if (filters.statusFilter === 'full' && !props.full) return false;
      if (filters.statusFilter === 'available' && (props.full || !props.open)) return false;

      return true;
    });

    filtered.forEach((feature) => {
      const { properties } = feature;
      const [lng, lat] = feature.geometry.coordinates;
      const color = getOccupancyColor(properties.occupancyPercent);
      const label = getOccupancyLabel(properties.occupancyPercent);

      const size = 14;
      const icon = L.divIcon({
        className: 'parking-marker',
        html: `<div class="marker-icon" style="width:${size}px;height:${size}px;background:${color};"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([lat, lng], { icon });

      const lastUpdate = properties.lastUpdated
        ? new Date(properties.lastUpdated * 1000).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })
        : 'Onbekend';

      const occupancyBar = properties.occupancyPercent !== null
        ? `<div class="occupancy-bar" style="margin:8px 0">
            <div class="occupancy-fill" style="width:${Math.min(properties.occupancyPercent, 100)}%;background:${color}"></div>
          </div>`
        : '';

      marker.bindPopup(`
        <div style="font-family:system-ui,sans-serif">
          <h3 style="font-size:14px;font-weight:600;margin:0 0 4px 0">${properties.name}</h3>
          <p style="font-size:12px;color:#6b7280;margin:0 0 8px 0">${properties.municipality} | ${properties.operator}</p>
          ${occupancyBar}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px">
            <div><span style="color:#6b7280">Status:</span> <strong style="color:${color}">${label}</strong></div>
            <div><span style="color:#6b7280">Open:</span> ${properties.open ? 'Ja' : properties.open === false ? 'Nee' : '?'}</div>
            <div><span style="color:#6b7280">Capaciteit:</span> ${properties.capacity ?? '?'}</div>
            <div><span style="color:#6b7280">Vrij:</span> ${properties.vacantSpaces ?? '?'}</div>
          </div>
          <p style="font-size:11px;color:#9ca3af;margin:8px 0 0 0">Laatst bijgewerkt: ${lastUpdate}</p>
          <div style="display:flex;gap:8px;margin-top:8px;font-size:11px">
            <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;display:flex;align-items:center;gap:2px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20 14.5 14.5 0 000-20M2 12h20"/></svg>
              Street View
            </a>
            <a href="https://npropendata.rdw.nl/parkingdata/v2/static/${properties.uuid}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;display:flex;align-items:center;gap:2px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
              Static API
            </a>
            <a href="https://npropendata.rdw.nl/parkingdata/v2/dynamic/${properties.uuid}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;display:flex;align-items:center;gap:2px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Dynamic API
            </a>
          </div>
        </div>
      `);

      marker.addTo(markersRef.current!);
    });

    // Fit bounds if municipalities filter is active
    if (filters.municipalities.length > 0 && filtered.length > 0) {
      const bounds = L.latLngBounds(
        filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number])
      );
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [data, filters]);

  return <div ref={containerRef} className="w-full h-full" />;
}
