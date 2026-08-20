import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import { PoolState } from '@/lib/types';

const POOL_KEY = 'bdg:pool';

export async function GET() {
  try {
    const state = await kv.get<PoolState>(POOL_KEY);
    return NextResponse.json(state ?? { leads: [], generatedAt: null });
  } catch (err) {
    console.error('[pool GET]', err);
    return NextResponse.json({ leads: [], generatedAt: null });
  }
}

export async function PUT(req: Request) {
  try {
    const body: PoolState = await req.json();
    await kv.set(POOL_KEY, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[pool PUT]', err);
    return NextResponse.json({ error: 'Failed to save pool' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await kv.del(POOL_KEY);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[pool DELETE]', err);
    return NextResponse.json({ error: 'Failed to clear pool' }, { status: 500 });
  }
}
