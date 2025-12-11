import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import SearchInputWithAutocomplete from '@/components/Searchbar/SearchInputWithAutocomplete';
import type { SearchbarFilters } from '@/components/Searchbar/Searchbar';
import type { SearchSuggestionsResponse } from '@/types/api';
import { renderWithProviders, screen, waitFor } from '@/test/test-utils';
import { server } from '@/test/msw/server';

let errorSpy: MockInstance<typeof console.error>;

// Use real timers in this file
beforeEach(() => {
  // Silence React/cmdk warnings that don't affect assertions
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
   errorSpy.mockRestore();
});

const Harness = ({
  onSearchSubmit = vi.fn(),
}: {
  onSearchSubmit?: (filters: SearchbarFilters) => void;
}) => {
  const [value, setValue] = React.useState('');
  return (
    <SearchInputWithAutocomplete
      value={value}
      onValueChange={(v) => {
        // useful log if anything hangs
        // console.log('[Harness] onValueChange', v);
        setValue(v);
      }}
      onSearchSubmit={onSearchSubmit}
      isScrolled={false}
      // No need to pass mode/scope/localIndex: component has stable defaults
    />
  );
};

describe('SearchInputWithAutocomplete', () => {
  it('fetches debounced suggestions and submits search, then closes the panel', async () => {

    const suggestionHandler = vi.fn(({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('query')?.toLowerCase()).toBe('rock');

      const body = {
        success: true,
        data: ['Rock Fest', 'Maratón BA'],
      } satisfies SearchSuggestionsResponse;

      return HttpResponse.json(body);
    });
    server.use(http.get('/api/search-suggestions', suggestionHandler));

    const onSearchSubmit = vi.fn();
    renderWithProviders(<Harness onSearchSubmit={onSearchSubmit} />);

    const user = userEvent.setup(); // real timers
    const input = screen.getByPlaceholderText('Search...');

    await user.type(input, 'Rock');

    // Ensure the panel opened and options arrived
    await screen.findByRole('option', { name: 'Rock Fest' });
    expect(suggestionHandler).toHaveBeenCalledTimes(1);

    // Submit (should close the popover and keep the input value)
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onSearchSubmit).toHaveBeenCalledWith({ search: 'Rock' });
    });

    // Instead of waiting for the listbox to unmount, assert the option is gone…
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Rock Fest' })).not.toBeInTheDocument();
    });

    // …and the trigger reports "closed"
    const trigger = input.closest('[data-slot="popover-trigger"]');
    if (!(trigger instanceof HTMLElement)) {
      throw new Error('Popover trigger not found');
    }
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('does not refetch on refocus but fetches again after new input', async () => {
    
    const suggestionHandler = vi.fn(() => {
      const body = {
        success: true,
        data: ['Rock Fest'],
      } satisfies SearchSuggestionsResponse;

      return HttpResponse.json(body);
    });
    server.use(http.get('/api/search-suggestions', suggestionHandler));

    renderWithProviders(<Harness />);

    const user = userEvent.setup(); // real timers
    const input = screen.getByPlaceholderText('Search...');

    await user.type(input, 'Ro');

    await screen.findByRole('option', { name: 'Rock Fest' });
    expect(suggestionHandler).toHaveBeenCalledTimes(1);

    // blur/focus should NOT refetch
    input.blur();
    input.focus();
    expect(suggestionHandler).toHaveBeenCalledTimes(1);

    // typing a new character SHOULD refetch
    await user.type(input, 'c');

    await waitFor(() => expect(suggestionHandler).toHaveBeenCalledTimes(2));
  });
});
