import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format') || 'json';

  try {
    const dataPath = join(process.cwd(), 'public', 'data', 'parking_facilities.geojson');
    const raw = await readFile(dataPath, 'utf-8');
    const data = JSON.parse(raw);

    if (format === 'geojson') {
      return new NextResponse(raw, {
        headers: {
          'Content-Type': 'application/geo+json',
          'Content-Disposition': 'attachment; filename="parkeerdata-nederland.geojson"',
        },
      });
    }

    const features = data.features || [];
    const flat = features.map((f: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }) => ({
      ...f.properties,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    }));

    if (format === 'csv') {
      const headers = ['uuid', 'name', 'municipality', 'operator', 'latitude', 'longitude', 'capacity', 'vacantSpaces', 'occupancyPercent', 'open', 'full', 'lastUpdated'];
      const rows = flat.map((row: Record<string, unknown>) =>
        headers.map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(',')
      );
      const csv = [headers.join(','), ...rows].join('\n');
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="parkeerdata-nederland.csv"',
        },
      });
    }

    return NextResponse.json(flat, {
      headers: {
        'Content-Disposition': 'attachment; filename="parkeerdata-nederland.json"',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Data not available' }, { status: 503 });
  }
}
