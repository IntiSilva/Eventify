import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  waitForCardByTitle,
  openMenuFromHome,
  getUiCount,
  ensureOn,
  ensureOff,
  expectAttendeesToBe,
} from './helpers/rsvp-and-featured';
 import { withContext, isAuth as is } from './helpers/env';
 import { createEventAsOrganizer } from './helpers/home-list-filters';

// Stable ID for this spec run (does not change between tests)
const RUN_ID = (process.env.E2E_RUN_ID ?? randomUUID()).slice(0, 8);
const titleOf = (prefix: string) => `${prefix} ${RUN_ID}`;


// Default session for tests that use `page` directly
test.use({ storageState: 'e2e/.auth/admin.json' });

/* ──────────────────────────────────────────────────────────────────────────────
 * Spec 03 — RSVP toggling + Featured threshold (cross-session)
 * ────────────────────────────────────────────────────────────────────────────*/

test.describe('03 — RSVP & Featured (create → Menu, cross-session)', () => {
  test.setTimeout(120_000);

  test('RSVP toggle updates UI and persists across sessions', async ({ page, browser }) => {
    test.skip(!is('admin')); // run only from "admin" project

    const title = titleOf('E2E RSVP');
    await createEventAsOrganizer(browser, title);

    // First open: admin user opens the menu and reads the current count
    await openMenuFromHome(page, title);
    const base = await getUiCount(page);

    // Admin turns RSVP ON → UI count increases by 1
    await ensureOn(page);
    await expectAttendeesToBe(page, base + 1);

    // Organizer opens the same event: UI must reflect the updated count
    await withContext(browser, 'e2e/.auth/organizer.json', async (pg) => {
      await openMenuFromHome(pg, title);
      await expectAttendeesToBe(pg, base + 1);
    });

    // Admin turns RSVP OFF → UI count returns to the original value
    await ensureOff(page);
    await expectAttendeesToBe(page, base);

    // Organizer checks again: count must also be back to the original value
    await withContext(browser, 'e2e/.auth/organizer.json', async (pg) => {
      await openMenuFromHome(pg, title);
      await expectAttendeesToBe(pg, base);
    });
  });

  test('timezone toggle in Menu updates the time label', async ({ page }) => {
    test.skip(!is('admin'));

    await openMenuFromHome(page, 'E2E TZ Menu Event');

    // Label principal donde se muestra la hora del evento en el Menu
    const timeLabel = page.getByTestId('menu-event-date');
    const initialText = (await timeLabel.textContent()) ?? '';

    // Sanity: el label no debería estar vacío
    expect(initialText.trim().length).toBeGreaterThan(0);

    const toggle = page.getByTestId('menu-tz-toggle');

    // Primer toggle: debería cambiar el texto de la hora (modo "Event time" vs "My time")
    await toggle.click();
    await expect(timeLabel).not.toHaveText(initialText, { timeout: 10_000 });

    // Segundo toggle: volvemos al modo original, el texto debería volver al valor inicial
    await toggle.click();
    await expect(timeLabel).toHaveText(initialText, { timeout: 10_000 });
  });


  test('featured badge appears after multi-user confirmations', async ({ browser }) => {
    // This test is meant to run from the "chromium - admin" project in the UI
    test.skip(!is('admin'));

    const baseURL =
      (test.info().project.use.baseURL as string) ?? 'http://localhost:3000';
    const title = titleOf('Featured');

    // 1) Create the event as organizer (no RSVPs yet)
    await createEventAsOrganizer(browser, title);

    // 2) User A (admin) confirms RSVP
    {
      const ctx = await browser.newContext({
        baseURL,
        storageState: 'e2e/.auth/admin.json',
      });
      const page = await ctx.newPage();
      await openMenuFromHome(page, title);
      await ensureOn(page); // turn the toggle ON if it was OFF
      await ctx.close();
    }

    // 3) User B (organizer) confirms RSVP → we cross the e2e threshold = 2
    {
      const ctx = await browser.newContext({
        baseURL,
        storageState: 'e2e/.auth/organizer.json',
      });
      const page = await ctx.newPage();
      await openMenuFromHome(page, title);
      await ensureOn(page);
      await ctx.close();
    }

    // 4) Verify "Featured" badge on the card (forcing a refetch of the carousel)
    {
      const ctx = await browser.newContext({
        baseURL,
        storageState: 'e2e/.auth/admin.json',
      });
      const page = await ctx.newPage();

      const card = await waitForCardByTitle(page, title, { timeout: 30_000 });
      await expect(card.getByTestId('aurora-featured-badge')).toBeVisible({
        timeout: 15_000,
      });

      await ctx.close();
    }
  });
});
