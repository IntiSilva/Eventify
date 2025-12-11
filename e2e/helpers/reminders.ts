import { expect, type Page } from '@playwright/test';

/**
 * --- Footer helpers (inside Menu) ---
 */

export async function expectSetReminderButtonVisible(page: Page) {
  await expect(
    page.getByRole('button', { name: /set reminder/i })
  ).toBeVisible();
}

export async function expectSetReminderButtonHidden(page: Page) {
  await expect(
    page.getByRole('button', { name: /set reminder/i })
  ).toHaveCount(0);
}

export async function expectReminderActivePillVisible(page: Page) {
  await expect(
    page.getByText(/reminder active/i)
  ).toBeVisible();
}

export async function expectReminderActivePillHidden(page: Page) {
  await expect(
    page.getByText(/reminder active/i)
  ).toHaveCount(0);
}

export async function clickSetReminder(page: Page) {
  await page.getByRole('button', { name: /set reminder/i }).click();
}

/**
 * In Menu, when a reminder is active, we show something like:
 * "Reminder active (change)" and the "(change)" is a button.
 */
export async function clickChangeReminder(page: Page) {
  await page.getByRole('button', { name: /\bchange\b/i }).click();
}

/**
 * --- Toast helpers (ReminderToastContent) ---
 */

export async function expectReminderToastVisible(page: Page) {
  await expect(
    page.getByText(/^set a reminder$/i)
  ).toBeVisible();
}

/**
 * Clicks the "2 days before" option in the reminder toast.
 * This corresponds to the 48h reminder.
 */
export async function clickReminderOptionTwoDays(page: Page) {
  await page.getByRole('button', { name: /2 days before/i }).click();
}

/**
 * Clicks the "Don't remind me" button in the reminder toast.
 * We handle both straight and curly apostrophes just in case.
 */
export async function clickDontRemindMe(page: Page) {
  await page
    .getByRole('button', {
      name: /don[’']t remind me/i,
    })
    .click();
}

/**
 * Used for the "too soon" scenario, when no options are available.
 * ReminderToastContent renders:
 * "It's too close to the event to set a reminder."
 */
export async function expectTooCloseMessage(page: Page) {
  await expect(
    page.getByText(/it's too close to the event to set a reminder/i)
  ).toBeVisible();
}


/**
 * Waits for the success toast emitted after scheduling a reminder.
 * The server action returns a message like:
 * "Reminder scheduled! We'll notify you approx. 2 days before the event."
 */
export async function expectReminderSuccessToastVisible(page: Page) {
  await expect(
    page.getByText(/reminder scheduled/i)
  ).toBeVisible();
}