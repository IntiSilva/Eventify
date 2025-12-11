// Playwright global setup for auth & seeded users
import { chromium, type FullConfig } from '@playwright/test'
import path from 'node:path'
import { clerkSetup, clerk } from '@clerk/testing/playwright'
import { createClerkClient } from '@clerk/backend'

import { prisma } from '@/lib/prisma'
import { UserRole, type Prisma } from '@/generated/prisma'
import { normalizeUsername } from '@/lib/utils'

/** Ensure a Clerk user exists for this email (create if needed) and return its clerkId. */
async function ensureClerkUser(email: string, password: string, username?: string) {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) throw new Error('[global-setup] Missing CLERK_SECRET_KEY')
  const backend = createClerkClient({ secretKey })

  // Look up the user by email; re-use it if it already exists
  const list = await backend.users.getUserList({ emailAddress: [email] })
  const existing = list?.data?.[0]
  if (existing) {
    // Optional: force a known password for E2E runs so logins are deterministic
    try {
      await backend.users.updateUser(existing.id, { password })
    } catch {
      /* Some Clerk tenants do not allow direct password updates; swallow the error in tests. */
    }
    return existing.id
  }

  // Otherwise create a fresh Clerk user
  const created = await backend.users.createUser({
    emailAddress: [email],
    password,
    username, // optional: bind this Clerk user to a seeded DB user via username
    publicMetadata: { e2e: true },
    privateMetadata: { e2e: true },
  })
  return created.id
}

// Keep Clerk's role/onboarding flags (and optionally username) in sync with what tests expect
async function setClerkMetadata(
  clerkId: string,
  params: { role: UserRole; onboarding: boolean; username?: string }
) {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) throw new Error('[global-setup] Missing CLERK_SECRET_KEY')
  const backend = createClerkClient({ secretKey })

  const user = await backend.users.getUser(clerkId)

  await backend.users.updateUser(clerkId, {
    publicMetadata: {
      ...user.publicMetadata,
      role: params.role,
      onboarding: params.onboarding
    },
    privateMetadata: {
      ...user.privateMetadata,
      role: params.role,
      onboarding: params.onboarding,
    },
    username: params.username, // optional: no-op if it already matches
  })
}

/**
 * Synchronize the local Prisma User row with the real Clerk user.
 * Uses the email as the lookup key and updates role/phone/username + clerkId.
 */
async function syncDbUserWithClerk(params: {
  email: string
  clerkId: string
  role: UserRole
  phone: string | null
  desiredUsername?: string
}) {
  const { email, clerkId, role, phone, desiredUsername } = params

  // 1) Try to find an existing user row by email
  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      clerkId: true,
      role: true,
      phoneNumber: true,
      username: true,
      normalizedUsername: true,
    },
  })

  if (existing) {
    const updates = {
      ...(existing.clerkId !== clerkId && { clerkId }),
      ...(existing.role !== role && { role }),
      ...(role === 'organizer' && phone && existing.phoneNumber !== phone && { phoneNumber: phone }),
    } satisfies Prisma.UserUpdateInput

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { email },
        data: updates,
      })
      // console.log('[global-setup] syncDbUserWithClerk: updated user', { email, updates })
    }

    return
  }

  // 2) If nothing is found, create a minimal user row compatible with the test seeds
  const username =
    desiredUsername ??
    email.split('@')[0] ??
    normalizeUsername(`e2e_${email.replace(/[^a-zA-Z0-9]/g, '_')}`)

  await prisma.user.create({
    data: {
      email,
      clerkId,
      role,
      username,
      normalizedUsername: normalizeUsername(username),
      phoneNumber: role === 'organizer' ? phone : null,
    },
  })
  // console.log('[global-setup] syncDbUserWithClerk: created user', { email, clerkId, role })
}

export default async function globalSetup(config: FullConfig) {
  // Ensure the env vars required by @clerk/testing are present
  for (const k of ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'] as const) {
    if (!process.env[k]) {
      throw new Error(`[global-setup] Missing ${k} in env (use .env.e2e).`)
    }
  }

  // 1) Initialize the global Clerk testing token (required by @clerk/testing)
  await clerkSetup()

  const baseURL = config.projects?.[0]?.use?.baseURL ?? 'http://localhost:3000'
  const browser = await chromium.launch()

  // Helper: create user if needed, sync DB row, and persist Playwright storageState
  const loginAndSave = async (
    emailEnv: string,
    passEnv: string,
    outfile: string,
    usernameEnv: string | undefined,
    role: UserRole,
    phoneEnv?: string | undefined,
    onboarding?: boolean
  ) => {
    const email = process.env[emailEnv]
    const password = process.env[passEnv]
    const desiredUsername = usernameEnv ? process.env[usernameEnv] : undefined
    const phone = phoneEnv ? process.env[phoneEnv] ?? undefined : undefined

    if (!email || !password) return // skip this persona if credentials are not configured

    // 1) Ensure the user exists in Clerk and grab the real clerkId
    const clerkId = await ensureClerkUser(email, password, desiredUsername)

    // 1.1) Set Clerk metadata so JWT/session already carries the right role/onboarding flags
    if (typeof onboarding === 'boolean') {
      await setClerkMetadata(clerkId, { role, onboarding, username: desiredUsername })
    }

    // 2) Sync the local Prisma User row so it points at that clerkId
    await syncDbUserWithClerk({
      email,
      clerkId,
      role,
      phone: phone ?? null,
      desiredUsername: desiredUsername,
    })

    // 3) Spin up a browser context, sign in, and save its storageState to disk
    const ctx = await browser.newContext({ baseURL })
    const page = await ctx.newPage()
    await page.goto('/') // hit a public route to bootstrap the app

    await clerk.signIn({
      page,
      signInParams: {
        strategy: 'password',
        identifier: email, // can be email or username
        password,
      },
    })

    await ctx.storageState({ path: path.join('e2e/.auth', outfile) })
    await ctx.close()
  }

  try {
    // USER without onboarding completed (uses the "fresh" user from seed)
    await loginAndSave(
      'E2E_FRESH_EMAIL',
      'E2E_FRESH_PASSWORD',
      'user.noonboarding.json',
      'E2E_FRESH_USERNAME',
      UserRole.user,
      undefined,
      false //  onboarding completed? -> false
    )

    // USER with onboarding already completed (the "e2e_user" record from the seed)
    await loginAndSave(
      'E2E_USER_EMAIL',
      'E2E_USER_PASSWORD',
      'user.json',
      'E2E_USER_USERNAME',
      UserRole.user,
      undefined,
      true // onboarding completed? -> true
    )

    // ORGANIZER persona
    await loginAndSave(
      'E2E_ORG_EMAIL',
      'E2E_ORG_PASSWORD',
      'organizer.json',
      'E2E_ORG_USERNAME',
      UserRole.organizer,
      'E2E_ORG_PHONE',
      true
    )

    // ADMIN persona
    await loginAndSave(
      'E2E_ADMIN_EMAIL',
      'E2E_ADMIN_PASSWORD',
      'admin.json',
      'E2E_ADMIN_USERNAME',
      UserRole.admin,
      'E2E_ADMIN_PHONE',
      true
    )
  } finally {
    await browser.close()
    // Close the Prisma connection used during global setup
    try {
      await prisma.$disconnect()
    } catch {}
  }
}
