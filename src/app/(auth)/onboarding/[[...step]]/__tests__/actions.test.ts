import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// SUT
import { submitOnboarding } from '@/app/(auth)/onboarding/[[...step]]/actions'

/**
 * ─────────────────────────── HOISTED FIXTURES ───────────────────────────
 * We use vi.hoisted so these values are created before module evaluation.
 * This guarantees that any module mocks below can reference them safely.
 */
const h = vi.hoisted(() => {
  const USER_ID = 'user_123'
  const EMAIL = 'john@example.com'

  // Inputs
  const USERNAME_RAW = '  John.Doe  ' // trimmed in the action
  const USERNAME_VALID = 'John.Doe'
  const NORMALIZED = 'john.doe' // produced by the real normalizeUsername

  const PHONE_VALID = '  123456789  ' // trimmed to '123456789'
  const PHONE_SHORT = '  12345  '

  // Error helpers
  const clerkErr = { __isClerkApi: true, reason: 'username policy' }
  const p2002User = { code: 'P2002', meta: { target: 'normalizedUsername' } }
  const p2002Phone = { code: 'P2002', meta: { target: 'phoneNumber' } }

  return {
    USER_ID,
    EMAIL,
    USERNAME_RAW,
    USERNAME_VALID,
    NORMALIZED,
    PHONE_VALID,
    PHONE_SHORT,
    clerkErr,
    p2002User,
    p2002Phone,
  }
})

/**
 * ─────────────────────────── HOISTED MOCKS ───────────────────────────
 * Local, strongly-typed mocks.
 * Tip: keeping these types here makes the test self-contained and readable.
 */
const m = vi.hoisted(() => {
  // Local types to keep mocks strictly typed.
  type AuthReturn = { userId: string | null }
  type AuthFn = () => Promise<AuthReturn>

  type UserRoleLite = 'user' | 'organizer'

  interface ClerkUser {
    primaryEmailAddress?: { emailAddress?: string } | null
  }

  interface UpdateUserParams {
    username: string
  }

  interface UpdateUserMetadataParams {
    publicMetadata?: Record<string, unknown>
    privateMetadata?: Record<string, unknown>
    unsafeMetadata?: Record<string, unknown>
  }

  interface PrismaUserUpsertArgs {
    where: { clerkId: string }
    update: {
      username: string
      normalizedUsername: string
      role: UserRoleLite
      email: string
      phoneNumber: string | null
    }
    create: {
      clerkId: string
      username: string
      normalizedUsername: string
      role: UserRoleLite
      email: string
      phoneNumber: string | null
    }
  }

  type ClerkApiErrorLike = { __isClerkApi?: boolean }
  type IsClerkApiError = (e: unknown) => e is ClerkApiErrorLike

  // Typed mocks
  const authMock = vi.fn<AuthFn>(async () => ({ userId: h.USER_ID }))

  const clerkGetUserMock = vi.fn<(id: string) => Promise<ClerkUser>>(async (_id) => ({
    primaryEmailAddress: { emailAddress: h.EMAIL },
  }))

  const clerkUpdateUserMock = vi.fn(
    async (_id: string, _data: UpdateUserParams): Promise<void> => {}
  )

  const clerkUpdateUserMetaMock = vi.fn(
    async (_id: string, _data: UpdateUserMetadataParams): Promise<void> => {}
  )

  const prismaUpsertUserMock = vi.fn(
    async (_args: PrismaUserUpsertArgs): Promise<void> => {}
  )

  const revalidatePathMock = vi.fn()

  const isClerkApiErrorMock = vi.fn<IsClerkApiError>((e): e is ClerkApiErrorLike => {
    return (
      typeof e === 'object' &&
      e !== null &&
      '__isClerkApi' in e &&
      (e as ClerkApiErrorLike).__isClerkApi === true
    )
  })

  const clerkErrorMessageMock = vi.fn((_e: unknown) => 'Clerk says: username not allowed')

  return {
    authMock,
    clerkGetUserMock,
    clerkUpdateUserMock,
    clerkUpdateUserMetaMock,
    prismaUpsertUserMock,
    revalidatePathMock,
    isClerkApiErrorMock,
    clerkErrorMessageMock,
  }
})

/**
 * ───────────────────────────── Module mocks ─────────────────────────────
 * We only mock external boundaries (Clerk, Prisma, Next cache).
 * We DO NOT mock '@/lib/utils' so the action runs with the real
 * validateUsername and normalizeUsername. This makes tests reflect reality
 * and prevents drift between UI/server policy and tests.
 */
