import { NextRequest, NextResponse } from 'next/server';
import { facilityHistory } from '@/lib/history';

export const dynamic = 'force-dynamic';

// Hourly snapshots of one facility for the last `days` UTC days (1-366), in the
// day-file format of /api/v1/snapshots/{date}, filtered to this facility.
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) {
    return NextResponse.json({ error: 'Invalid facility uuid' }, { status: 400 });
  }
  const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') || '1') || 1, 1), 366);
  return NextResponse.json(
    { uuid, days: facilityHistory(uuid, days) },
    { headers: { 'Cache-Control': 'public, no-cache' } },
  );
}
