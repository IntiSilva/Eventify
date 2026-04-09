import 'server-only';

function parseNonNegativeInt(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function getPlatformFeeBps(): number {
  return parseNonNegativeInt(process.env.PLATFORM_FEE_BPS);
}

export function getPlatformFeeCents(): number {
  return parseNonNegativeInt(process.env.PLATFORM_FEE_CENTS);
}
