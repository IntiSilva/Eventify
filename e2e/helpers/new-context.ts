import type { Browser } from '@playwright/test';
import { getBaseURL } from './env';

type CtxOptions = Parameters<Browser['newContext']>[0];

const E2E_TZ = process.env.E2E_TZ ?? 'America/Argentina/Buenos_Aires';

export async function newE2EContext(browser: Browser, opts: CtxOptions = {}) {
  const baseURL = opts.baseURL ?? getBaseURL();

  return browser.newContext({
    baseURL,
    timezoneId: E2E_TZ,
    reducedMotion: 'reduce',
    ...opts,
  });
}
