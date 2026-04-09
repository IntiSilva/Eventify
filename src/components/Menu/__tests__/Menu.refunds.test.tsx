import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Menu from '@/components/Menu/Menu';
import {
  PaymentStatus,
  RSVPAttendanceEntitlementStatus,
  RSVPStatus,
} from '@/generated/prisma';

const h = vi.hoisted(() => ({
  useViewerPaymentStatus: vi.fn(),
  getMyRefundContextForEvent: vi.fn(),
  useEvent: vi.fn(),
}));

type MockMenuEvent = {
  id: string;
  title: string;
  description: string;
  date: string;
  location: string;
  eventTimeZone: string;
  isPaid: boolean;
  priceCents: number;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactPhoneApps: 'whatsapp' | 'telegram' | 'both' | null;
  featured: boolean;
  createdBy: string;
  rsvps: Array<{
    id: string;
    status: RSVPStatus;
    attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus;
    reminderScheduledAt: string | null;
    user: {
      clerkId: string;
      username: string;
    };
  }>;
  creator: {
    clerkId: string;
    username: string;
  };
};

const mockEvent: MockMenuEvent = {
  id: 'evt_1',
  title: 'Paid Event',
  description: 'A paid event',
  date: '2026-03-10T20:00:00.000Z',
  location: 'Main Hall',
  eventTimeZone: 'UTC',
  isPaid: true,
  priceCents: 2500,
  currency: 'usd',
  contactEmail: null,
  contactPhone: null,
  contactPhoneApps: null,
  featured: false,
  createdBy: 'org_1',
  rsvps: [
    {
      id: 'rsvp_1',
      status: RSVPStatus.confirmed,
      attendanceEntitlementStatus: RSVPAttendanceEntitlementStatus.active,
      reminderScheduledAt: null,
      user: {
        clerkId: 'buyer_1',
        username: 'buyer',
      },
    },
  ],
  creator: {
    clerkId: 'org_1',
    username: 'organizer',
  },
};

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: { id: 'buyer_1' },
    isSignedIn: true,
    isLoaded: true,
  }),
}));

vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      layout: _layout,
      layoutRoot: _layoutRoot,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      layout?: boolean;
      layoutRoot?: boolean;
    }) => <div {...props}>{children}</div>,
    span: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
}));

vi.mock('@/components/InfoTooltip', () => ({
  TimezoneInfoTooltip: () => null,
  AttendeesLegendTooltip: () => null,
}));

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: () => true,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  getBadgeState: () => 'none',
  formatTimeZoneLabel: (value: string) => value,
  tzEqualForInstant: () => true,
  canonicalizeTimeZone: (value: string) => value,
  formatPrice: () => '$25.00',
}));

vi.mock('@/contexts/ViewerTzContext', () => ({
  useViewerTz: () => ({
    viewerTz: 'UTC',
    formatDate: () => 'Mar 10, 2026',
  }),
}));

vi.mock('@/contexts/EventsContext', () => ({
  useEvent: h.useEvent,
  useRsvpActions: () => ({
    commitReminder: vi.fn(),
    setRsvpPending: vi.fn(),
  }),
  useFeaturedSWRKeys: () => ({ getFeaturedKeys: () => [] }),
  useMainListSWRKeys: () => ({ getMainListKeys: () => [] }),
  emitFeaturedChange: vi.fn(),
  useStoreWriters: () => ({ upsertEvents: vi.fn() }),
}));

vi.mock('@/app/(dashboard)/rsvp/actions', () => ({
  toggleRSVP: vi.fn(),
  reactivateAlreadyPaidRsvp: vi.fn(),
  updateReminderPreference: vi.fn(),
  getMyRefundContextForEvent: h.getMyRefundContextForEvent,
}));

vi.mock('@/lib/mutateHelpers', () => ({
  patchReminderEverywhere: vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: () => <button type="button">Switch</button>,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span>down</span>,
  ChevronUp: () => <span>up</span>,
}));

