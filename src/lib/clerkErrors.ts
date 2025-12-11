export type ClerkApiErr = {
  clerkError?: boolean;
  message?: string;
  errors?: Array<{ message?: string; long_message?: string }>;
  status?: number;
};

export function isClerkApiError(err: unknown): err is ClerkApiErr {
  return !!err && typeof err === 'object' && 'clerkError' in err;
}

export function clerkErrorMessage(e: ClerkApiErr): string {
  return (
    e?.errors?.[0]?.long_message ||
    e?.errors?.[0]?.message ||
    e?.message ||
    'Clerk request failed.'
  );
}
