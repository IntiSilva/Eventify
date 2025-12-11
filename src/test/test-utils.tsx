import React, { PropsWithChildren } from 'react';
import { render as rtlRender, RenderOptions, renderHook, RenderHookOptions } from '@testing-library/react';
import { SWRConfig } from 'swr';

/**
 * Lightweight test renderer with:
 * - SWRConfig (no auto revalidation, easy fallback injection)
 * - Optional initial route (pushState)
 *
 * This can be extended to wrap real app providers:
 *   - SearchContext, MenuContext, ViewerTzContext, EventsContext, etc.
 *   - Just add them inside <Wrapper>.
 */
type RenderWithProvidersOptions = {
  route?: string;
  swrFallback?: Record<string, unknown>;
  swrProviderMap?: Map<unknown, unknown>;
} & Omit<RenderOptions, 'wrapper'>;

function Wrapper({
  children,
  swrFallback,
  swrProviderMap,
}: PropsWithChildren<{ swrFallback?: Record<string, unknown>; swrProviderMap?: Map<unknown, unknown> }>) {
  return (
    <SWRConfig
      value={{
        provider: () => swrProviderMap ?? new Map(),
        fallback: swrFallback,
        dedupingInterval: 0,
        revalidateOnFocus: false,
        revalidateIfStale: false,
        revalidateOnReconnect: false,
      }}
    >
      {/* TODO: can insert real Providers here, e.g.:
          <SearchProvider ...>
            <MenuProvider ...>
              <ViewerTzProvider ...>
                {children}
              </ViewerTzProvider>
            </MenuProvider>
          </SearchProvider>
      */}
      {children}
    </SWRConfig>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  { route = '/', swrFallback, swrProviderMap, ...rest }: RenderWithProvidersOptions = {},
) {
  // Allow tests to simulate a route
  if (typeof window !== 'undefined') {
    window.history.pushState({}, 'Test', route);
  }

  return rtlRender(ui, {
    wrapper: (props) => <Wrapper swrFallback={swrFallback} swrProviderMap={swrProviderMap} {...props} />,
    ...rest,
  });
}

// Optional re-export to keep import ergonomics in tests
export * from '@testing-library/react';

// Hook helper with the same providers (isolated SWR cache per test)
export function renderHookWithProviders<TProps, TResult>(
  callback: (props: TProps) => TResult,
  {
    route = '/',
    swrFallback,
    swrProviderMap,
    ...rest
  }: RenderWithProvidersOptions & Omit<RenderHookOptions<TProps>, 'wrapper'> = {},
) {
  if (typeof window !== 'undefined') {
    window.history.pushState({}, 'Test', route);
  }
  return renderHook(callback, {
    wrapper: (props) => <Wrapper swrFallback={swrFallback} swrProviderMap={swrProviderMap} {...props} />,
    ...rest,
  });
}
