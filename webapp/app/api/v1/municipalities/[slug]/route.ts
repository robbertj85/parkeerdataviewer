import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Sanitize slug to prevent path traversal
    const safeSlug = slug.replace(/[^a-z0-9\-'ú]/gi, '').toLowerCase();
    if (!safeSlug || safeSlug !== slug.toLowerCase()) {
      return NextResponse.json({ error: 'Invalid municipality slug' }, { status: 400 });
    }

    const filePath = join(process.cwd(), 'public', 'data', 'municipalities', `${safeSlug}.json`);
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    return NextResponse.json(data);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return NextResponse.json({ error: 'Municipality not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Data not available' }, { status: 503 });
  }
}
