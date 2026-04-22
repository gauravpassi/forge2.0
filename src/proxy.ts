import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { nextUrl, auth: session } = req

  // Public paths — always accessible
  const publicPaths = ['/', '/api/auth']
  const isPublic = publicPaths.some(
    (p) => nextUrl.pathname === p || nextUrl.pathname.startsWith('/api/auth')
  )

  if (!session && !isPublic) {
    // Redirect to home (login page) if not authenticated
    return NextResponse.redirect(new URL('/', nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
