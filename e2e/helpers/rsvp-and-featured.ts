import { expect, type Page } from '@playwright/test';
import { normalizeStringForSearch } from '@/lib/utils';

/** Deterministic wait for a card by title (uses search= on Home). */
export async function waitForCardByTitle(
  page: Page,
  title: string,
  opts?: { timeout?: number },
) {
  const timeout = opts?.timeout ?? 30_000;
  const q =
    typeof normalizeStringForSearch === 'function'
      ? normalizeStringForSearch(title)
      : title;

  // 1) Single navigation to Home with the normalized search.
  const url = `/?search=${encodeURIComponent(q)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // 2) Wait (if it happens) for the /api/events response for that search,
  //    but do not fail if it comes from cache.
  await Promise.race([
    page
      .waitForResponse(
        (res) => {
          if (res.request().method() !== 'GET') return false;
          if (!res.url().includes('/api/events')) return false;
          const sp = new URL(res.url()).searchParams;
          return (
            (sp.get('search') || '').toLowerCase() === q.toLowerCase() &&
            res.status() === 200
          );
        },
        { timeout: 6000 },
      )
      .catch(() => {}),
    page.waitForTimeout(400),
  ]);

  // 3) Direct poll for the card by title.
  const cardByTitle = () =>
    page
      .getByTestId('arc-card-root')
      .filter({
        has: page
          .getByTestId('arc-card-title')
          .filter({ hasText: title }),
      })
      .count();

  try {
    await expect
      .poll(cardByTitle, {
        timeout,
        intervals: [300, 400, 600, 800, 1000],
      })
      .toBeGreaterThan(0);
  } catch {
    // 4) Fallback: a single “soft” reload if it didn’t appear (avoids infinite loops).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(cardByTitle, {
        timeout: 10_000,
        intervals: [300, 500, 800],
      })
      .toBeGreaterThan(0);
  }

  const card = page
    .getByTestId('arc-card-root')
    .filter({
      has: page
        .getByTestId('arc-card-title')
        .filter({ hasText: title }),
    })
    .first();

  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible({ timeout: 5000 });
  return card;
}

/** Opens the menu from Home using the robust card helper. */
export async function openMenuFromHome(page: Page, title: string) {
  const card = await waitForCardByTitle(page, title, { timeout: 30_000 });

  const detailsBtn = card.getByTestId('arc-card-details').first();
  await expect(detailsBtn).toBeVisible({ timeout: 10_000 });

  try {
    await detailsBtn.click();
  } catch {
    const box = await detailsBtn.boundingBox();
    if (box) {
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
    } else {
      await detailsBtn.dispatchEvent('pointerdown', { bubbles: true });
      await detailsBtn.dispatchEvent('pointerup', { bubbles: true });
    }
  }

  const menuFoot = page
    .locator('[data-testid="attendees-count"], [data-testid="rsvp-toggle"]')
    .first();
  await expect(menuFoot).toBeVisible({ timeout: 15_000 });
}

/** Reads the attendee count from the menu footer. */
export const getUiCount = async (page: Page) => {
  const txt = (await page.getByTestId('attendees-count').innerText()).trim();
  const m = /\((\d+)\)/.exec(txt) ?? /(\d+)/.exec(txt);
  return m ? Number(m[1]) : 0;
};

/** Waits until the attendee counter is exactly the expected value. */
export const expectAttendeesToBe = async (
  p: Page,
  expected: number,
) => {
  await expect
    .poll(() => getUiCount(p), { timeout: 12_000 })
    .toBe(expected);
};

async function isToggleOn(page: Page) {
  const t = page.getByTestId('rsvp-toggle');
  const aria = await t.getAttribute('aria-checked');
  if (aria === 'true') return true;
  const ds = await t.getAttribute('data-state');
  return ds === 'checked' || ds === 'on' || ds === 'true';
}

/** Ensures the RSVP toggle ends in the OFF state (and the counter reflects it). */
export async function ensureOff(page: Page) {
  if (await isToggleOn(page)) {
    const before = await getUiCount(page);
    await page.getByTestId('rsvp-toggle').click();
    await expectAttendeesToBe(page, before - 1);
  }
}

/** Ensures the RSVP toggle ends in the ON state (and the counter reflects it). */
export async function ensureOn(page: Page) {
  if (!(await isToggleOn(page))) {
    const before = await getUiCount(page);
    await page.getByTestId('rsvp-toggle').click();
    await expectAttendeesToBe(page, before + 1);
  }
}
