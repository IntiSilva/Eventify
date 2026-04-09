import { describe, expect, it, vi } from 'vitest'
import { refreshClerkClientStateAfterOnboarding } from '@/components/Onboarding/refreshClerkClientState'

describe('refreshClerkClientStateAfterOnboarding', () => {
  it('reloads the Clerk user, reloads the session when present, then refreshes the router', async () => {
    const userReload = vi.fn().mockResolvedValue(undefined)
    const sessionReload = vi.fn().mockResolvedValue(undefined)
    const routerRefresh = vi.fn()

    await refreshClerkClientStateAfterOnboarding({
      user: { reload: userReload },
      session: { reload: sessionReload },
      router: { refresh: routerRefresh },
    })

    expect(userReload).toHaveBeenCalledTimes(1)
    expect(sessionReload).toHaveBeenCalledTimes(1)
    expect(routerRefresh).toHaveBeenCalledTimes(1)
    expect(userReload.mock.invocationCallOrder[0]).toBeLessThan(
      sessionReload.mock.invocationCallOrder[0]
    )
    expect(sessionReload.mock.invocationCallOrder[0]).toBeLessThan(
      routerRefresh.mock.invocationCallOrder[0]
    )
  })

  it('can skip the router refresh when the caller needs to stay on the onboarding route', async () => {
    const userReload = vi.fn().mockResolvedValue(undefined)
    const sessionReload = vi.fn().mockResolvedValue(undefined)
    const routerRefresh = vi.fn()

    await refreshClerkClientStateAfterOnboarding({
      user: { reload: userReload },
      session: { reload: sessionReload },
      router: { refresh: routerRefresh },
      refreshRouter: false,
    })

    expect(userReload).toHaveBeenCalledTimes(1)
    expect(sessionReload).toHaveBeenCalledTimes(1)
    expect(routerRefresh).not.toHaveBeenCalled()
  })
})
