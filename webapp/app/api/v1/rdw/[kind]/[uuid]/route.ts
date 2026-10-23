import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SPDP_BASE = 'https://npropendata.rdw.nl/parkingdata/v2';
// Static data rarely changes; dynamic data is near-real-time.
const CACHE: Record<string, string> = {
  static: 'public, max-age=3600',
  dynamic: 'public, max-age=60',
};

// Pass-through to the RDW SPDP v2 API: it sends no CORS headers, so the
// browser can't fetch it directly.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string; uuid: string }> }) {
  const { kind, uuid } = await params;
  if (!(kind in CACHE) || !/^[0-9a-f-]{36}$/i.test(uuid)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const upstream = await fetch(`${SPDP_BASE}/${kind}/${uuid}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `RDW returned ${upstream.status}` }, { status: upstream.status === 404 ? 404 : 502 });
    }
    return new NextResponse(await upstream.text(), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': CACHE[kind] },
    });
  } catch {
    return NextResponse.json({ error: 'RDW not reachable' }, { status: 502 });
  }
}
