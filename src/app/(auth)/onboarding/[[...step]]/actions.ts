'use server'

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import type { UserRole } from '@/generated/prisma'
import { clerk } from '@/lib/auth'
import { normalizeUsername, validateUsername } from '@/lib/utils'
import { isClerkApiError, clerkErrorMessage } from '@/lib/clerkErrors'

// ---------- Helpers ----------

type WithCode = { code?: unknown }
function isP2002(e: unknown): e is { code: 'P2002' } {
  return typeof e === 'object' && e !== null && 'code' in e && (e as WithCode).code === 'P2002'
}

function getP2002Target(e: unknown): string | undefined {
  const meta = (e as { meta?: unknown })?.meta as { target?: unknown } | undefined
  const t = meta?.target
  if (!t) return undefined
  if (Array.isArray(t)) return t.join(',')
  if (typeof t === 'string') return t
  return JSON.stringify(t)
}

// Server action result type
interface SubmitOnboardingResult {
  success: boolean
  message?: string
  error?: { field?: 'username' | 'role' | 'phoneNumber' | 'general'; message: string }
}

// ---------- Action ----------

export async function submitOnboarding(
  usernameRaw: string,
  role: Extract<UserRole, 'user' | 'organizer'>,
  phoneNumber?: string | null,
  options?: { completeOnboarding?: boolean }
): Promise<SubmitOnboardingResult> {
  const { userId: clerkId } = await auth()
  if (!clerkId) {
    return { success: false, message: 'Unauthorized: User not found.' }
  }

  // Get email from Clerk (kept from your version)
  const clerkUser = await clerk.users.getUser(clerkId)
  const email = clerkUser.primaryEmailAddress?.emailAddress
  if (!email) {
    return { success: false, message: 'Email not found for user in Clerk.' }
  }

  // --- Username: trim, clamp, validate, normalize ---
  const raw = (usernameRaw ?? '').trim()
  const err = validateUsername(raw)
  if (err) {
    return { success: false, error: { field: 'username', message: err } }
  }

  const username = raw // already inside 4..25 and regex ok
  const normalized = normalizeUsername(username)

  // --- Phone validation for organizers ---
  const cleanedPhone = phoneNumber?.trim() || null
  if (role === 'organizer') {
    if (!cleanedPhone || cleanedPhone.length < 7) {
      return {
        success: false,
        message: 'Phone number is required and must be valid for organizers.',
        error: { field: 'phoneNumber', message: 'Phone number is required and must be valid.' },
      }
    }
  }

  // --- 1) Try to set the username in Clerk first (to avoid partial state) ---
  try {
    await clerk.users.updateUser(clerkId, { username })
  } catch (err: unknown) {
    if (isClerkApiError(err)) {
      return {
        success: false,
        error: { field: 'username', message: clerkErrorMessage(err) },
      }
    }
    return {
      success: false,
      error: { field: 'username', message: 'Could not set username in Clerk. Please try a different one.' },
    }
  }

  // --- 2) Persist to your DB (username + normalizedUsername + role + email + phone) ---
  try {
    const profileData = {
      username,
      normalizedUsername: normalized,
      role,
      email,
      phoneNumber: role === 'organizer' ? cleanedPhone : null,
    }

    await prisma.user.upsert({
      where: { clerkId },
      update: profileData,
      create: {
        clerkId,
        ...profileData,
      },
    })
  } catch (error: unknown) {
    // Unique constraint guard: decide which field caused the violation
    if (isP2002(error)) {
      const target = getP2002Target(error) || ''
      if (target.includes('normalizedUsername') || target.includes('username')) {
        return {
          success: false,
          message: 'This username is already taken.',
          error: { field: 'username', message: 'This username is already taken.' },
        }
      }
      if (target.includes('phoneNumber')) {
        return {
          success: false,
          message: 'This phone number is already in use by another account.',
          error: { field: 'phoneNumber', message: 'This phone number is already in use.' },
        }
      }
      return { success: false, message: 'Unique constraint violation.' }
    }

    return {
      success: false,
      message: 'An error occurred while saving your profile.',
      error: { field: 'general', message: 'Failed to save profile.' },
    }
  }

  // --- 3) Mark onboarding in Clerk public metadata (kept from your version) ---
  try {
    const publicMetadata =
      options?.completeOnboarding === false
        ? { role }
        : { role, onboarding: true }

    await clerk.users.updateUserMetadata(clerkId, { publicMetadata })
  } catch {
    // Non-fatal: continue
  }

  revalidatePath('/')
  return { success: true, message: 'Profile updated successfully!' }
}

export async function completeOnboarding(
  role: Extract<UserRole, 'user' | 'organizer'>
): Promise<SubmitOnboardingResult> {
  const { userId: clerkId } = await auth()
  if (!clerkId) {
    return { success: false, message: 'Unauthorized: User not found.' }
  }

  try {
    await clerk.users.updateUserMetadata(clerkId, {
      publicMetadata: { role, onboarding: true },
    })
  } catch {
    return {
      success: false,
      error: { field: 'general', message: 'Failed to complete onboarding.' },
    }
  }

  revalidatePath('/')
  return { success: true, message: 'Profile updated successfully!' }
}
