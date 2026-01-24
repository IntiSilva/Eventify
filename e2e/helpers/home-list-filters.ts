import {
  expect,
  type Browser,
  type Page,
  type Locator,
  type ElementHandle,
} from '@playwright/test';
import { normalizeStringForSearch } from '@/lib/utils';
import { getBaseURL } from './env';
import { newE2EContext } from './new-context';

// Seed helpers ---------------------------------------------------------------

const REDIRECT_TIMEOUT = process.env.CI ? 60_000 : 30_000;

export async function createEventAsOrganizer(
  browser: Browser,
  title: string,
  options?: { description?: string; location?: string; category?: string },
) {
  const baseURL = getBaseURL();
  const ctx = await newE2EContext(browser, {
    baseURL,
    storageState: 'e2e/.auth/organizer.json',
  });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  try {
    const page = await ctx.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err?.message ?? err));
    });

    await page.goto('/events/new', { waitUntil: 'domcontentloaded' });

    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill(options?.description ?? 'E2E seed');
    await page.getByLabel('Location').fill(options?.location ?? 'CABA');

    const category = options?.category ?? 'Music';
    const categorySection = page.getByText(/^Category$/).locator('..');
    const categoryTrigger = categorySection.getByRole('combobox').first();

    await categoryTrigger.click();
    await page.locator('[data-slot="select-content"][data-state="open"]').waitFor();
    await page
      .getByRole('option', { name: new RegExp(`^${category}$`, 'i') })
      .click();

    // In headless mode, it sometimes remains open and covers clicks
    await page.keyboard.press('Escape');

    await page.getByLabel('Contact Email').fill('contact@example.com');

    const useProfilePhone = page.getByRole('checkbox', {
      name: /use my profile phone number/i,
    });
    if (await useProfilePhone.isChecked()) await useProfilePhone.click();

    const submit = page.getByRole('button', { name: /create event/i });
    await expect(submit).toBeEnabled();

    // Avoid race: waiting for URL and click at the same time
    await Promise.all([
      page.waitForURL('**/organizer**', {
        timeout: REDIRECT_TIMEOUT,
        waitUntil: 'domcontentloaded',
      }),
      submit.click(),
    ]);
  } catch (e) {
    // If CI fails, leave the cause visible in the logs
    const errDump = [
      pageErrors.length ? `pageerror:\n- ${pageErrors.join('\n- ')}` : '',
      consoleErrors.length ? `console.error:\n- ${consoleErrors.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    throw new Error(`${String(e)}\n\n${errDump}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

// Cards & search -------------------------------------------------------------

export function getCardByTitle(page: Page, title: string): Locator {
  return page
    .getByTestId('arc-card-root')
    .filter({
      has: page
        .getByTestId('arc-card-title')
        .filter({ hasText: title }),
    })
    .first();
}

export async function searchEventByTitleFromHome(
  page: Page,
  title: string,
): Promise<Locator> {
  const normalized = normalizeStringForSearch(title) ?? title;
  const searchQS = `?search=${encodeURIComponent(normalized)}`;

  await page.goto(`/${searchQS}`);

  const card = getCardByTitle(page, title);
  await expect(card).toBeVisible({ timeout: 15_000 });

  return card;
}

// API waiters ---------------------------------------------------------------

export async function waitForAnyEventsApi(
  page: Page,
  timeout = 20_000,
) {
  return page.waitForResponse(
    (res) => res.url().includes('/api/events') && res.ok(),
    { timeout },
  );
}

export function waitForEventsApiWithQueryFragment(
  page: Page,
  qsNeedle: string,
  timeout = 20_000,
) {
  return page.waitForResponse(
    (res) => {
      const url = res.url();
      return (
        url.includes('/api/events') &&
        url.includes(qsNeedle) &&
        res.ok()
      );
    },
    { timeout },
  );
}

/**
 * Builds a waiter for the NEXT `/api/events` GET request.
 * Optionally filters by a substring in the query string (e.g. "category=music").
 * Must be created BEFORE triggering the action that causes the fetch.
 */
function nextEventsFetch(
  page: Page,
  qsIncludes?: string,
  timeout = 20_000,
) {
  const want = (qsIncludes ?? '').toLowerCase();
  return page.waitForResponse(
    (r) => {
      if (r.request().method() !== 'GET') return false;
      const url = r.url();
      if (!url.includes('/api/events')) return false;
      return want ? url.toLowerCase().includes(want) : true;
    },
    { timeout },
  );
}

// Pagination helpers ---------------------------------------------------------

export function getHomePageIndicator(page: Page): Locator {
  return page.getByTestId('home-page-indicator');
}

export async function expectHomeHasPagination(page: Page) {
  const indicator = getHomePageIndicator(page);
   // Make sure the indicator is scrolled into view (it's at the bottom of Home)
  await indicator.scrollIntoViewIfNeeded();
  await expect(indicator).toBeVisible({ timeout: 10_000 });
  await expect(indicator).toHaveText(/^\s*Page\s+\d+\s+of\s+\d+\s*$/);
}

// Searchbar helpers ----------------------------------------------------------

/**
 * Returns the visible Searchbar (there is one for desktop and one for mobile;
 * only one should be visible at any given breakpoint).
 */
async function getVisibleSearchbar(page: Page): Promise<Locator> {
  const bars = page.getByTestId('searchbar');
  const count = await bars.count();

  for (let i = 0; i < count; i++) {
    const bar = bars.nth(i);
    if (await bar.isVisible()) {
      return bar;
    }
  }

  throw new Error(
    'No visible searchbar found (data-testid="searchbar")',
  );
}

/**
 * Clears the text of the visible Searchbar input.
 * It does NOT submit by itself; the next action (category / apply)
 * will use search = '' in the internal state.
 */
export async function clearSearchbarSearchText(page: Page) {
  const bar = await getVisibleSearchbar(page);

  const input = bar.getByTestId('sb-input');

  await input.click();
  await input.fill('');
}

// Advanced filters / date ----------------------------------------------------

export async function getVisibleAdvancedFiltersButton(
  page: Page,
): Promise<Locator> {
  const candidates = page.getByTestId('sb-adv-open');
  const count = await candidates.count();

  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible()) {
      return candidate;
    }
  }

  throw new Error(
    'No visible Advanced Filters button found (sb-adv-open)',
  );
}

