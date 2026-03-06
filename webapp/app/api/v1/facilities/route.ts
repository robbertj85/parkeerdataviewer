import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    const dataPath = join(process.cwd(), 'public', 'data', 'parking_facilities.geojson');
    const raw = await readFile(dataPath, 'utf-8');
    const data = JSON.parse(raw);

    const { searchParams } = request.nextUrl;
    const municipality = searchParams.get('municipality');
    const operator = searchParams.get('operator');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

    let features = data.features || [];

    if (municipality) {
      features = features.filter((f: { properties: { municipality: string } }) =>
        f.properties.municipality.toLowerCase() === municipality.toLowerCase()
      );
    }
    if (operator) {
      features = features.filter((f: { properties: { operator: string } }) =>
        f.properties.operator.toLowerCase() === operator.toLowerCase()
      );
    }
    if (status === 'open') {
      features = features.filter((f: { properties: { open: boolean } }) => f.properties.open);
    } else if (status === 'full') {
      features = features.filter((f: { properties: { full: boolean } }) => f.properties.full);
    }

    const total = features.length;
    const offset = (page - 1) * limit;
    const paged = features.slice(offset, offset + limit);

    return NextResponse.json({
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      facilities: paged.map((f: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }) => ({
        ...f.properties,
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Data not available' }, { status: 503 });
  }
}
