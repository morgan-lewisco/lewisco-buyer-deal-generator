import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TOKEN = 'lewisco-auth-2026';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow login page and auth API
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const auth = request.cookies.get('bdg-auth');
  if (auth?.value !== TOKEN) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|icon\\.svg|lewisco-logo\\.png).*)'],
};