vi.mock('@/components/UserAvatar', () => ({ default: () => <div>UserAvatar</div> }));
vi.mock('@/components/AvatarStack', () => ({ default: () => <div>AvatarStack</div> }));
vi.mock('@/components/FormsRelated/EditEventForm', () => ({ default: () => <div>EditEventForm</div> }));
vi.mock('@/components/Menu/MenuArchiveEventButton', () => ({ default: () => <button type="button">Archive</button> }));
vi.mock('@/components/ReminderToastContent', () => ({ default: () => <div>ReminderToast</div>, REMINDER_TOAST_ID: 'reminder' }));
vi.mock('@/components/Badges/AdminFeaturedBadge', () => ({ default: () => null }));
vi.mock('@/components/Badges/AuroraFeaturedBadge', () => ({ default: () => null }));
vi.mock('@/components/Badges/PricingBadge', () => ({ default: () => <div>PricingBadge</div> }));
vi.mock('@/components/LordIcons/AnimatedIcon', () => ({ default: () => <span>AnimatedIcon</span> }));
vi.mock('@/components/LordIcons/InToHoverIcon', () => ({ default: () => <span>Icon</span> }));
vi.mock('lottie-react', () => ({ default: () => <div>Lottie</div> }));
vi.mock('@/components/AnimatedLogos/AnimatedStripeLogo', () => ({ StripeLogoDraw: () => <span>Stripe</span> }));
vi.mock('@/components/Payments/RefundMenuView', () => ({ default: () => <div>Refund view</div> }));

vi.mock('@/components/Payments/PaidTicketInfoPopover', () => ({
  default: ({
    children,
    onOpenChange,
    onRequestRefund,
    refundCtaState,
    refundBlockedMessage,
    portalled,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
    onRequestRefund?: () => void;
    refundCtaState?: string;
    refundBlockedMessage?: string | null;
    portalled?: boolean;
  }) => (
    <div>
      <div data-testid="refund-cta-state">{refundCtaState}</div>
      <div data-testid="refund-blocked-message">{refundBlockedMessage ?? ''}</div>
      <div data-testid="popover-portalled">{String(portalled)}</div>
      {children}
      <button type="button" onClick={() => onOpenChange?.(true)}>
        Open paid popover
      </button>
      <button type="button" onClick={() => onRequestRefund?.()}>
        Request refund entry
      </button>
    </div>
  ),
}));

vi.mock('@/lib/icons', () => ({
  WhatsappAnimatedIcon: {},
  WhatsappAnimatedIconHover: {},
  TelegramAnimatedIcon: {},
  TelegramAnimatedIconHover: {},
  LottieDoubleTapAnimatedIcon: {},
  CalendarAnimatedIcon: {},
  LocationAnimatedIcon: {},
  BellAnimatedIcon: {},
  BellAnimatedIconHover: {},
  MailAnimatedIcon: {},
  MailAnimatedIconHover: {},
  CheckAnimatedIcon: {},
  CheckAnimatedIconHover: {},
}));

vi.mock('@/lib/payments/useViewerPaymentStatus', () => ({
  useViewerPaymentStatus: h.useViewerPaymentStatus,
}));