vi.mock('@clerk/nextjs/server', () => ({
  auth: m.authMock,
}))

vi.mock('@/lib/auth', () => ({
  clerk: {
    users: {
      getUser: m.clerkGetUserMock,
      updateUser: m.clerkUpdateUserMock,
      updateUserMetadata: m.clerkUpdateUserMetaMock,
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      upsert: m.prismaUpsertUserMock,
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: m.revalidatePathMock,
}))

vi.mock('@/lib/clerkErrors', () => ({
  isClerkApiError: m.isClerkApiErrorMock,
  clerkErrorMessage: m.clerkErrorMessageMock,
}))

/**
 * ───────────────────────────── Helpers ─────────────────────────────
 * Reset all mocks to the happy path before each test.
 * Note: since our "void" mocks are async, resolve with void 0 (not {}).
 */
function resetHappyPath() {
  m.authMock.mockResolvedValue({ userId: h.USER_ID })
  m.clerkGetUserMock.mockResolvedValue({
    primaryEmailAddress: { emailAddress: h.EMAIL },
  })
  m.clerkUpdateUserMock.mockResolvedValue(void 0)
  m.prismaUpsertUserMock.mockResolvedValue(void 0)
  m.clerkUpdateUserMetaMock.mockResolvedValue(void 0)
  m.revalidatePathMock.mockClear()
  m.isClerkApiErrorMock.mockClear()
  m.clerkErrorMessageMock.mockReturnValue('Clerk says: username not allowed')
}

describe('onboarding/submitOnboarding', () => {
  beforeEach(() => {
    resetHappyPath()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─────────── Auth & email ───────────
  it('returns Unauthorized when auth has no user', async () => {
    m.authMock.mockResolvedValue({ userId: null })

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(false)
    expect(res.message).toBe('Unauthorized: User not found.')
    expect(m.clerkUpdateUserMock).not.toHaveBeenCalled()
    expect(m.prismaUpsertUserMock).not.toHaveBeenCalled()
  })

  it('returns error when Clerk user has no email', async () => {
    m.clerkGetUserMock.mockResolvedValueOnce({}) // no primaryEmailAddress

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(false)
    expect(res.message).toBe('Email not found for user in Clerk.')
    expect(m.clerkUpdateUserMock).not.toHaveBeenCalled()
    expect(m.prismaUpsertUserMock).not.toHaveBeenCalled()
  })

  /**
   * ─────────── Username validation (uses real validateUsername) ───────────
   * Messages below must match the canonical messages from '@/lib/utils'.
   */
  it('validates username: empty', async () => {
    const res = await submitOnboarding('   ', 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('Required')
  })

  it('validates username: too short', async () => {
    const res = await submitOnboarding('abc', 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('Must be 4-25 chars')
  })

  it('validates username: too long (>25)', async () => {
    const tooLong = 'a'.repeat(30)
    const res = await submitOnboarding(tooLong, 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('Must be 4-25 chars')
  })

  it('validates username: invalid characters', async () => {
    const res = await submitOnboarding('Bad name!*', 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('Only letters, numbers, dot, dash and underscore')
  })

  // ─────────── Organizer phone rules ───────────
  it('requires phone for organizer', async () => {
    const res1 = await submitOnboarding(h.USERNAME_RAW, 'organizer', null)
    expect(res1.success).toBe(false)
    expect(res1.error?.field).toBe('phoneNumber')

    const res2 = await submitOnboarding(h.USERNAME_RAW, 'organizer', h.PHONE_SHORT)
    expect(res2.success).toBe(false)
    expect(res2.error?.field).toBe('phoneNumber')
  })

  // ─────────── Happy paths ───────────
  it('happy path: role user (no phone), trims & normalizes username, persists, revalidates and sets metadata', async () => {
    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(true)
    expect(res.message).toBe('Profile updated successfully!')

    // 1) Clerk username set FIRST (no clamping; policy is enforced by validateUsername)
    expect(m.clerkUpdateUserMock).toHaveBeenCalledWith(h.USER_ID, { username: h.USERNAME_VALID })

    // 2) DB update with normalized + email + role + phone=null
    expect(m.prismaUpsertUserMock).toHaveBeenCalledWith({
      where: { clerkId: h.USER_ID },
      update: {
        username: h.USERNAME_VALID,
        normalizedUsername: h.NORMALIZED, // 'john.doe' (real normalizeUsername)
        role: 'user',
        email: h.EMAIL,
        phoneNumber: null,
      },
      create: {
        clerkId: h.USER_ID,
        username: h.USERNAME_VALID,
        normalizedUsername: h.NORMALIZED,
        role: 'user',
        email: h.EMAIL,
        phoneNumber: null,
      },
    })

    // 3) Metadata (non-fatal if it fails)
    expect(m.clerkUpdateUserMetaMock).toHaveBeenCalledWith(h.USER_ID, {
      publicMetadata: { role: 'user', onboarding: true },
    })

    // 4) Revalidate
    expect(m.revalidatePathMock).toHaveBeenCalledWith('/')
  })

  it('happy path: role organizer (phone kept trimmed), persists phone', async () => {
    const res = await submitOnboarding(h.USERNAME_RAW, 'organizer', h.PHONE_VALID)
    expect(res.success).toBe(true)

    expect(m.prismaUpsertUserMock).toHaveBeenCalledWith({
      where: { clerkId: h.USER_ID },
      update: {
        username: h.USERNAME_VALID,
        normalizedUsername: h.NORMALIZED,
        role: 'organizer',
        email: h.EMAIL,
        phoneNumber: '123456789', // trimmed
      },
      create: {
        clerkId: h.USER_ID,
        username: h.USERNAME_VALID,
        normalizedUsername: h.NORMALIZED,
        role: 'organizer',
        email: h.EMAIL,
        phoneNumber: '123456789',
      },
    })
  })

  it('can persist organizer profile details without marking onboarding complete yet', async () => {
    const res = await submitOnboarding(
      h.USERNAME_RAW,
      'organizer',
      h.PHONE_VALID,
      { completeOnboarding: false }
    )

    expect(res.success).toBe(true)
    expect(m.clerkUpdateUserMetaMock).toHaveBeenCalledWith(h.USER_ID, {
      publicMetadata: { role: 'organizer' },
    })
  })

  // ─────────── Clerk updateUser error handling ───────────
  it('maps Clerk API error via isClerkApiError + clerkErrorMessage', async () => {
    m.clerkUpdateUserMock.mockRejectedValueOnce(h.clerkErr)

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(m.isClerkApiErrorMock).toHaveBeenCalled()
    expect(m.clerkErrorMessageMock).toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('Clerk says: username not allowed')
  })

  it('handles non-Clerk error when setting username in Clerk', async () => {
    m.clerkUpdateUserMock.mockRejectedValueOnce(new Error('network down'))

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('Could not set username in Clerk. Please try a different one.')
    expect(m.prismaUpsertUserMock).not.toHaveBeenCalled()
  })

  // ─────────── Prisma P2002 & generic errors ───────────
  it('handles P2002 on username/normalizedUsername as "username taken"', async () => {
    m.prismaUpsertUserMock.mockRejectedValueOnce(h.p2002User)

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('username')
    expect(res.error?.message).toBe('This username is already taken.')
  })

  it('handles P2002 on phoneNumber with dedicated message', async () => {
    const resv = await submitOnboarding(h.USERNAME_RAW, 'organizer', h.PHONE_VALID)
    expect(resv.success).toBe(true) // baseline

    // now force the DB write to fail
    m.prismaUpsertUserMock.mockRejectedValueOnce(h.p2002Phone)

    const res = await submitOnboarding(h.USERNAME_RAW, 'organizer', h.PHONE_VALID)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('phoneNumber')
    expect(res.error?.message).toBe('This phone number is already in use.')
  })

  it('handles generic Prisma error with general field', async () => {
    m.prismaUpsertUserMock.mockRejectedValueOnce(new Error('db down'))

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(false)
    expect(res.error?.field).toBe('general')
    expect(res.error?.message).toBe('Failed to save profile.')
  })

  // ─────────── Metadata failure is non-fatal ───────────
  it('still succeeds if updateUserMetadata fails (non-fatal)', async () => {
    m.clerkUpdateUserMetaMock.mockRejectedValueOnce(new Error('clerk meta write failed'))

    const res = await submitOnboarding(h.USERNAME_RAW, 'user', null)
    expect(res.success).toBe(true)
    expect(m.revalidatePathMock).toHaveBeenCalledWith('/')
  })
})
