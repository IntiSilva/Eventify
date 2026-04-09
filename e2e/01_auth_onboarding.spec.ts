import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isAuth as is } from './helpers/env';

/**
 * Generates a short, unique username based on a prefix and a UUID slice.
 * Keeps it readable and within the "letters/numbers/dash/underscore" rule.
 */
const uniqueUsername = (prefix: string) =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;

test.describe('01 — Onboarding flow', () => {

  test.setTimeout(120_000);

  test('logged-out user is redirected to sign-in', async ({ page }) => {
    test.skip(!is('logged-out'));

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('organizer visiting /onboarding is redirected to Home', async ({ page }) => {
    test.skip(!is('organizer'));

    await page.goto('/onboarding');

    // Wait for the redirect and ensure it ends up on "/"
    await page.waitForURL(/\/$/, { waitUntil: 'networkidle', timeout: 15000 });
    await expect(page).toHaveURL(/\/$/);
  });

  test('user without onboarding as organizer cannot continue past phone without a valid number', async ({ page }) => {
    test.skip(!is('user-noonboarding'));

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);

    // Step 1 — valid username
    const u = page.getByTestId('onb-username');
    await u.fill('user_e2e_2');
    await u.press('Tab');

    const nextBtn = page.getByTestId('onb-next');
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    // Step 2 — select organizer and continue
    const org = page.getByTestId('onb-role-organizer');
    await org.click();
    await nextBtn.click();

    // Step 3 — leave phone empty/invalid
    const phone = page.getByTestId('onb-phone');
    await expect(phone).toBeVisible();
    // Tap and blur to trigger validation (onChange/blur)
    await phone.click();
    await phone.press('Tab');

    // Step 4 should not render until the phone number is valid and saved
    await expect(page.getByTestId('onb-stripe-step')).toHaveCount(0);
    await expect(page.getByTestId('onb-next')).toHaveCount(0);

    // User should remain on /onboarding
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('user without onboarding cannot continue with a duplicated username', async ({ page }) => {
    test.skip(!is('user-noonboarding'));

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);

    const u = page.getByTestId('onb-username');
    await expect(u).toBeVisible();

    // Use a username that exists in the seed (e2e_organizer)
    await u.fill('e2e_organizer');
    await u.press('Tab');

    // Wait for the client-side checker hint
    await expect(page.getByTestId('input-status-hint'))
      .toHaveText(/^\s*That username is already taken\s*$/i, { timeout: 10000 });

    // Next button SHOULD NOT be rendered
    await expect(page.getByTestId('onb-next')).toHaveCount(0);

    // Sanity check: if we switch to a unique username, Next appears
    const unique = uniqueUsername('e2e');
    await u.fill(unique);
    await u.press('Tab');

    await expect(page.getByTestId('input-status-hint'))
      .toHaveText(/username available/i, { timeout: 7000 });

    await expect(page.getByTestId('onb-next')).toBeVisible();
  });

  test('user without onboarding reaches the organizer Stripe step and can skip it', async ({ page }) => {
    test.skip(!is('user-noonboarding'));

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);

    // Step 1 — valid and AVAILABLE username
    // Use a unique one to avoid collisions with the seed
    const unique = uniqueUsername('e2e');
    const u = page.getByTestId('onb-username');
    await expect(u).toBeVisible();
    await u.fill(unique);
    await u.press('Tab'); // trigger local validation

    // Wait for the hint to show "Username available"
    await expect(page.getByTestId('input-status-hint'))
      .toHaveText(/username available/i, { timeout: 7000 });

    // Now the Next button should be rendered and clickable
    const nextBtn = page.getByTestId('onb-next');
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    // Step 2 — select organizer role and continue
    const org = page.getByTestId('onb-role-organizer');
    await expect(org).toBeVisible();
    await org.click();

    // In step 2, for organizer, Next appears again
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    // Step 3 — valid phone is required for organizer
    const phone = page.getByTestId('onb-phone');
    await expect(phone).toBeVisible();
    await phone.fill('+5491123456789');
    await phone.press('Tab');

    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    await expect(page.getByTestId('onb-stripe-step')).toBeVisible();
    await expect(page.getByText(/sell tickets with stripe/i)).toBeVisible();
    await expect(page.getByTestId('onb-connect-copy')).toBeVisible();

    await page.getByTestId('onb-back').click();
    await expect(phone).toBeVisible();
    await expect(page.getByTestId('onb-next')).toBeVisible();
    await page.getByTestId('onb-next').click();

    await expect(page.getByTestId('onb-stripe-step')).toBeVisible();
    await expect(page.getByText(/an unexpected error occurred/i)).toHaveCount(0);

    const skipForNow = page.getByTestId('onb-skip-connect');
    await expect(skipForNow).toBeVisible();
    await expect(page.getByTestId('onb-connect-stripe')).toBeVisible();
    await skipForNow.click();

    // Success toast from the server action
    await expect(page.getByText(/profile updated successfully/i))
      .toBeVisible({ timeout: 15000 });

    // After a successful organizer onboarding, the user should land on the organizer dashboard
    await expect(page).toHaveURL(/\/organizer$/, {timeout: 20000});
  });

});
