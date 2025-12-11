import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isAuth as is } from './helpers/env';

// Use organizer session by default
test.use({ storageState: 'e2e/.auth/organizer.json' });

/**
 * Generates a short, unique event title based on a prefix and a UUID slice.
 */
const uniqueTitle = (prefix: string) =>
  `${prefix} ${randomUUID().replace(/-/g, '').slice(0, 8)}`;

/* ──────────────────────────────────────────────────────────────────────────────
 * Spec 02 — Event creation (organizer)
 * ────────────────────────────────────────────────────────────────────────────*/

test.describe('02 — Create Event (Organizer)', () => {

  test.setTimeout(120_000);

  test('happy path — creates an event with email contact and redirects to dashboard', async ({ page }) => {
    test.skip(!is('organizer'));

    // Go to the event creation form
    await page.goto('/events/new');

    // --- Title (unique per spec run)
    const title = uniqueTitle('E2E Create');
    await page.getByLabel('Title').fill(title);

    // --- Description
    await page.getByLabel('Description').fill('E2E description');

    // --- Location
    await page.getByLabel('Location').fill('CABA');

    // --- Category (shadcn/ui Select)
    const categorySection = page.getByText(/^Category$/).locator('..'); // go up to the FormItem
    const categoryTrigger = categorySection.getByRole('combobox').first();

    await categoryTrigger.click();
    await page
      .locator('[data-slot="select-content"][data-state="open"]')
      .waitFor();
    await page.getByRole('option', { name: /^Music$/i }).click();

    // --- DateTime
    // We do not touch the picker: by default the form sets a future "now + 4h".
    await expect(page.getByText('Date and Time')).toBeVisible();

    // --- Time Zone
    // Default selector uses "Auto" (viewerTz). We keep it as is.

    // --- Contact Email
    // The form usually pre-fills the organizer email; we still set a deterministic value.
    const contactEmail = page.getByLabel('Contact Email');
    await contactEmail.fill('contact@example.com');

    // --- Use profile phone number (not needed for happy path)
    // If it is checked by default, it does not break anything (we have email),
    // but to keep the scenario focused we uncheck it if necessary.
    const useProfilePhone = page.getByRole('checkbox', {
      name: /use my profile phone number/i,
    });
    if (await useProfilePhone.isChecked()) {
      await useProfilePhone.click();
    }

    // --- Submit
    await page.getByRole('button', { name: /create event/i }).click();

    // Expected redirect: organizer dashboard
    await expect(page).toHaveURL(/\/organizer/, { timeout: 15_000 });

    // Verify that the newly created title appears in the dashboard
    const newEventHeading = page
      .getByRole('heading')
      .filter({ hasText: title })
      .first();

    await expect(newEventHeading).toBeVisible({ timeout: 15_000 });
  });

  test('validation — blocks submit when there is no email or phone', async ({ page }) => {
    test.skip(!is('organizer'));

    await page.goto('/events/new');

    // Minimal fields (no contact yet)
    const title = uniqueTitle('E2E NoContact');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill('desc');
    await page.getByLabel('Location').fill('Somewhere');

    // Category: open trigger and select via data-slot content
    const categorySection = page.getByText(/^Category$/).locator('..'); // go up to the FormItem
    const categoryTrigger = categorySection.getByRole('combobox').first();

    await categoryTrigger.click();
    await page
      .locator('[data-slot="select-content"][data-state="open"]')
      .waitFor();
    await page.getByRole('option', { name: /^Music$/i }).click();

    // Ensure there is NO valid contact method:
    // 1) Empty email
    const email = page.getByLabel('Contact Email');
    await email.fill('');
    await email.blur();

    // 2) Turn off "Use profile phone number" if it is active
    const useProfilePhone = page.getByRole('checkbox', {
      name: /use my profile phone number/i,
    });
    if (await useProfilePhone.isChecked()) {
      await useProfilePhone.click();
    }

    // 3) If the manual PhoneInput is visible, keep it empty
    //    (it is usually collapsed while the checkbox is active, hence the check)
    const maybePhone = page.getByLabel(/Contact Phone/i, { exact: false }).first();
    if (await maybePhone.isVisible()) {
      await maybePhone.fill('');
      await maybePhone.blur();
    }

    // Submit
    await page.getByRole('button', { name: /create event/i }).click();

    // Scope to the "Contact Email" FormItem and its <p data-slot="form-message">
    const emailSection = page.getByText(/^Contact Email$/).locator('..'); // go up to the FormItem
    await expect(
      emailSection.locator('[data-slot="form-message"]'),
    ).toHaveText(/Provide at least one valid contact method/i, { timeout: 8_000 });

    // And there must NOT be any navigation (we stay on /events/new)
    await expect(page).toHaveURL(/\/events\/new/);
  });
});
