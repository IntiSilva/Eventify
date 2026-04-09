import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: h.push,
    replace: h.replace,
  }),
}));

vi.mock('@/components/LordIcons/AnimatedIcon', () => ({
  __esModule: true,
  default: () => <div data-testid="animated-icon" />,
}));

import CheckoutSuccessPage from '@/app/(dashboard)/checkout/[eventId]/success/page';

describe('Checkout success copy', () => {
  beforeEach(() => {
    h.push.mockReset();
    h.replace.mockReset();
  });

  it('does not promise RSVP confirmation unconditionally', () => {
    render(<CheckoutSuccessPage />);

    expect(
      screen.getByText(/attendance is confirmed only after final server validation/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/your payment will be refunded automatically/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/your RSVP will be confirmed once payment succeeds/i)
    ).not.toBeInTheDocument();
  });
});