if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}
describe('Menu refund flow', () => {
  beforeEach(() => {
    h.useEvent.mockImplementation(() => mockEvent);
  });

  it('hides the ticket-history pill when the viewer has no payment history', () => {
    const eventWithEmail = {
      ...mockEvent,
      contactEmail: 'host@example.com',
    };

    h.useViewerPaymentStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      ticketState: 'none',
      hasTicketHistory: false,
      ticketHistoryPillLabel: null,
      userId: 'buyer_1',
      isSignedIn: true,
    });

    const { rerender } = render(
      <Menu
        mode="non-editable"
        event={eventWithEmail as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Open paid ticket details' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open refunded ticket details' })
    ).not.toBeInTheDocument();
    expect(h.useViewerPaymentStatus.mock.calls.at(-1)?.[0]).toBe('evt_1');
    expect(h.useViewerPaymentStatus.mock.calls.at(-1)?.[1]).toBe(true);

    rerender(
      <Menu
        mode="non-editable"
        event={{
          ...eventWithEmail,
          id: 'evt_2',
          title: 'Paid Event Two',
        } as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    expect(h.useViewerPaymentStatus.mock.calls.at(-1)?.[0]).toBe('evt_2');
    expect(h.useViewerPaymentStatus.mock.calls.at(-1)?.[1]).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Open paid ticket details' })
    ).not.toBeInTheDocument();
  });

  it('shows the paid ticket-history pill and enters refund view when eligibility allows it', async () => {
    const user = userEvent.setup();
    h.getMyRefundContextForEvent.mockResolvedValue({
      success: true,
      data: {
        paymentId: 'pay_1',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: null,
        canRequest: true,
        blockedReason: null,
        blockedMessage: null,
      },
    });

    h.useViewerPaymentStatus.mockImplementation((_eventId: string, enabled: boolean) => ({
      data: enabled
        ? {
            eventId: 'evt_1',
            ticketState: 'paid',
            alreadyPaid: true,
            payment: {
              amountCents: 2500,
              currency: 'usd',
              paidAt: '2026-03-01T20:00:00.000Z',
            },
          }
        : undefined,
      isLoading: false,
      ticketState: enabled ? 'paid' : 'none',
      hasTicketHistory: enabled,
      ticketHistoryPillLabel: enabled ? 'Paid' : null,
      userId: 'buyer_1',
      isSignedIn: true,
    }));

    render(
      <Menu
        mode="non-editable"
        event={mockEvent as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    expect(h.useViewerPaymentStatus.mock.calls.at(-1)?.[1]).toBe(true);
    expect(screen.getByRole('button', { name: 'Open paid ticket details' })).toHaveTextContent(
      'Paid'
    );

    await user.click(screen.getByRole('button', { name: 'Open paid popover' }));

    await waitFor(() => {
      expect(h.getMyRefundContextForEvent).toHaveBeenCalledWith('evt_1');
    });

    await user.click(screen.getByRole('button', { name: 'Request refund entry' }));

    expect(screen.getByText('Refund view')).toBeInTheDocument();
  });

  it('disables the refund entry when server eligibility says cutoff closed and does not open refund view', async () => {
    const user = userEvent.setup();

    h.getMyRefundContextForEvent.mockResolvedValue({
      success: true,
      data: {
        paymentId: 'pay_1',
        paymentStatus: PaymentStatus.succeeded,
        refundRequest: null,
        canRequest: false,
        blockedReason: 'CUTOFF',
        blockedMessage: 'Refund requests must be submitted at least 4 hours before the event.',
      },
    });

    h.useViewerPaymentStatus.mockImplementation((_eventId: string, enabled: boolean) => ({
      data: enabled
        ? {
            eventId: 'evt_1',
            ticketState: 'paid',
            alreadyPaid: true,
            payment: {
              amountCents: 2500,
              currency: 'usd',
              paidAt: '2026-03-01T20:00:00.000Z',
            },
          }
        : undefined,
      isLoading: false,
      ticketState: enabled ? 'paid' : 'none',
      hasTicketHistory: enabled,
      ticketHistoryPillLabel: enabled ? 'Paid' : null,
      userId: 'buyer_1',
      isSignedIn: true,
    }));

    render(
      <Menu
        mode="non-editable"
        event={mockEvent as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open paid popover' }));

    await waitFor(() => {
      expect(h.getMyRefundContextForEvent).toHaveBeenCalledWith('evt_1');
    });

    expect(screen.getByTestId('refund-cta-state')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('refund-blocked-message')).toHaveTextContent(
      'Refund requests must be submitted at least 4 hours before the event.'
    );

    await user.click(screen.getByRole('button', { name: 'Request refund entry' }));
    expect(screen.queryByText('Refund view')).not.toBeInTheDocument();
  });

  it('treats confirmed RSVP with non-active entitlement as not attending in the Menu predicate', () => {
    const buildEvent = (entitlement: RSVPAttendanceEntitlementStatus) => ({
      ...mockEvent,
      date: '2099-03-10T20:00:00.000Z',
      isPaid: false,
      rsvps: [
        {
          id: 'rsvp_entitlement',
          status: RSVPStatus.confirmed,
          attendanceEntitlementStatus: entitlement,
          reminderScheduledAt: null,
          user: {
            clerkId: 'buyer_1',
            username: 'buyer',
          },
        },
      ],
    });

    const stage = { current: buildEvent(RSVPAttendanceEntitlementStatus.refund_pending_hold) };
    h.useEvent.mockImplementation(() => stage.current);
    h.useViewerPaymentStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      ticketState: 'none',
      hasTicketHistory: false,
      ticketHistoryPillLabel: null,
      userId: 'buyer_1',
      isSignedIn: true,
    });

    const { rerender } = render(
      <Menu
        mode="non-editable"
        event={stage.current as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    expect(screen.getByText('Attend Event?')).toBeInTheDocument();
    expect(screen.queryByText('You are Attending')).not.toBeInTheDocument();

    stage.current = buildEvent(RSVPAttendanceEntitlementStatus.revoked_refunded);
    rerender(
      <Menu
        mode="non-editable"
        event={stage.current as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    expect(screen.getByText('Attend Event?')).toBeInTheDocument();
    expect(screen.queryByText('You are Attending')).not.toBeInTheDocument();

    stage.current = buildEvent(RSVPAttendanceEntitlementStatus.active);
    rerender(
      <Menu
        mode="non-editable"
        event={stage.current as never}
        open
        onOpenChange={() => {}}
        onEventUpdate={() => {}}
      />
    );

    expect(screen.getByText('You are Attending')).toBeInTheDocument();
  });
});
