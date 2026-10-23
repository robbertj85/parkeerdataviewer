import { NextRequest, NextResponse } from 'next/server';
import { daySnapshots, todayUtc } from '@/lib/history';

export const dynamic = 'force-dynamic';

// All hourly snapshots of one UTC day (YYYY-MM-DD). Same format as the old
// /data/snapshots/YYYY/MM/DD.json day files.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: 'Invalid date, expected YYYY-MM-DD' }, { status: 400 });
  }
  const data = daySnapshots(date);
  if (!data) return NextResponse.json({ error: 'No snapshots for this date' }, { status: 404 });
  // Past days are final; today gains an hour every hour.
  const cache = date < todayUtc() ? 'public, max-age=86400' : 'public, no-cache';
  return NextResponse.json(data, { headers: { 'Cache-Control': cache } });
}