export async function openAdvancedFiltersPanel(
  page: Page,
): Promise<Locator> {
  const openBtn = await getVisibleAdvancedFiltersButton(page);
  await openBtn.click();

  const panel = page.getByTestId('sb-adv-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  return panel;
}

/**
 * Opens the Advanced Filters panel, selects "tomorrow" in the DateTimePicker
 * and applies the filters.
 *
 * Assumptions:
 *  - Advanced Filters trigger has data-testid="sb-adv-open"
 *  - Panel root has data-testid="sb-adv-panel"
 *  - DateTimePicker wrapper has data-testid="sb-date"
 *  - Apply button has data-testid="sb-apply"
 */
export async function applyAdvancedDateFilterForTomorrow(page: Page) {
  // 1) Open Advanced Filters panel
  const panel = await openAdvancedFiltersPanel(page);

  // 2) Compute "tomorrow" in the browser context:
  //    - dayOfMonth: used to click the calendar button
  //    - ymd: YYYY-MM-DD used to match the query (?date=YYYY-MM-DD)
  const { dayOfMonth, ymd } = await page.evaluate(() => {
    const now = new Date();
    const t = new Date(now);
    t.setDate(now.getDate() + 1);

    const dayOfMonth = t.getDate();
    const yyyy = t.getFullYear();
    const mm = String(t.getMonth() + 1).padStart(2, '0');
    const dd = String(t.getDate()).padStart(2, '0');

    return { dayOfMonth, ymd: `${yyyy}-${mm}-${dd}` };
  });

  // 3) Open the DateTimePicker trigger inside the panel
  const dateWrapper = panel.getByTestId('sb-date');
  const dateTrigger = dateWrapper.getByRole('button').first();
  await dateTrigger.click();

  // 4) Find the last dialog (popover for the calendar) and click "tomorrow"
  const dialogs = page.getByRole('dialog');
  const dialogCount = await dialogs.count();
  const calendarDialog = dialogs.nth(dialogCount - 1);

  const dayButton = calendarDialog
    .locator('button')
    .filter({ hasText: new RegExp(`^${dayOfMonth}$`) })
    .first();

  await expect(dayButton).toBeVisible({ timeout: 10_000 });
  await dayButton.click();

  // 5) Prepare waiters BEFORE clicking "Apply"
  const qsNeedle = `date=${encodeURIComponent(ymd)}`;

  const waitNext = nextEventsFetch(page, qsNeedle, 20_000).catch(
    () => null,
  );
  const waitUrl = page
    .waitForURL((u) => {
      const url = typeof u === 'string' ? new URL(u) : u;
      return (url.searchParams.get('date') ?? '') === ymd;
    }, { timeout: 5_000 })
    .catch(() => null);

  const applyBtn = panel.getByTestId('sb-apply');
  await applyBtn.click();

  // 6) Wait for either the fetch or the URL change to reflect the new date
  await Promise.race([waitNext, waitUrl]);

  // 7) Small delay to let SWR render the updated list
  await page.waitForTimeout(50);
}

// Advanced location filter ----------------------------------------------------

export async function applyAdvancedLocationFilter(page: Page, locationText: string) {
  // 1) Open Advanced Filters panel
  const panel = await openAdvancedFiltersPanel(page);

  // 2) Location block inside the advanced panel
  const locationBlock = panel.getByTestId('sb-location');

  // 3) Open the AutocompleteInput (combobox trigger)
  const trigger = locationBlock.getByRole('combobox').first();
  await trigger.click();

  // 4) Command input: we use the "Search location…" placeholder
  //    (fuzzy match: works whether it’s … or ...)
  const input = page.getByPlaceholder(/search location/i);
  await input.fill(locationText);

  // 5) Wait for the suggested option and select it
  const option = page
    .getByRole('option', { name: new RegExp(`^${locationText}$`, 'i') })
    .first();

  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  // 6) Set up waiters (API + URL) BEFORE clicking Apply
  const waitEvents = waitForEventsApiWithQueryFragment(page, 'location=').catch(() => null);
  const waitUrl = page
    .waitForURL(
      (u) => {
        const url = typeof u === 'string' ? new URL(u) : u;
        return (url.searchParams.get('location') ?? '').length > 0;
      },
      { timeout: 5_000 },
    )
    .catch(() => null);

  const applyBtn = panel.getByTestId('sb-apply');
  await applyBtn.click();

  // 7) Wait until the filter is applied (via fetch or URL change)
  await Promise.race([waitEvents, waitUrl]);

  // 8) Small delay so SWR has time to render the updated list
  await page.waitForTimeout(50);
}




// Generic bbox helpers + category filter helpers -----------------------------

async function pickVisibleByCss(
  page: Page,
  selector: string,
): Promise<ElementHandle<HTMLElement> | null> {
  const els = await page.$$(selector);
  for (const el of els) {
    const box = await el.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      return el as ElementHandle<HTMLElement>;
    }
  }
  return null;
}

