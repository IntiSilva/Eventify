import 'server-only';

function parseNonNegativeInt(value: string | undefined | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getRefundRequestCutoffHours(): number {
  return parseNonNegativeInt(process.env.REFUND_REQUEST_CUTOFF_HOURS, 4);
}
