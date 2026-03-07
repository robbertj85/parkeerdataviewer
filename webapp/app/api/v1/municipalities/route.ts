import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const indexPath = join(process.cwd(), 'public', 'data', 'municipalities', 'index.json');
    const raw = await readFile(indexPath, 'utf-8');
    const data = JSON.parse(raw);

    return NextResponse.json({
      total: data.municipalities.length,
      municipalities: data.municipalities,
    });
  } catch {
    return NextResponse.json({ error: 'Data not available' }, { status: 503 });
  }
}
