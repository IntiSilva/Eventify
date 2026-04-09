import { vi } from 'vitest';

type StripeConnectReadinessModule = typeof import('@/lib/payments/stripeConnectReadiness');
type PlatformFeeModule = typeof import('@/lib/payments/platformFee.server');

type ConnectConfigMockState = {
  connectReady?: boolean;
  platformFeeBps?: number;
  platformFeeCents?: number;
};

export async function buildConnectConfigMock(h: ConnectConfigMockState) {
  const actual = await vi.importActual<StripeConnectReadinessModule>(
    '@/lib/payments/stripeConnectReadiness'
  );

  return {
    isStripeConnectReady: (
      input: Parameters<StripeConnectReadinessModule['isStripeConnectReady']>[0]
    ) =>
      typeof h.connectReady === 'boolean'
        ? h.connectReady
        : actual.isStripeConnectReady(input),
  };
}

export async function buildPlatformFeeServerMock(h: ConnectConfigMockState) {
  const actual = await vi.importActual<PlatformFeeModule>(
    '@/lib/payments/platformFee.server'
  );

  return {
    getPlatformFeeBps: () =>
      typeof h.platformFeeBps === 'number'
        ? h.platformFeeBps
        : actual.getPlatformFeeBps(),
    getPlatformFeeCents: () =>
      typeof h.platformFeeCents === 'number'
        ? h.platformFeeCents
        : actual.getPlatformFeeCents(),
  };
}
