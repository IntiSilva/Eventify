import { test, expect } from '@playwright/test';
import { isAuth as is } from './helpers/env';
import { AGENDA_LIST_INFINITE } from '@/lib/constants';

/**
 * Current project's baseURL, falling back to localhost.
 */
function getBaseURL(): string {
  return (test.info().project.use.baseURL as string) ?? 'http://localhost:3000';
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Spec 05 — Agenda guards & behavior
 * ────────────────────────────────────────────────────────────────────────────*/

test.describe('05 — Agenda guards & behavior', () => {
  // Generous timeout: Agenda uses animations, SWR and overlays.
  test.setTimeout(120_000);

  /**
   * Anonymous user cannot access /agenda
   *
   * Project: chromium - logged-out (storageState undefined)
   *
   * Expectations:
   * - Middleware detects that /agenda is protected.
   * - It redirects to /sign-in with ?redirect_url=<originalUrl>.
   */
  test('anonymous user is redirected to /sign-in', async ({ page }) => {
    // Only makes sense on the "logged-out" project
    test.skip(!is('logged-out'), 'This scenario is meant for the chromium - logged-out project');

    const baseURL = getBaseURL();
    const targetUrl = new URL('/agenda', baseURL).toString();

    // Navigate to /agenda as an anonymous user
    await page.goto('/agenda');

    // Middleware should redirect to /sign-in?redirect_url=...
    await page.waitForURL('**/sign-in**');

    const current = new URL(page.url());

    // We are now on /sign-in
    expect(current.pathname).toBe('/sign-in');

    const redirectParam = current.searchParams.get('redirect_url');

    // It must exist and point back to /agenda (absolute URL)
    expect(redirectParam).toBeTruthy();
    if (redirectParam) {
      expect(redirectParam).toContain('/agenda');
      // Ultra-strict option:
      // expect(redirectParam).toBe(targetUrl);
    }

    // As an extra sanity check, we’re no longer on /agenda
    expect(page.url()).not.toBe(targetUrl);
  });

  /**
   * Authenticated user with future RSVPs sees Agenda list
   *
   * Project: chromium - user (storageState: e2e/.auth/user.json)
   * User: e2e_user (from seed-e2e)
   *
   * Seed data:
   * - e2e_user has confirmed RSVPs for:
   *   - "E2E Soon Event"
   *   - "E2E Future Event" (mainFutureEvent)
   *   - "E2E Already Featured"
   *
   * Expectations:
   * - Middleware allows access to /agenda.
   * - Page renders the 3D Agenda list.
   * - At least one of that user’s events appears as a row (<article> with the title).
   */
  test('authenticated user with future RSVPs sees Agenda rows', async ({ page }) => {
    // Only makes sense on the "user" project
    test.skip(!is('user'), 'This scenario is meant for the chromium - user project');

    // Go to /agenda as e2e_user (storageState: e2e/.auth/user.json)
    await page.goto('/agenda');

    // Confirm we really are on /agenda (i.e. no redirect to /sign-in)
    await expect(page).toHaveURL(/\/agenda/);

    // The 3D “infinite RSVPs” scroller region should be present
    const region = page.getByRole('region', { name: /RSVP events list/i });
    await expect(region).toBeVisible();

    // "E2E Future Event" can appear multiple times in the infinite list,
    // so we use `.first()` to avoid strict mode violations.
    const row = region.getByRole('article', { name: /E2E Future Event/i }).first();

    // It must exist and be visible in Agenda
    await expect(row).toBeVisible();
  });

  /**
   * Agenda autoplay behaviour matches the current layout mode (finite vs infinite).
   *
   * Project: chromium - user (storageState: e2e/.auth/user.json)
   *
   * Behaviour:
   * - When AGENDA_LIST_INFINITE = false (finite list):
   *   - Verify that the autoplay toggle is not rendered.
   *
   * - When AGENDA_LIST_INFINITE = true (infinite list):
   *   - Verify that clicking the autoplay toggle changes aria-pressed.
   *   - Verify that, after a reload, the toggled value is restored
   *     (localStorage key: "agenda:autoplay").
   *
   * Notes:
   * - AutoplayButton uses aria-label="Toggle autoplay" and aria-pressed={isPlaying}.
   * - The test does not assume an initial state (true/false):
   *   it reads the current value, toggles it, and expects that the
   *   toggled value is restored after reload when autoplay is supported.
   */
  test('agenda autoplay behaviour matches AGENDA_LIST_INFINITE', async ({ page }) => {
    test.skip(!is('user'), 'This scenario is meant for the chromium - user project');

    await page.goto('/agenda');
    await expect(page).toHaveURL(/\/agenda/);

    const autoplayBtn = page.getByRole('button', { name: /toggle autoplay/i });

    if (!AGENDA_LIST_INFINITE) {
      // FINITE MODE: the button should not be present
      await expect(autoplayBtn).toHaveCount(0);
      return;
    }

    // INFINITE MODE: persist between reloads test
    await expect(autoplayBtn).toBeVisible();
    await expect(autoplayBtn).toHaveAttribute('aria-pressed', /^(true|false)$/);

    const initial = await autoplayBtn.getAttribute('aria-pressed');

    // Toggle
    await autoplayBtn.click();
    const toggled = await autoplayBtn.getAttribute('aria-pressed');
    expect(toggled).not.toBe(initial);

    // Reload
    await page.reload();
    const autoplayAfterReload = page.getByRole('button', { name: /toggle autoplay/i });
    await expect(autoplayAfterReload).toBeVisible();
    await expect(autoplayAfterReload).toHaveAttribute('aria-pressed', toggled ?? '');
  });

  /**
   * Cancel RSVP removes the event from Agenda
   *
   * Project: chromium - user (storageState: e2e/.auth/user.json)
   *
   * User:
   * - e2e_user, with a confirmed RSVP to "E2E Future Event" (among others).
   *
   * Flow:
   * - Go to /agenda.
   * - Confirm "E2E Future Event" appears in the 3D list.
   * - Open that event’s menu via the "Open details" button.
   * - Use the Menu’s RSVP toggle (data-testid="rsvp-toggle") to cancel.
   * - Wait until that title disappears from Agenda
   *   (we count <article> nodes inside the Agenda region).
   */
  test('cancelling RSVP removes the event from Agenda', async ({ page }) => {
    // Only makes sense on the "user" project
    test.skip(!is('user'), 'This scenario is meant for the chromium - user project');

    const EVENT_TITLE = 'E2E Future Event';

    // Before navigating, force viewMode=list in localStorage for this origin
    await page.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, value);
    }, { key: 'agenda:viewMode', value: 'list' });

    // 1) Go to /agenda as e2e_user
    await page.goto('/agenda');
    await expect(page).toHaveURL(/\/agenda/);

    // 2) Agenda list region (TiltedInfiniteList)
    const region = page.getByRole('region', { name: /RSVP events list/i });
    await expect(region).toBeVisible();

    // 3) Row for "E2E Future Event" (remember infinite list, so use .first())
    const rowLocator = region.getByRole('article', {
      name: new RegExp(EVENT_TITLE, 'i'),
    });
    const firstRow = rowLocator.first();
    await expect(firstRow).toBeVisible();

    // 4) "Open details" button inside that row
    const detailsButton = firstRow.getByRole('button', { name: /open details/i });
    await expect(detailsButton).toBeVisible();

    // Use keyboard: Enter → handleKeyDown(Enter) → onDetails(live) → openMenu(...)
    await detailsButton.press('Enter');

    // 5) Wait for the RSVP toggle inside the Menu
    const rsvpToggle = page.getByTestId('rsvp-toggle');
    await expect(rsvpToggle).toBeVisible();

    // 6) Click to cancel RSVP
    await rsvpToggle.click();

    // 7) Wait until the event disappears from the Agenda list
    await expect
      .poll(
        async () =>
          await region
            .getByRole('article', { name: new RegExp(EVENT_TITLE, 'i') })
            .count(),
        {
          timeout: 15_000,
          message:
            'Expected the event to be removed from Agenda after cancelling RSVP',
        },
      )
      .toBe(0);
  });
});