async function pickVisibleByTestId(
  page: Page,
  testId: string,
): Promise<ElementHandle<HTMLElement> | null> {
  return pickVisibleByCss(page, `[data-testid="${testId}"]`);
}

/** Clicks the center of the bounding box (bypasses strict visibility checks) */
async function clickByBox(
  page: Page,
  handle: ElementHandle<HTMLElement>,
) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('clickByBox: element has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Best-effort attempt to close Command/Popover suggestions so they don't
 * cover the trigger (e.g. category select trigger).
 */
async function closeSuggestionsIfOpen(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
  try {
    await expect(page.getByTestId('sb-suggestion-item')).toHaveCount(0, {
      timeout: 1200,
    });
  } catch {
    // not fatal
  }
}

/**
 * Returns the first visible category trigger:
 *  1) direct by data-testid="sb-category"
 *  2) inside the visible searchbar
 *  3) any `[data-slot="select-trigger"]` in the document as a fallback
 */
async function pickCategoryTriggerHandle(
  page: Page,
): Promise<ElementHandle<HTMLElement> | null> {
  // 1) Direct by sb-category testid
  let h = await pickVisibleByTestId(page, 'sb-category');
  if (h) return h;

  // 2) Inside the visible searchbar
  const bar = await pickVisibleByTestId(page, 'searchbar');
  if (bar) {
    const scoped = await bar.$('[data-slot="select-trigger"]');
    if (scoped) {
      const box = await scoped.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        return scoped as ElementHandle<HTMLElement>;
      }
    }
  }

  // 3) Fallback: any select trigger in the document
  return pickVisibleByCss(page, '[data-slot="select-trigger"]');
}

