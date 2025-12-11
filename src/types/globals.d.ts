export {};

//This is for Clerk's session token in middleware
declare global {
  interface CustomJwtSessionClaims {
    email?: string;
    publicMetadata?: {
      role?: 'admin' | 'user' | 'organizer';
      onboarding?: boolean;
    }
  }
}

/**
 * Standard alias for Next's (flexible) search params.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * A value that may be already resolved or come wrapped in a Promise.
 */
export type SearchParamsPromise = Promise<RawSearchParams> | undefined;

