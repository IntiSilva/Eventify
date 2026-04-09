type StripeConnectReadinessInput = {
  stripeConnectAccountId?: string | null;
  stripeConnectPayoutsEnabled?: boolean | null;
  stripeConnectChargesEnabled?: boolean | null;
  stripeConnectDetailsSubmitted?: boolean | null;
};

function isRealConnectedAccountId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.startsWith('acct_');
}

export function isStripeConnectReady(
  input: StripeConnectReadinessInput | null | undefined
): boolean {
  if (!input) return false;

  return (
    isRealConnectedAccountId(input.stripeConnectAccountId) &&
    Boolean(input.stripeConnectPayoutsEnabled) &&
    Boolean(input.stripeConnectChargesEnabled) &&
    Boolean(input.stripeConnectDetailsSubmitted)
  );
}