/**
 * Opens the Searchbar category select via bbox click and returns the visible
 * (boxed) content panel.
 */
async function openSearchbarCategorySelectByBox(
  page: Page,
): Promise<ElementHandle<HTMLElement>> {
  await closeSuggestionsIfOpen(page);

  const trigger = await pickCategoryTriggerHandle(page);
  expect(
    trigger,
    'category trigger (with bounding box) not found',
  ).not.toBeNull();

  await clickByBox(page, trigger!);
  await page.waitForTimeout(120); // small portal/animation delay

  // Prefer explicit testid; fallback to Radix open panel attributes
  let content = await pickVisibleByTestId(page, 'sb-category-content');
  if (content) return content;

  content = await pickVisibleByCss(
    page,
    '[data-slot="select-content"][data-state="open"]',
  );
  expect(
    content,
    'category content (with bounding box) not found after click',
  ).not.toBeNull();
  return content!;
}

/**
 * Clicks an option by accessible name. If the strict click fails
 * (due to overlay, animation, etc.), falls back to bbox-based click.
 */
async function clickOptionByText(page: Page, text: string) {
  const opt = page
    .getByRole('option', { name: new RegExp(`^${text}$`, 'i') })
    .first();

  try {
    await opt.click({ timeout: 1200 });
    return;
  } catch {
    const handle = await opt.elementHandle();
    if (!handle) {
      throw new Error(`option "${text}" not found`);
    }
    await clickByBox(page, handle as ElementHandle<HTMLElement>);
  }
}

/**
 * Applies a category filter by opening the navbar select and choosing a value.
 *
 * Important:
 *  - We set up the waiter BEFORE clicking on the option.
 *  - We also wait for the URL to include ?category=<value> as a fallback
 *    in case SWR uses cache and does not refetch immediately.
 */
export async function applyCategoryFilter(
  page: Page,
  categoryText = 'Music',
) {
  const catLc = categoryText.toLowerCase();
  const qsNeedle = `category=${encodeURIComponent(catLc)}`;

  await closeSuggestionsIfOpen(page);
  await openSearchbarCategorySelectByBox(page);

  const waitNext = nextEventsFetch(page, qsNeedle, 20_000).catch(
    () => null,
  );

  const waitUrl = page
    .waitForURL((u) => {
      const url = typeof u === 'string' ? new URL(u) : u;
      return (
        (url.searchParams.get('category') ?? '').toLowerCase() ===
        catLc
      );
    }, { timeout: 5_000 })
    .catch(() => null);

  await clickOptionByText(page, categoryText);

  await Promise.race([waitNext, waitUrl]);

  await page.waitForTimeout(50);
}
