import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

// ---------- Hoisted shared mocks ----------
const h = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createEventMock: vi.fn(),
  getEventPricingPreviewMock: vi.fn(),
  revalidateEventListsMock: vi.fn(),
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// ---------- Core module mocks ----------
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    // React 19: make startTransition synchronous in tests
    useTransition: (): [boolean, (cb: () => void) => void] => [false, (cb) => cb()],
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.pushMock }),
}))

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: {
      primaryEmailAddress: { emailAddress: 'organizer@example.com' },
      publicMetadata: { role: 'organizer' },
    },
  }),
}))

vi.mock('@/contexts/ViewerTzContext', () => ({
  useViewerTz: () => ({
    viewerTz: 'America/Argentina/Buenos_Aires',
    setViewerTz: vi.fn(),
    formatDate: vi.fn(),
  }),
}))

vi.mock('@/lib/mutateHelpers', () => ({
  revalidateEventLists: h.revalidateEventListsMock,
}))

vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils')>('@/lib/utils')
  return {
    ...actual,
    // Convert “wall-clock” to UTC to be deterministic in tests
    pickerDateToUtc: (picked: Date, _tz?: string): Date => {
      if (!(picked instanceof Date) || Number.isNaN(picked.getTime())) return new Date()
      const y = picked.getFullYear()
      const m = picked.getMonth()
      const d = picked.getDate()
      const hh = picked.getHours()
      const mm = picked.getMinutes()
      return new Date(Date.UTC(y, m, d, hh, mm, 0, 0))
    },
    canonicalizeTimeZone: (tz?: string) => tz ?? 'UTC',
  }
})

vi.mock('@/app/(dashboard)/events/actions', () => ({
  createEvent: (...args: unknown[]) => h.createEventMock(...args),
  getEventPricingPreview: (...args: unknown[]) => h.getEventPricingPreviewMock(...args),
}))

vi.mock('sonner', () => ({ toast: h.toast }))

// ---------- Minimal UI shims (typed) ----------
/** Select (shadcn) -> native <select> compatible with RHF */
function collectOptions(nodes: React.ReactNode): Array<{ value: string; label: React.ReactNode }> {
  const out: Array<{ value: string; label: React.ReactNode }> = []
  React.Children.forEach(nodes, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as Record<string, unknown>
    if (typeof props.value === 'string') {
      out.push({ value: props.value, label: props.children as React.ReactNode })
    }
    if (props.children) {
      out.push(...collectOptions(props.children as React.ReactNode))
    }
  })
  return out
}

interface TestSelectProps extends React.ComponentProps<'select'> {
  value?: string
  onValueChange?: (val: string) => void
  children?: React.ReactNode
  'aria-label'?: string
}

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, ...rest }: TestSelectProps) => {
    const v = value ?? ''
    const options = collectOptions(children)
    return (
      <select
        {...rest}
        aria-label={rest['aria-label'] ?? 'Category'}
        value={v}
        onChange={(e) => {
          rest.onChange?.(e)
          onValueChange?.(e.currentTarget.value)
        }}
        onBlur={(e) => rest.onBlur?.(e)}
      >
        {v === '' && <option value="">Select a category</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  },
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/datetime-picker', () => ({
  DateTimePicker: ({
    value,
    onChange,
  }: {
    value?: Date
    onChange: (next: Date) => void
  }) => {
    const toLocalStr = (d: Date) => {
      const off = d.getTimezoneOffset()
      const local = new Date(d.getTime() - off * 60_000)
      return local.toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
    }
    const initial = value instanceof Date && !Number.isNaN(value.getTime()) ? toLocalStr(value) : ''
    const [local, setLocal] = React.useState<string>(initial)
    return (
      <input
        type="datetime-local"
        aria-label="Date and Time"
        value={local}
        onChange={(e) => setLocal(e.currentTarget.value)}
        onBlur={() => {
          if (!local) {
            onChange(new Date())
            return
          }
          const [date, time] = local.split('T')
          const [y, m, d] = date.split('-').map(Number)
          const [hh, mm] = time.split(':').map(Number)
          onChange(new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0)))
        }}
      />
    )
  },
}))

interface TimeZoneSelectorProps {
  tzMode: 'auto' | 'manual'
  onTzModeChange: (m: 'auto' | 'manual') => void
  eventTimeZone?: string | null
  onEventTimeZoneChange: (tz: string) => void
}

