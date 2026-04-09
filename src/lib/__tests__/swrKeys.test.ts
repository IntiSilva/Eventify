import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock buildEventsQS to make the tests fully deterministic and focused on swrKeys logic.
// This mirrors what the real buildEventsQS would output: a QS with search/category/location/creator/date
// and (optionally) viewTz.
vi.mock('@/lib/utils', () => {
  return {
    buildEventsQS: (filters: {
      search?: string
      category?: string
      location?: string
      creator?: string
      date?: string
      paid?: 'all' | 'paid' | 'free'
    }, viewTz?: string) => {
      const qs = new URLSearchParams()
      qs.set('search',   filters.search   ?? '')
      qs.set('category', filters.category ?? '')
      qs.set('location', filters.location ?? '')
      qs.set('creator',  filters.creator  ?? '')
      qs.set('date',     filters.date     ?? '')
      if (filters.paid && filters.paid !== 'all') qs.set('paid', filters.paid)
      if (viewTz) qs.set('viewTz', viewTz)
      return qs.toString()
    },
  }
})

// Import after the mock so swrKeys picks up our deterministic buildEventsQS
import { buildPaginatedEventsURL, buildSearchKey, swrKeys } from '@/lib/swrKeys'

describe('swrKeys helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('buildPaginatedEventsURL: composes page, limit and exactly one viewTz; preserves exclude order & duplicates', () => {
    const filters = {
      search: 'rock',
      category: 'music',
      location: '',
      creator: '',
      date: '',
      paid: 'all' as const,
    }

    const qsStr = buildPaginatedEventsURL({
      page: 3,
      limit: 12,
      filters,
      viewTz: 'America/Argentina/Buenos_Aires',
      // Deliberately include spaces and duplicates to validate current behavior
      excludeIds: ['c', 'a', 'a', 'b'],
    })

    // Must start with "?"
    expect(qsStr.startsWith('?')).toBe(true)

    // Parse the resulting querystring
    const qs = new URLSearchParams(qsStr.slice(1))

    // page/limit are present and stringified
    expect(qs.get('page')).toBe('3')
    expect(qs.get('limit')).toBe('12')

    // We expect exactly one "viewTz" occurrence in the final string
    expect((qsStr.match(/viewTz=/g) ?? []).length).toBe(1)
    expect(qs.get('viewTz')).toBe('America/Argentina/Buenos_Aires')

    // The exclude param should preserve the order and duplicates as provided by excludeIds.join(',')
    expect(qs.get('exclude')).toBe('c,a,a,b')

    // Sanity check for other keys coming from buildEventsQS mock
    expect(qs.get('search')).toBe('rock')
    expect(qs.get('category')).toBe('music')
    expect(qs.get('location')).toBe('') // empty is serialized as empty string
    expect(qs.get('creator')).toBe('')
    expect(qs.get('date')).toBe('')
    expect(qs.get('paid')).toBeNull()
  })

  it('buildPaginatedEventsURL: omits exclude when excludeIds is empty/undefined', () => {
    const filters = { search: '', category: '', location: '', creator: '', date: '' }

    const qsStr = buildPaginatedEventsURL({
      page: 1,
      limit: 8,
      filters,
      viewTz: 'UTC',
      // excludeIds omitted
    })

    const qs = new URLSearchParams(qsStr.slice(1))
    expect(qs.get('page')).toBe('1')
    expect(qs.get('limit')).toBe('8')
    expect(qs.get('viewTz')).toBe('UTC')
    expect(qs.has('exclude')).toBe(false)
  })

  it('buildSearchKey: returns search/category/location/creator/date/paid; includes viewTz only when provided', () => {
    const filters = {
      search: 'jazz',
      category: 'music',
      location: 'nyc',
      creator: 'alice',
      date: '2099-10-10',
      paid: 'free' as const,
    }

    // With a viewTz
    const withTz = buildSearchKey(filters, 'America/New_York')
    const qsWithTz = new URLSearchParams(withTz)
    expect(qsWithTz.get('search')).toBe('jazz')
    expect(qsWithTz.get('category')).toBe('music')
    expect(qsWithTz.get('location')).toBe('nyc')
    expect(qsWithTz.get('creator')).toBe('alice')
    expect(qsWithTz.get('date')).toBe('2099-10-10')
    expect(qsWithTz.get('paid')).toBe('free')
    expect(qsWithTz.get('viewTz')).toBe('America/New_York')
    expect((withTz.match(/viewTz=/g) ?? []).length).toBe(1)

    // Without a viewTz
    const withoutTz = buildSearchKey(filters)
    const qsWithoutTz = new URLSearchParams(withoutTz)
    expect(qsWithoutTz.get('paid')).toBe('free')
    expect(qsWithoutTz.get('viewTz')).toBeNull()
    expect((withoutTz.match(/viewTz=/g) ?? []).length).toBe(0)
  })

  it('swrKeys.events: prefixes /api/events with the provided querystring verbatim', () => {
    const qs = '?page=2&limit=10&search=hello'
    expect(swrKeys.events(qs)).toBe(`/api/events${qs}`)
  })
})
