import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const session = request.cookies.get('session')
  const { pathname } = request.nextUrl

  // Public paths that don't require authentication
  const publicPaths = ['/landing']
  const isPublicPath = publicPaths.includes(pathname)

  // If accessing root path or authenticated paths without session, redirect to landing
  if (!session && (pathname === '/' || !isPublicPath)) {
    return NextResponse.redirect(new URL('/landing', request.url))
  }

  // If accessing public paths with session, redirect to home
  if (session && isPublicPath) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|$).*)',
  ],
} 