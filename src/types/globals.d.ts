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
  // Minimal NetworkInformation typing (enough for saveData + effectiveType)
  interface NetworkInformation {
    saveData?: boolean;
    effectiveType?: 'slow-2g' | '2g' | '3g' | '4g' | (string & {});
  }

  interface Navigator {
    connection?: NetworkInformation;
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

