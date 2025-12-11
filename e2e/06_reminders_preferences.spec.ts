import { test } from '@playwright/test';
import { openMenuFromHome } from './helpers/rsvp-and-featured';
import {
  expectSetReminderButtonVisible,
  expectSetReminderButtonHidden,
  expectReminderActivePillVisible,
  expectReminderActivePillHidden,
  clickSetReminder,
  clickChangeReminder,
  expectReminderToastVisible,
  expectReminderSuccessToastVisible,
  clickReminderOptionTwoDays,
  clickDontRemindMe,
  expectTooCloseMessage,
} from './helpers/reminders';
import { isAuth as is } from './helpers/env';

// Use regular user session (reminders are per-user RSVP)
test.use({ storageState: 'e2e/.auth/user.json' });

/* ──────────────────────────────────────────────────────────────────────────────
 * Spec 06 — Reminders preferences (Menu > Reminders)
 * ────────────────────────────────────────────────────────────────────────────*/

test.describe('06 — Reminders preferences', () => {
  test.setTimeout(120_000);

  test('sets and clears a 2-days-before reminder for a future event', async ({ page }) => {
    test.skip(!is('user'));

    // Open menu for the seeded future event
    await openMenuFromHome(page, 'E2E Already Featured');

    // Base state: "Set Reminder" visible, no active pill
    await expectSetReminderButtonVisible(page);
    await expectReminderActivePillHidden(page);

    // Set a "2 days before" reminder via the toast
    await clickSetReminder(page);
    await expectReminderToastVisible(page);
    await clickReminderOptionTwoDays(page);

    // Re-open menu and confirm active reminder state
    await openMenuFromHome(page, 'E2E Already Featured');
    await expectReminderActivePillVisible(page);
    await expectSetReminderButtonHidden(page);

    // Change reminder → "Don't remind me" clears it
    await clickChangeReminder(page);
    await expectReminderToastVisible(page);
    await clickDontRemindMe(page);

    // Back to base state
    await openMenuFromHome(page, 'E2E Already Featured');
    await expectSetReminderButtonVisible(page);
    await expectReminderActivePillHidden(page);
  });

  test('shows a too-close message and keeps base state for a soon event', async ({ page }) => {
    test.skip(!is('user'));

    // Open menu for the "soon" event
    await openMenuFromHome(page, 'E2E Reminder Soon Event');

    // Base state
    await expectSetReminderButtonVisible(page);
    await expectReminderActivePillHidden(page);

    // "Set Reminder" opens a toast with the "too close" message and no options
    await clickSetReminder(page);
    await expectReminderToastVisible(page);
    await expectTooCloseMessage(page);

    // Still in base state after re-opening the menu
    await openMenuFromHome(page, 'E2E Reminder Soon Event');
    await expectSetReminderButtonVisible(page);
    await expectReminderActivePillHidden(page);
  });

  test('persists a 2-days-before reminder after reloading the page', async ({ page }) => {
    test.skip(!is('user'));

    // Start from base state
    await openMenuFromHome(page, 'E2E Already Featured');
    await expectSetReminderButtonVisible(page);
    await expectReminderActivePillHidden(page);

    // Set a "2 days before" reminder
    await clickSetReminder(page);
    await expectReminderToastVisible(page);
    await clickReminderOptionTwoDays(page);
    await expectReminderSuccessToastVisible(page);

    // Reload the page and re-open the menu
    await page.reload();
    await openMenuFromHome(page, 'E2E Already Featured');

    // Reminder should still be active
    await expectReminderActivePillVisible(page);
    await expectSetReminderButtonHidden(page);
  });
});
