import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserRole } from '@/generated/prisma'

const h = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<{ userId: string | null }>>(),
  findUniqueUserMock: vi.fn(),
  findUniqueEventMock: vi.fn(),
  updateEventMock: vi.fn(),
  revalidatePathMock: vi.fn<(path: string) => void>(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: h.authMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: h.findUniqueUserMock,
    },
    event: {
      findUnique: h.findUniqueEventMock,
      update: h.updateEventMock,
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: h.revalidatePathMock,
}))

import { archiveEvent } from '@/app/(dashboard)/events/actions'

describe('events/actions.archiveEvent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-27T20:15:00.000Z'))
    h.authMock.mockReset()
    h.findUniqueUserMock.mockReset()
    h.findUniqueEventMock.mockReset()
    h.updateEventMock.mockReset()
    h.revalidatePathMock.mockReset()
  })

  it('archives the event instead of deleting it', async () => {
    h.authMock.mockResolvedValue({ userId: 'org_1' })
    h.findUniqueUserMock.mockResolvedValue({
      role: UserRole.organizer,
      clerkId: 'org_1',
    })
    h.findUniqueEventMock.mockResolvedValue({
      id: 'evt_1',
      createdBy: 'org_1',
    })
    h.updateEventMock.mockResolvedValue({
      id: 'evt_1',
      archivedAt: new Date('2026-02-27T20:15:00.000Z'),
    })

    const result = await archiveEvent('evt_1')

    expect(result).toEqual({
      success: true,
      message: 'Event archived successfully.',
    })
    expect(h.updateEventMock).toHaveBeenCalledTimes(1)
    expect(h.updateEventMock).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { archivedAt: new Date('2026-02-27T20:15:00.000Z') },
    })
    expect(h.revalidatePathMock).toHaveBeenCalledWith('/organizer')
    expect(h.revalidatePathMock).toHaveBeenCalledWith('/admin')
    expect(h.revalidatePathMock).toHaveBeenCalledWith('/')
  })
})