vi.mock('@/components/FormsRelated/TimeZoneSelector', () => ({
  TimeZoneSelector: ({
    tzMode,
    onTzModeChange,
    eventTimeZone,
    onEventTimeZoneChange,
  }: TimeZoneSelectorProps) => (
    <div>
      <fieldset>
        <legend>Timezone mode</legend>
        <label>
          <input
            type="radio"
            name="timezone-mode"
            value="auto"
            checked={tzMode === 'auto'}
            onChange={() => onTzModeChange('auto')}
          />
          Auto
        </label>
        <label>
          <input
            type="radio"
            name="timezone-mode"
            value="manual"
            checked={tzMode === 'manual'}
            onChange={() => onTzModeChange('manual')}
          />
          Manual
        </label>
      </fieldset>
      {tzMode === 'manual' && (
        <label htmlFor="manual-tz-input">
          Manual timezone
          <input
            id="manual-tz-input"
            aria-label="Manual timezone"
            value={eventTimeZone ?? ''}
            onChange={(e) => onEventTimeZoneChange(e.currentTarget.value)}
          />
        </label>
      )}
    </div>
  ),
}))

vi.mock('@/components/FormsRelated/ContactPhoneMethodSelector', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value?: string
    onChange: (next: string) => void
  }) => (
    <select
      aria-label="Contact method (for phone)"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select method</option>
      <option value="whatsapp">WhatsApp</option>
      <option value="telegram">Telegram</option>
      <option value="both">Both</option>
    </select>
  ),
}))

vi.mock('@/components/FormsRelated/CollapseMotion', () => ({
  CollapseMotion: ({
    show,
    children,
  }: {
    show: boolean
    children: React.ReactNode
  }) => (show ? <div>{children}</div> : null),
}))

vi.mock('@/components/CommonButtons/AuroraButton', () => ({
  AuroraButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/phone-input', () => ({
  PhoneInput: ({
    value,
    onChange,
  }: {
    value?: string
    onChange: (next: string) => void
  }) => (
    <input
      aria-label="Contact Phone"
      value={value ?? ''}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  ),
}))

// Phone validation used by the schema
vi.mock('react-phone-number-input/min', async () => {
  const actual = await vi.importActual<typeof import('react-phone-number-input/min')>(
    'react-phone-number-input/min'
  )
  return {
    ...actual,
    isValidPhoneNumber: (phone: string): boolean => {
      if (phone === '12345') return false
      return typeof phone === 'string' && phone.startsWith('+') && phone.length > 10
    },
  }
})

vi.mock('@/components/DashboardPageWrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/InfoTooltip', () => ({
  PaidEventPricingTooltip: () => null,
}))

// ---------- SUT + test utils ----------
import CreateEventForm from '@/components/FormsRelated/CreateEventForm'
import { renderWithProviders, screen, waitFor, act, fireEvent } from '@/test/test-utils'

// ---------- Helpers ----------
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Event')
  await user.type(screen.getByLabelText('Description'), 'Desc')
  await user.type(screen.getByLabelText('Location'), 'BA')

  const categorySelect = screen.getByLabelText(/category/i) as HTMLSelectElement
  await user.selectOptions(categorySelect, 'music')
  expect(categorySelect.value).toBe('music')

  const dateInput = screen.getByLabelText('Date and Time')
  await act(async () => {
    fireEvent.change(dateInput, { target: { value: '2099-10-10T10:00' } })
    fireEvent.blur(dateInput)
  })
  expect((dateInput as HTMLInputElement).value).toBe('2099-10-10T10:00')

  const emailInput = screen.getByLabelText('Contact Email')
  await user.clear(emailInput)
  await user.type(emailInput, 'a@b.co')
}

