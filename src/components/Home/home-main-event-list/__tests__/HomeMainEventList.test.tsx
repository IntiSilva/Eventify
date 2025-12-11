import React from 'react'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { renderWithProviders, screen, act, waitFor } from '@/test/test-utils'

import HomeMainEventList from '@/components/Home/home-main-event-list/HomeMainEventList'
import type { HomeMainInitialPayload } from '@/components/Home/home-main-event-list/useHomeMainEventList'
import type { EventWithCreatorAndRsvps } from '@/types/event'
import type { EventCategory } from '@/generated/prisma'

// ----------------------
// Variante del hook mockeado
// ----------------------
type Variant = 'default' | 'filtered'

const variantState: { value: Variant; listeners: Set<() => void> } = {
  value: 'default',
  listeners: new Set(),
}

vi.mock('@/components/Home/home-main-event-list/useHomeMainEventList', async () => {
  const React = await import('react')

  function useHomeMainEventList(initialEventsPayload: HomeMainInitialPayload) {
    // React-aware external store subscription
    const variant = React.useSyncExternalStore(
      (onStoreChange) => {
        variantState.listeners.add(onStoreChange)
        return () => variantState.listeners.delete(onStoreChange)
      },
      () => variantState.value,      // snapshot cliente
      () => 'default' as Variant     // snapshot server (no importa en tests)
    )

    const baseEvents = React.useMemo(
      () =>
        initialEventsPayload.data.filter(
          (event) => !initialEventsPayload.excludeFromMainListIds.includes(event.id),
        ),
      [initialEventsPayload],
    )

    const events = React.useMemo(
      () => (variant === 'filtered' ? baseEvents.slice(0, 1) : baseEvents),
      [baseEvents, variant],
    )

    const totalPages = variant === 'filtered' ? 1 : 2
    const [page, setPage] = React.useState(1)

    React.useEffect(() => {
      setPage(1)
    }, [variant, events.length])

    return {
      events,
      uiPage: page,
      uiTotalPages: totalPages,
      pagePending: false,
      isLoading: false,
      isValidating: false,
      error: undefined,
      isDesktop: true,
      smoothX: {} as unknown,
      cardRefs: { current: [] as Array<HTMLDivElement | null> },
      listTopRef: { current: null as HTMLDivElement | null },
      activeIndex: null,
      setActiveIndex: () => {},
      viewportWidth: 1200,
      handleNextPage: () => setPage((prev: number) => Math.min(totalPages, prev + 1)),
      handlePreviousPage: () => setPage((prev: number) => Math.max(1, prev - 1)),
      handleDetailsClick: () => {},
      markPageAnimating: () => {},
      markPageSettled: () => {},
      updatingIds: new Set<string>(),
      popDistance: 0,
      cardTotalWidth: 0,
      cardWidth: 0,
      rotationFactor: 0,
      activeZoneHalfWidth: 0,
    }
  }

  return {
    useHomeMainEventList,
    __setVariant: (next: Variant) => {
      variantState.value = next
      variantState.listeners.forEach((listener) => listener())
    },
  }
})


// ----------------------
// Mocks de UI usados por el componente
// ----------------------
vi.mock('@/components/Cards/ArcEventCard', () => ({
  __esModule: true,
  default: ({ event }: { event: { id: string; title: string } }) => (
    <article aria-label={event.title} data-event-id={event.id}>
      <h3>{event.title}</h3>
    </article>
  ),
}))

vi.mock('@/components/LordIcons/AnimatedCarouselArrow', () => ({
  __esModule: true,
  default: ({
    direction,
    onClick,
    disabled,
  }: {
    direction: 'left' | 'right'
    onClick: () => void
    disabled?: boolean
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Previous page' : 'Next page'}
    >
      {direction}
    </button>
  ),
}))

// ----------------------
// Helpers tipados para crear datos reales
// ----------------------
const makeEvent = (id: string, title: string): EventWithCreatorAndRsvps => {
  const now = new Date()

  // claves locales mínimas (usamos UTC para el test)
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const eventLocalDateKey = Number(`${y}${m}${d}`)
  const eventLocalMinuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes()

  const creator: EventWithCreatorAndRsvps['creator'] = {
    clerkId: 'clerk-1',
    username: 'organizer',
    firstName: 'Org',
    lastName: 'User',
    imageUrl: null,
    hasImage: false,
    role: 'organizer',
  }

  const event: EventWithCreatorAndRsvps = {
    // --- Event (Prisma) ---
    id,
    title,
    normalizedTitle: null,
    description: 'Description',
    date: now, // IMPORTANT: Date (no string)
    eventTimeZone: 'UTC',
    eventLocalDateKey,
    eventLocalMinuteOfDay,
    location: 'Buenos Aires',
    normalizedLocation: null,
    category: 'music' as EventCategory,
    featured: false,
    featuredByAdmin: false,
    createdBy: 'clerk-1',
    contactEmail: 'contact@example.com',
    contactPhone: null,
    contactPhoneApps: null,
    createdAt: now,

    // --- joins extendidos ---
    creator,
    rsvps: [],
  }

  return event
}

const createPayload = (ids: string[], exclude: string[] = []): HomeMainInitialPayload => ({
  data: ids.map((id, index) => makeEvent(id, `Event ${index + 1}`)),
  metadata: {
    totalEvents: ids.length,
    totalPages: 2,
    currentPage: 1,
    eventsPerPage: 3,
  },
  excludeFromMainListIds: exclude,
})

// ----------------------
// Capturamos el setter del mock
// ----------------------
let setVariant: (next: Variant) => void

beforeAll(async () => {
  const mod = await import('@/components/Home/home-main-event-list/useHomeMainEventList')
  setVariant = (mod as unknown as { __setVariant: (next: Variant) => void }).__setVariant
})

// ----------------------
// Tests
// ----------------------
describe('HomeMainEventList', () => {
  beforeEach(() => {
    variantState.value = 'default'
    variantState.listeners.clear()
    setVariant('default')
  })

  it('updates cards and page indicator when filters change', async () => {
    const payload = createPayload(['event-1', 'event-2', 'event-3'])

    renderWithProviders(<HomeMainEventList initialEventsPayload={payload} />)

    // Estado inicial
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3))
    await waitFor(() => expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument())

    // Cambia "filtros" (vía variante del hook) -> se reduce a 1 card y 1 página
    await act(async () => {
      setVariant('filtered')
    })

    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))

    // pagination and arrows should not render when there's only one page
    expect(screen.queryByText(/Page \d+ of \d+/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /previous page/i })).not.toBeInTheDocument();
  })

  it('respects exclusion list from initial payload', async () => {
    const payload = createPayload(['event-1', 'event-2'], ['event-2'])

    renderWithProviders(<HomeMainEventList initialEventsPayload={payload} />)

    await waitFor(() => expect(screen.getByLabelText('Event 1')).toBeInTheDocument())
    expect(screen.queryByLabelText('Event 2')).not.toBeInTheDocument()
  })
})
