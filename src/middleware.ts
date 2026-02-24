import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { UserRole } from '@/generated/prisma'

// ---------- Type guards ----------
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const isUserRole = (v: unknown): v is UserRole =>
  v === 'admin' || v === 'organizer' || v === 'user'

function getRoleFromClaims(claims: unknown): UserRole | null {
  if (!isRecord(claims)) return null
  const pm = claims.publicMetadata
  if (isRecord(pm) && isUserRole(pm.role)) return pm.role
  const prv = claims.privateMetadata
  if (isRecord(prv) && isUserRole(prv.role)) return prv.role
  const rl = (claims as Record<string, unknown>).role
  if (isUserRole(rl)) return rl
  return null
}

function getOnboardingFlag(claims: unknown): boolean | null {
  if (!isRecord(claims)) return null
  const pm = claims.publicMetadata
  if (isRecord(pm) && typeof pm.onboarding === 'boolean') return pm.onboarding
  const prv = claims.privateMetadata
  if (isRecord(prv) && typeof prv.onboarding === 'boolean') return prv.onboarding
  return null
}

// ---------- Route matchers ----------
const isAuthPageRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)',
  '/oauth(.*)',
  '/robots.txt',
  '/sitemap.xml',
  '/opengraph-image(.*)',
  '/twitter-image(.*)',
  '/api/webhooks/(.*)',
  '/api/username-availability',
])

const isAdminRoute = createRouteMatcher(['/admin(.*)'])
const isOrganizerRoute = createRouteMatcher(['/organizer(.*)'])
// const isAgendaRoute = createRouteMatcher(['/agenda(.*)'])
const isNewEventRoute = createRouteMatcher(['/events/new(.*)'])
const isOnboardingRoute = createRouteMatcher(['/onboarding(.*)'])

const isPrivateRoute = createRouteMatcher([
  '/',
  '/admin(.*)',
  '/organizer(.*)',
  '/agenda(.*)',
  '/events/new(.*)',
  '/onboarding(.*)',
])

// ---------- Middleware ----------
export default clerkMiddleware(
  async (auth, req: NextRequest) => {
    const { userId, sessionClaims } = await auth()
    const { pathname } = req.nextUrl

    // Early exits: preflight, next internals y assets
    if (req.method === 'OPTIONS') return NextResponse.next()
    if (pathname.startsWith('/_next/')) return NextResponse.next()
    if (pathname.startsWith('/_next/data')) return NextResponse.next()
    if (
      /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|txt|xml|json|woff2?)$/i.test(
        pathname,
      )
    ) {
      return NextResponse.next()
    }
    if (pathname.startsWith('/api/webhooks/')) return NextResponse.next()
    if (pathname.startsWith('/api/cron/')) return NextResponse.next()

    // Auth pages should be only for logged-out users (single session)
    // If user is already signed in and hits /sign-in or /sign-up, redirect them away
    if (userId && isAuthPageRoute(req)) {
      const hasOnboarded = getOnboardingFlag(sessionClaims)
      const targetPath = hasOnboarded === true ? '/' : '/onboarding'
      return NextResponse.redirect(new URL(targetPath, req.url))
    }

    // Public → go through
    if (isPublicRoute(req)) return NextResponse.next()

    // Private → requires login
    if (isPrivateRoute(req) && !userId) {
      const toSignIn = new URL('/sign-in', req.url)
      toSignIn.searchParams.set('redirect_url', req.url)
      console.log(
        `[Middleware] Anonymous hit ${pathname}. Redirect -> ${toSignIn.pathname}`,
      )
      return NextResponse.redirect(toSignIn)
    }

    // If there's no session and not private nor public, continue
    if (!userId) return NextResponse.next()

    // With session: onboarding + roles
    const role = getRoleFromClaims(sessionClaims)
    const hasOnboarded = getOnboardingFlag(sessionClaims)

    // ---------- Onboarding -----------
    if (isOnboardingRoute(req)) {
      if (hasOnboarded === true) {
        // User already onboarded → keep them out of /onboarding
        return NextResponse.redirect(new URL('/', req.url))
      }
      // If the user is NOT onboarded, let them access /onboarding
      return NextResponse.next()
    }

    // --- If the user is NOT onboarded and is not on /onboarding → send them to /onboarding ---
    if (hasOnboarded !== true && !isOnboardingRoute(req)) {
      const toOnboarding = new URL('/onboarding', req.url)
      toOnboarding.searchParams.set('redirect_url', req.url)
      return NextResponse.redirect(toOnboarding)
    }

    // ---------- Role-based access control ----------
    if (isAdminRoute(req) && role !== 'admin') {
      console.log(
        `[Middleware] User ${userId} (role: ${String(
          role,
        )}) attempted to access admin ${pathname}. Denied.`,
      )
      return NextResponse.redirect(new URL('/', req.url))
    }

    if (isOrganizerRoute(req) && role !== 'organizer' && role !== 'admin') {
      console.log(
        `[Middleware] User ${userId} (role: ${String(
          role,
        )}) attempted to access organizer ${pathname}. Denied.`,
      )
      return NextResponse.redirect(new URL('/', req.url))
    }

    // Only admins or organizers can create events
    if (isNewEventRoute(req) && role !== 'admin' && role !== 'organizer') {
      console.log(
        `[Middleware] User ${userId} (role: ${String(
          role,
        )}) denied access to ${pathname}.`,
      )
      return NextResponse.redirect(new URL('/', req.url))
    }

    return NextResponse.next()
  },
  {
    debug: process.env.NODE_ENV !== 'production',
  },
)

// ---------- Matcher ----------
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|json|woff2?)$).*)',
  ],
}