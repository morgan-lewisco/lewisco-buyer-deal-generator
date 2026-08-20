import { NextResponse } from 'next/server';

const PASSWORD = 'Lewisco2026!';
const TOKEN    = 'lewisco-auth-2026';

export async function POST(req: Request) {
  const { password } = await req.json();
  if (password !== PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('bdg-auth', TOKEN, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('bdg-auth');
  return res;
}
