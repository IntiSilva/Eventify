import { test, expect, type Browser, type Page } from '@playwright/test';
import { isAuth as is } from './helpers/env';
import { newE2EContext } from './helpers/new-context';

// Use admin session by default for tests that rely on `page`
test.use({ storageState: 'e2e/.auth/admin.json' });

function getBaseURL(): string {
  return (test.info().project.use.baseURL as string) ?? 'http://localhost:3000';
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────────*/

/**
 * Creates a brand new browser context with a given storageState
 * (e.g. organizer, admin).
 */
async function newPageWithState(browser: Browser, storageState: string): Promise<Page> {
  const ctx = await newE2EContext(browser, {
    baseURL: getBaseURL(),
    storageState,
  });
  const page = await ctx.newPage();
  return page;
}

/**
 * Polls Home until at least one event card is rendered.
 * This is a smoke check that the main list is not empty / broken.
 */
async function expectHomeHasAtLeastOneCard(page: Page) {
  const cardCountForHome = () =>
    page.getByTestId('arc-card-root').count();

  await expect.poll(cardCountForHome, { timeout: 30_000 }).toBeGreaterThan(0);
}

/* ─────────────────────────────────────────────────────────────────────────────-
 * Spec 00 — Home smoke (organizer, admin)
 * ─────────────────────────────────────────────────────────────────────────── */

test.describe('00 — Home smoke', () => {
  test.setTimeout(120_000);

  test('organizer sees Home with events and a way to manage/create events', async ({ browser }) => {
    test.skip(!is('admin'));

    const page = await newPageWithState(browser, 'e2e/.auth/organizer.json');

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Home should render at least one event card
    await expectHomeHasAtLeastOneCard(page);

    // There should be at least one link to the organizer dashboard
    const createOrOrganizerLinkCandidates = [
      page.locator('a[href="/organizer"]'),
    ];

    const counts = await Promise.all(
      createOrOrganizerLinkCandidates.map((loc) => loc.count()),
    );

    expect(
      counts.some((c) => c > 0),
    ).toBe(true);

    await page.context().close();
  });

  test('admin sees Home with events and a link to the admin dashboard', async ({ page }) => {
    test.skip(!is('admin'));

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Home should render at least one event card
    await expectHomeHasAtLeastOneCard(page);

    // And there must be a visible link to the admin dashboard
    const adminLink = page.locator('a[href="/admin"]').first();
    await expect(adminLink).toBeVisible({ timeout: 10_000 });
  });
});
