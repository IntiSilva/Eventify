import { test, expect, type Browser, type Page } from '@playwright/test';
import { isAuth as is } from './helpers/env';

// Use admin session by default (for tests that use `page`)
test.use({ storageState: 'e2e/.auth/admin.json' });

function getBaseURL(): string {
  return (test.info().project.use.baseURL as string) ?? 'http://localhost:3000';
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────────*/

async function newPageWithState(browser: Browser, storageState: string): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: getBaseURL(),
    storageState,
  });
  const page = await ctx.newPage();
  page.on('close', () => ctx.close());
  return page;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Spec 07 — Role guards for /admin and /organizer
 * ────────────────────────────────────────────────────────────────────────────*/

test.describe('07 — Role guards for /admin and /organizer', () => {
  test.setTimeout(120_000);

  /* ───── /admin ───── */

  test('admin can access /admin dashboard', async ({ page }) => {
    test.skip(!is('admin'));

    await page.goto('/admin');

    // It should remain on /admin
    await expect(page).toHaveURL(/\/admin(?:[/?#]|$)/);
  });

  test('organizer is redirected away from /admin', async ({ browser }) => {
    test.skip(!is('admin'));

    const page = await newPageWithState(browser, 'e2e/.auth/organizer.json');

    await page.goto('/admin');

    // Middleware: organizer is not admin → redirect to "/"
    await page.waitForURL(
      (u) => {
        const url = typeof u === 'string' ? new URL(u) : u;
        return url.pathname === '/';
      },
      { timeout: 10_000 },
    );

    // Just to be sure, confirm we did not end up on /admin
    expect(new URL(page.url()).pathname).not.toBe('/admin');
  });

  test('regular user is redirected away from /admin', async ({ browser }) => {
    test.skip(!is('admin'));

    const page = await newPageWithState(browser, 'e2e/.auth/user.json');

    await page.goto('/admin');

    // Middleware: user is not admin → redirect to "/"
    await page.waitForURL(
      (u) => {
        const url = typeof u === 'string' ? new URL(u) : u;
        return url.pathname === '/';
      },
      { timeout: 10_000 },
    );

    expect(new URL(page.url()).pathname).not.toBe('/admin');
  });

  /* ───── /organizer ───── */

  test('organizer can access /organizer dashboard', async ({ browser }) => {
    test.skip(!is('admin'));

    const page = await newPageWithState(browser, 'e2e/.auth/organizer.json');

    await page.goto('/organizer');

    // It should remain on /organizer
    await expect(page).toHaveURL(/\/organizer(?:[/?#]|$)/);
  });

  test('admin can also access /organizer dashboard', async ({ page }) => {
    test.skip(!is('admin'));

    // The default session for this spec is admin.json
    await page.goto('/organizer');

    // Middleware allows organizer OR admin
    await expect(page).toHaveURL(/\/organizer(?:[/?#]|$)/);
  });

  test('regular user is redirected away from /organizer', async ({ browser }) => {
    test.skip(!is('admin'));

    const page = await newPageWithState(browser, 'e2e/.auth/user.json');

    await page.goto('/organizer');

    // Middleware: role !== organizer && role !== admin → redirect to "/"
    await page.waitForURL(
      (u) => {
        const url = typeof u === 'string' ? new URL(u) : u;
        return url.pathname === '/';
      },
      { timeout: 10_000 },
    );

    expect(new URL(page.url()).pathname).not.toBe('/organizer');
  });
});
