import { describe, expect, it } from 'vitest';
import {
  buildAdminQS,
  buildEventsQS,
  buildOrganizerQS,
  cn,
  normalizeStringForSearch,
  normalizeUsername,
} from '../utils';

// ------------------------------
// normalizeStringForSearch
// ------------------------------
describe('normalizeStringForSearch', () => {
  it('trims, lowercases and removes special characters while leaving original input untouched', () => {
    const original = '  Café & Bar!  ';
    const copy = `${original}`;

    const normalized = normalizeStringForSearch(original);

    // In your utils: removes diacritics, maps "&" to " y ", strips symbols, collapses spaces.
    expect(normalized).toBe('cafe y bar');
    expect(original).toBe(copy);
  });

  it('returns empty string for nullish or whitespace-only inputs', () => {
    expect(normalizeStringForSearch('   ')).toBe('');

    expect(normalizeStringForSearch(null)).toBe('');

    expect(normalizeStringForSearch(undefined)).toBe('');
  });

  it('handles Spanish/German/ligature cases and em-dashes', () => {
    const input = `ñoño MÜNCHEN coöp — test`;
    // "ñoño" -> "nono"; "MÜNCHEN" -> "munchen"; "coöp" -> "coop"; em-dash removed
    expect(normalizeStringForSearch(input)).toBe('nono munchen coop test');
  });
});

// ------------------------------
// normalizeUsername
// ------------------------------
describe('normalizeUsername', () => {
  it('removes diacritics, lowercases, trims and keeps original reference intact', () => {
    const input = '  Álvaro '; // includes whitespace and accent
    const normalized = normalizeUsername(input);

    expect(normalized).toBe('alvaro');
    expect(input).toBe('  Álvaro ');
  });

  it('returns empty string when only whitespace is provided', () => {
    expect(normalizeUsername('   ')).toBe('');
  });
});

// ------------------------------
// cn (clsx + tailwind-merge)
// ------------------------------
describe('cn', () => {
  it('merges class names predictably, keeping the last duplicate and ignoring falsy values', () => {
    const className = cn('px-2', false && 'hidden', 'px-4', 'text-sm', 'px-4');

    // Avoid brittle order asserts: compare as a set of tokens.
    const tokens = className.split(/\s+/).sort();
    expect(tokens).toEqual(['px-4', 'text-sm'].sort());
    expect(className.includes('px-2')).toBe(false);
  });
});

// ------------------------------
// Query string builders
// ------------------------------
describe('query string builders', () => {
  it('builds events query string with stable ordering and without mutating inputs', () => {
    const filters = {
      location: 'NYC',
      creator: 'alice',
      search: 'music',
      date: '2025-03-01',
      category: 'concert',
    };
    const snapshot = { ...filters };

    const qs = buildEventsQS(filters, 'America/New_York');

    // Your utils format order: search, category, location, creator, date, viewTz
    expect(qs).toBe(
      'search=music&category=concert&location=NYC&creator=alice&date=2025-03-01&viewTz=America%2FNew_York',
    );
    // Must not mutate input
    expect(filters).toEqual(snapshot);
  });

  it('omits empty/undefined filters in events QS', () => {
    // Only location is set; search is empty string; creator is undefined; no viewTz
    const qs = buildEventsQS({ search: '', creator: undefined, location: 'LA' }, undefined);
    expect(qs).toBe('location=LA'); // No "search=", no "viewTz"
  });

  it('URL-encodes spaces and slashes (search + viewTz)', () => {
    const qs = buildEventsQS({ search: 'live music' }, 'America/Buenos_Aires');

    // Validate decoded values (robust to '+' vs '%20')
    const params = new URLSearchParams(qs);
    expect(params.get('search')).toBe('live music');
    expect(params.get('viewTz')).toBe('America/Buenos_Aires');

    // Bonus: ensure the raw string doesn’t contain unencoded spaces or slashes in tz
    expect(qs.includes(' ')).toBe(false);
    expect(qs.includes('viewTz=America/Buenos_Aires')).toBe(false); // slash must be encoded
  });


  it('builds organizer query string deterministically even with unsorted inputs', () => {
    const qs = buildOrganizerQS({
      limit: 25,
      page: 2,
      filters: {
        date: '2025-03-01',
        location: 'NYC',
        search: 'music',
        category: 'concert',
      },
    });

    // Your utils format order: page, limit, search, category, location, date
    expect(qs).toBe('page=2&limit=25&search=music&category=concert&location=NYC&date=2025-03-01');
  });

  it('organizer QS ignores creator filter (document current behavior)', () => {
    // Type escape is intentional here: we want to verify that "creator" does NOT leak into the QS.
    const qs = buildOrganizerQS({
      page: 1,
      limit: 10,
      filters: { search: 'x', creator: 'should-not-appear', location: 'NYC' },
    });

    expect(qs).toBe('page=1&limit=10&search=x&location=NYC');
    expect(qs.includes('creator=')).toBe(false);
  });

  it('builds admin query string with consistent ordering', () => {
    const qs = buildAdminQS({
      limit: 50,
      page: 3,
      filters: {
        location: 'NYC',
        search: 'music',
        category: 'concert',
        date: '2025-03-01',
      },
    });

    // Your utils format order: page, limit, search, category, location, date
    expect(qs).toBe('page=3&limit=50&search=music&category=concert&location=NYC&date=2025-03-01');
  });
});