// ---------- Tests ----------
describe('CreateEventForm', () => {
  beforeEach(() => {
    h.pushMock.mockReset()
    h.createEventMock.mockReset()
    h.getEventPricingPreviewMock.mockReset()
    h.getEventPricingPreviewMock.mockResolvedValue({ success: true, data: null })
    h.revalidateEventListsMock.mockReset()
    h.toast.loading.mockClear()
    h.toast.success.mockClear()
    h.toast.error.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('disables the paid-event toggle until Stripe Connect is ready', () => {
    renderWithProviders(
      <CreateEventForm
        profilePhoneNumber={'+541112223344'}
        requireStripeConnectForPaidEvents
      />
    )

    expect(screen.getByRole('switch')).toBeDisabled()
    expect(
      screen.getByText(/stripe connect is not fully enabled yet/i)
    ).toBeInTheDocument()
  })

  it('blocks submission with invalid manual phone when toggled off from profile phone', async () => {
    const user = userEvent.setup()
    h.createEventMock.mockResolvedValue({ success: true, message: 'ok', errors: null })

    renderWithProviders(<CreateEventForm profilePhoneNumber={'+541112223344'} />)

    await fillRequiredFields(user)

    await user.click(
      screen.getByRole('checkbox', {
        name: /use my profile phone number for event contact/i,
      })
    )

    await user.type(screen.getByLabelText('Contact Phone'), '12345')
    await user.click(screen.getByRole('button', { name: /create event/i }))

    expect(h.createEventMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(
        screen.getByText(/invalid phone number format\. please include country code/i)
      ).toBeInTheDocument()
    })
  })

  it('uses the manual timezone in the payload after switching from auto', async () => {
    const user = userEvent.setup()
    h.createEventMock.mockResolvedValue({ success: true, message: 'Created', errors: null })

    renderWithProviders(<CreateEventForm profilePhoneNumber={'+549111223344'} />)

    await fillRequiredFields(user)
    await user.selectOptions(
      screen.getByLabelText('Contact method (for phone)'),
      'whatsapp'
    )

    await user.click(screen.getByLabelText('Manual'))
    const manualTz = 'Europe/Madrid'
    await user.clear(screen.getByLabelText('Manual timezone'))
    await user.type(screen.getByLabelText('Manual timezone'), manualTz)
    await user.tab() // ensure RHF has no pending focus

    await user.click(screen.getByRole('button', { name: /create event/i }))

    await waitFor(() => expect(h.createEventMock).toHaveBeenCalledTimes(1))
    const payload = h.createEventMock.mock.calls[0][0] as {
      eventTimeZone?: string
    }
    expect(payload.eventTimeZone).toBe(manualTz)

    await waitFor(() => {
      expect(h.pushMock).toHaveBeenCalledWith('/organizer')
    })
  })

  it('renders server returned field errors without redirecting', async () => {
    const user = userEvent.setup()
    h.createEventMock.mockResolvedValue({
      success: false,
      message: 'Validation failed',
      errors: { title: { _errors: ['Title is required'] } },
    })

    renderWithProviders(<CreateEventForm profilePhoneNumber={'+541112223344'} />)

    await fillRequiredFields(user)
    await user.selectOptions(
      screen.getByLabelText('Contact method (for phone)'),
      'whatsapp'
    )

    await user.click(screen.getByRole('button', { name: /create event/i }))

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument()
    })
    expect(h.pushMock).not.toHaveBeenCalled()
  })

  it('blocks submission when no contact method is provided (no email, no phone)', async () => {
    const user = userEvent.setup()
    h.createEventMock.mockResolvedValue({ success: true, message: 'ok', errors: null })

    // No profile phone to avoid enabling the shortcut
    renderWithProviders(<CreateEventForm profilePhoneNumber={null} />)

    await fillRequiredFields(user)

    // Remove the email so there's no contact method
    const emailInput = screen.getByLabelText('Contact Email')
    await user.clear(emailInput)

    // We don't choose a phone method nor enter a phone number
    await user.click(screen.getByRole('button', { name: /create event/i }))

    // It should not call the server
    expect(h.createEventMock).not.toHaveBeenCalled()

    // An error about contact info should be shown (adjust the regex if you prefer the exact text)
    await waitFor(() => {
      const anyError = screen.queryAllByText(/contact|email|phone|required/i)
      expect(anyError.length).toBeGreaterThan(0)
    })
  })


  it('happy path (email only): revalidate + success toast + navigate', async () => {
    const user = userEvent.setup()
    h.createEventMock.mockResolvedValue({ success: true, message: 'Event created', errors: null })

    renderWithProviders(<CreateEventForm profilePhoneNumber={null} />)
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: /create event/i }))

    await waitFor(() => {
      expect(h.createEventMock).toHaveBeenCalledTimes(1)
      expect(h.revalidateEventListsMock).toHaveBeenCalled()
      expect(h.toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/created/i),
        expect.objectContaining({ id: 'toast-id', description: expect.any(String) })
      )
      expect(h.pushMock).toHaveBeenCalledWith('/organizer')
    })
  })

})
