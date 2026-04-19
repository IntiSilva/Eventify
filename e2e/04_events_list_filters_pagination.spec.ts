import { test, expect, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  createEventAsOrganizer,
  searchEventByTitleFromHome,
  applyCategoryFilter,
  applyAdvancedDateFilterForTomorrow,
  applyAdvancedLocationFilter,
  clearSearchbarSearchText,
  waitForAnyEventsApi,
  expectHomeHasPagination,
} from './helpers/home-list-filters';
import { isAuth as is } from './helpers/env';

// --- Stable ID per spec run ---------------------------------------------------
const RUN_ID = (process.env.E2E_RUN_ID ?? randomUUID()).slice(0, 8);
const titleOf = (prefix: string) => `${prefix} ${RUN_ID}`;

// Use the admin session for navigating Home
test.use({ storageState: 'e2e/.auth/admin.json' });

/* ──────────────────────────────────────────────────────────────────────────────
 * Spec 04 — Home list filters (search + category + advanced filters)
 * ────────────────────────────────────────────────────────────────────────────*/

test.describe('04 — Home list filters (search + category + advanced filters)', () => {
  // Give a bit more room for seeding + network + SWR
  test.setTimeout(120_000);

  test('applies category=Music and keeps the seeded card visible', async ({
    page,
    browser,
  }) => {
    test.skip(!is('admin'));

    const title = titleOf('E2E 04 - category');

    await createEventAsOrganizer(browser as Browser, title, {
      description: 'E2E category filter seed',
      category: 'Music',
    });

    // 1) Search by title to make sure the event exists
    const card = await searchEventByTitleFromHome(page, title);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // 2) Keep title search active and apply category filter = Music.
    // This validates that category filtering does not exclude the seeded event
    // while avoiding broad-result pagination drift in the assertion.
    await applyCategoryFilter(page, 'Music');

    // 3) Find the same card by title under search + category filters
    const filteredCard = page
      .getByTestId('arc-card-root')
      .filter({
        has: page
          .getByTestId('arc-card-title')
          .filter({ hasText: title }),
      })
      .first();

    await expect(filteredCard).toBeVisible({ timeout: 15_000 });
  });

  test(
    'keeps the seeded card visible when applying the advanced date filter (tomorrow)',
    async ({ page, browser }) => {
      test.skip(!is('admin'));

      const title = titleOf('E2E 04 - date');

      await createEventAsOrganizer(browser as Browser, title, {
        description: 'E2E advanced date filter seed',
        category: 'Music',
      });

      // 1) Search by title to make sure the event exists
      const card = await searchEventByTitleFromHome(page, title);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // 2) Keep title search active and apply advanced date filter = tomorrow.
      // This validates date filtering on the seeded event without depending on
      // which page broad date results happen to render first.
      await applyAdvancedDateFilterForTomorrow(page);

      // 3) Find the same card by title under search + date filters
      const filteredCard = page
        .getByTestId('arc-card-root')
        .filter({
          has: page
            .getByTestId('arc-card-title')
            .filter({ hasText: title }),
        })
        .first();

      await expect(filteredCard).toBeVisible({ timeout: 15_000 });
    },
  );

  test('shows pagination indicator on Home when there are multiple pages', async ({
    page,
  }) => {
    test.skip(!is('admin'));

    // 1) Go to Home and wait for at least one /api/events response
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAnyEventsApi(page);

    // 2) Expect the page indicator 1/N (N >= 1) to be visible
    await expectHomeHasPagination(page);
  });

  test('keeps the seeded card visible when applying the advanced location filter', async ({
    page,
    browser,
  }) => {
    test.skip(!is('admin'));

    const title = titleOf('E2E 04 - location');
    const locationText = 'Rosario';

    await createEventAsOrganizer(browser as Browser, title, {
      description: 'E2E advanced location filter seed',
      category: 'Music',
      location: locationText,
    });

    // 1) Search by title to ensure the event exists
    const card = await searchEventByTitleFromHome(page, title);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // 2) Clear the Searchbar text so the filter is ONLY by location
    await clearSearchbarSearchText(page);

    // 3) Apply advanced location filter = Rosario
    await applyAdvancedLocationFilter(page, locationText);

    // 4) Re-find the card by title under the location filter
    const filteredCard = page
      .getByTestId('arc-card-root')
      .filter({
        has: page
          .getByTestId('arc-card-title')
          .filter({ hasText: title }),
      })
      .first();

    await expect(filteredCard).toBeVisible({ timeout: 15_000 });
  });
});
