'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import L from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import { withBase } from '@/lib/basePath';
import { ParkingData, ParkingFeature, Filters, getOccupancyColor } from '@/types/parking';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

// Thunderforest requires a per-account key; supply it via the environment rather
// than committing one. The layer is hidden when no key is configured.
const THUNDERFOREST_KEY = process.env.NEXT_PUBLIC_THUNDERFOREST_API_KEY;

type BaseMapConfig =
  | { name: string; type: 'raster'; url: string; attribution: string; subdomains?: string; maxZoom?: number }
  | { name: string; type: 'vector'; style: string; attribution: string };

// CARTO's raster endpoint (basemaps.cartocdn.com/{style}/{z}/{x}/{y}.png) started
// serving an "API KEY REQUIRED" watermark in Aug 2026 and is being retired. Their
// vector GL styles serve the same cartography and currently need no key, so the
// CARTO layers below are vector. Raster layers stay as the no-WebGL fallback.
const TILE_LAYERS = {
  cartodb: {
    name: 'CARTO Positron',
    type: 'vector',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    attribution: CARTO_ATTRIBUTION,
  },
  cartoVoyager: {
    name: 'CARTO Voyager',
    type: 'vector',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    attribution: CARTO_ATTRIBUTION,
  },
  osm: {
    name: 'OpenStreetMap',
    type: 'raster',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  },
  transport: {
    name: 'Transport',
    type: 'raster',
    url: `https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_KEY ?? ''}`,
    attribution: `&copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, ${OSM_ATTRIBUTION}`,
    maxZoom: 22,
  },
  shortbread: {
    name: 'Shortbread',
    type: 'raster',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 18,
  },
  esri_satellite: {
    name: 'Satellite (Esri)',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  google_satellite: {
    name: 'Satellite (Google)',
    type: 'raster',
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    attribution: '&copy; Google',
    maxZoom: 20,
  },
} satisfies Record<string, BaseMapConfig>;

type TileLayerKey = keyof typeof TILE_LAYERS;

// MapLibre needs WebGL2; older iOS and some GPUs don't have it.
function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function getAvailableLayers(): TileLayerKey[] {
  const hasWebGL2 = supportsWebGL2();
  return (Object.keys(TILE_LAYERS) as TileLayerKey[]).filter((key) => {
    if (key === 'transport' && !THUNDERFOREST_KEY) return false;
    if (TILE_LAYERS[key].type === 'vector' && !hasWebGL2) return false;
    return true;
  });
}

// MapLibre 6 looks for its worker next to its own (bundler-renamed) module and
// 404s, so the GL map never requests tiles and the basemap stays blank. Serve
// it from public/ instead (copied there by predev/prebuild).
setWorkerUrl(withBase('/maplibre-gl-worker.mjs'));

function createBaseLayer(config: BaseMapConfig): L.Layer {
  if (config.type === 'vector') {
    const layer = maplibreGL({
      style: config.style,
      attributionControl: { customAttribution: config.attribution },
    });
    // The inner GL map only exists once the layer has been added to the map.
    layer.on('add', () => {
      layer.getMaplibreMap().on('error', (e) => {
        console.error('[basemap]', e.error?.message ?? e);
      });
    });
    return layer;
  }
  return L.tileLayer(config.url, {
    attribution: config.attribution,
    subdomains: config.subdomains || 'abc',
    maxZoom: config.maxZoom || 19,
  });
}

interface MapProps {
  data: ParkingData | null;
  filters: Filters;
  onSelectFacility?: (feature: ParkingFeature) => void;
  selectedUuid?: string | null;
}

export interface MapHandle {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
}

const Map = forwardRef<MapHandle, MapProps>(function Map({ data, filters, onSelectFacility, selectedUuid }, ref) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerMapRef = useRef<Record<string, L.Marker>>({});
  const tileLayerRef = useRef<L.Layer | null>(null);
  // Computed once on the client; falls back to a raster layer without WebGL2.
  const [availableLayers] = useState(getAvailableLayers);
  const [activeLayer, setActiveLayer] = useState<TileLayerKey>(availableLayers[0]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [52.1, 5.3],
      zoom: 8,
      zoomControl: false,
      // Leaflet's animated zoom makes the GL basemap render a single zoom step
      // several times (CSS-scaled canvas mid-animation, then camera re-jumps),
      // which reads as flicker. Zooming is one discrete step instead.
      zoomAnimation: false,
    });

    // Add zoom control to top-right to avoid conflict with mobile filter button
    L.control.zoom({ position: 'topright' }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch tile layer
  useEffect(() => {
    if (!mapRef.current) return;
    const config: BaseMapConfig = TILE_LAYERS[activeLayer];

    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = createBaseLayer(config).addTo(mapRef.current);
  }, [activeLayer]);

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lng: number, zoom?: number) => {
      if (mapRef.current) {
        mapRef.current.flyTo([lat, lng], zoom ?? 14, { animate: true, duration: 1 });
      }
    },
  }));

  // Update markers when data or filters change
  useEffect(() => {
    if (!mapRef.current || !markersRef.current || !data) return;

    markersRef.current.clearLayers();
    markerMapRef.current = {};

    const filtered = data.features.filter((feature) => {
      const props = feature.properties;
      if (filters.municipalities.length > 0 && !filters.municipalities.includes(props.municipality)) return false;
      if (filters.operators.length > 0 && !filters.operators.includes(props.operator)) return false;
      if (filters.statusFilter === 'open' && !props.open) return false;
      if (filters.statusFilter === 'full' && !props.full) return false;
      if (filters.statusFilter === 'available' && (props.full || !props.open)) return false;
      return true;
    });

    filtered.forEach((feature) => {
      const { properties } = feature;
      const [lng, lat] = feature.geometry.coordinates;
      const color = getOccupancyColor(properties.occupancyPercent);
      const isSelected = properties.uuid === selectedUuid;
      const isStale = properties.lastUpdated
        ? (Date.now() / 1000 - properties.lastUpdated) > 24 * 60 * 60
        : false;

      const size = isSelected ? 18 : 14;
      const borderWidth = isSelected ? 3 : 2;
      const borderColor = isSelected ? '#2563eb' : 'white';
      const opacity = isStale ? 'opacity:0.5;' : '';

      const icon = L.divIcon({
        className: 'parking-marker',
        html: `<div class="marker-icon" style="width:${size}px;height:${size}px;background:${color};border:${borderWidth}px solid ${borderColor};${opacity}${isSelected ? 'box-shadow:0 0 0 3px rgba(37,99,235,0.3),0 2px 4px rgba(0,0,0,0.3);z-index:1000!important;' : ''}"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([lat, lng], { icon, zIndexOffset: isSelected ? 1000 : 0 });

      marker.on('click', () => {
        onSelectFacility?.(feature);
      });

      marker.addTo(markersRef.current!);
      markerMapRef.current[properties.uuid] = marker;
    });

    // Fit bounds if municipalities filter is active
    if (filters.municipalities.length > 0 && filtered.length > 0) {
      const bounds = L.latLngBounds(
        filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number])
      );
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [data, filters, onSelectFacility, selectedUuid]);

  // Pan to selected facility
  useEffect(() => {
    if (!mapRef.current || !selectedUuid || !data) return;
    const feature = data.features.find(f => f.properties.uuid === selectedUuid);
    if (feature) {
      const [lng, lat] = feature.geometry.coordinates;
      mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 14), { animate: true });
    }
  }, [selectedUuid, data]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-5 right-3 z-[1000]">
        <select
          value={activeLayer}
          onChange={(e) => setActiveLayer(e.target.value as TileLayerKey)}
          className="bg-white border border-gray-300 rounded-md shadow-sm px-2 py-1 text-sm text-gray-700 cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {availableLayers.map((key) => (
            <option key={key} value={key}>{TILE_LAYERS[key].name}</option>
          ))}
        </select>
      </div>
    </div>
  );
});

export default Map;
