import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ViewerTzProvider, useViewerTz } from '@/contexts/ViewerTzContext'

// --- Minimal utils mock: keep semantics simple and deterministic for tests ---
vi.mock('@/lib/utils', () => ({
  canonicalizeTimeZone: (tz: string) => tz,
  isValidIanaTimeZone: (tz: string) => Boolean(tz) && tz !== 'Invalid/Zone',
  // Keep equality strict by string for tests (good enough for these contracts)
  tzEqualForInstant: (a: string, b: string) => a === b,
}))

// --- Test helper consumer to read the context value ---
function TzConsumer() {
  const { viewerTz } = useViewerTz()
  return <div data-testid="tz">{viewerTz}</div>
}

function installRafSpy() {
  const rafSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((cb: FrameRequestCallback): number => {
      cb(0) // DOMHighResTimeStamp
      return 1
    })

  const cancelSpy = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((_id: number): void => {})

  return () => {
    rafSpy.mockRestore()
    cancelSpy.mockRestore()
  }
}


// --- Cookie shim: capture writes and control the readable cookie string ---
const installCookieShim = (initialCookie = '') => {
  let cookieString = initialCookie
  const writes: string[] = []

  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  // Define getter/setter on document.cookie
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      return cookieString
    },
    set(v: string) {
      writes.push(v)
      // naive merge: replace/append the viewerTz; good enough for tests
      const m = v.match(/^viewerTz=([^;]+)/)
      if (m) {
        const kv = `viewerTz=${m[1]}`
        // keep other attrs (Max-Age, Path...) in writes only; getter returns key=value pairs
        cookieString = cookieString
          ? cookieString.replace(/(?:^|;\s*)viewerTz=[^;]*/, kv)
          : kv
      }
    },
  })

  return {
    writes,
    getCookie: () => cookieString,
    restore: () => {
      // restore default descriptor so we don't leak between tests
      if (desc) Object.defineProperty(document, 'cookie', desc)
    },
  }
}

class FakeDateTimeFormat implements Intl.DateTimeFormat {
  private tz: string
  constructor(tz: string) {
    this.tz = tz
  }

  // --- methods that aren't used in the tests can safely return dummies ---

  format(_date?: number | Date): string {
    return ''
  }

  formatToParts(_date?: number | Date): Intl.DateTimeFormatPart[] {
    return []
  }

  // Note the widened param types + correct return type for range APIs
  formatRange(
    _startDate: number | bigint | Date,
    _endDate: number | bigint | Date
  ): string {
    return ''
  }

  formatRangeToParts(
    _startDate: number | bigint | Date,
    _endDate: number | bigint | Date
  ): Intl.DateTimeRangeFormatPart[] {
    return []
  }

  resolvedOptions(): Intl.ResolvedDateTimeFormatOptions {
    return {
      locale: 'en-US',
      numberingSystem: 'latn',
      calendar: 'gregory',
      timeZone: this.tz,
    }
  }
}

function installIntlDetectedTz(detectedTz: string) {
  const spy = vi
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(
      (..._args: ConstructorParameters<typeof Intl.DateTimeFormat>) =>
        new FakeDateTimeFormat(detectedTz)
    )
  return () => spy.mockRestore()
}


describe('ViewerTzContext — cookie sync & detection', () => {
  let restoreRaf: (() => void) | null = null
  let restoreIntl: (() => void) | null = null
  let cookie: { writes: string[]; getCookie: () => string; restore: () => void } | null = null

  beforeEach(() => {
    restoreRaf = installRafSpy()
  })
  afterEach(() => {
    restoreRaf?.()
    restoreIntl?.()
    cookie?.restore()
    restoreRaf = null
    restoreIntl = null
    cookie = null
    vi.resetAllMocks()
  })

  it('renders the SSR-seeded tz with no flicker and writes NO cookie if detected tz equals seed', async () => {
    // Given: cookie already has the SSR tz
    const SSR_TZ = 'America/Argentina/Buenos_Aires'
    cookie = installCookieShim(`viewerTz=${SSR_TZ}`)
    restoreIntl = installIntlDetectedTz(SSR_TZ)

    render(
      <ViewerTzProvider initialViewerTz={SSR_TZ}>
        <TzConsumer />
      </ViewerTzProvider>
    )

    // Then: initial render shows SSR tz (no flicker to UTC or other)
    expect(screen.getByTestId('tz').textContent).toBe(SSR_TZ)

    // And: since detected tz equals SSR, no rAF update occurs and NO cookie write
    await waitFor(() => {
      expect(cookie!.writes.length).toBe(0)
    })
  })

  it('updates the tz once via rAF when detected tz differs and writes the cookie exactly once', async () => {
    // Given: cookie starts with SSR seed (so initial persist won't write)
    const SSR_TZ = 'UTC'
    const DETECTED_TZ = 'America/Argentina/Buenos_Aires'
    cookie = installCookieShim(`viewerTz=${SSR_TZ}`)
    restoreIntl = installIntlDetectedTz(DETECTED_TZ)

    render(
      <ViewerTzProvider initialViewerTz={SSR_TZ}>
        <TzConsumer />
      </ViewerTzProvider>
    )

    // When: rAF fires, state should update to detected tz
    await waitFor(() => {
      expect(screen.getByTestId('tz').textContent).toBe(DETECTED_TZ)
    })

    // Then: cookie should be written exactly once with the detected tz
    expect(cookie!.writes.length).toBe(1)
    // Cookie value is URL-encoded by the provider; decode before asserting
    const encoded = cookie!.writes[0].match(/viewerTz=([^;]+)/)?.[1]
    expect(encoded).toBeTruthy()
    expect(decodeURIComponent(encoded!)).toBe(DETECTED_TZ)
    expect(cookie!.writes[0]).toMatch(/Max-Age=\d+/)
    expect(cookie!.writes[0]).toMatch(/Path=\//)
  })
})
