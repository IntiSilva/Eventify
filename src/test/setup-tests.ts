import '@testing-library/jest-dom/vitest';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import { server } from './msw/server';

// MSW: interceptar /api/*
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// APIs de browser que tu app usa
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
  })
});

class RO { observe(){} unobserve(){} disconnect(){} }
class IO { observe(){} unobserve(){} disconnect(){} }
Object.defineProperty(window, 'ResizeObserver', { value: RO });
Object.defineProperty(window, 'IntersectionObserver', { value: IO });

// (Opcional) mocks de Clerk si un test lo pide
// vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isSignedIn: true }) }));

// --- requestAnimationFrame polyfill (estable en jsdom)
if (!globalThis.requestAnimationFrame) {
  const raf = (cb: FrameRequestCallback): number =>
    window.setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.requestAnimationFrame = raf;
}

if (!globalThis.cancelAnimationFrame) {
  const caf = (id: number): void =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  globalThis.cancelAnimationFrame = caf;
}

// --- EXISTENTE: tus imports / setup de MSW, jest-dom, etc. ---

// Polyfills para APIs que usa Radix/cmdk y no existen en JSDOM
if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => {},
    writable: true,
  });
}
// algunas libs llaman sobre HTMLElement; por las dudas:
if (!('scrollIntoView' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: () => {},
    writable: true,
  });
}

// También conviene neutralizar scrollTo en window/element
if (typeof window.scrollTo !== 'function') {
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
}

if (!('scrollTo' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: () => {},
    writable: true,
  });
}

// --- DOMRect (defensivo para librerías de posicionamiento) ---
if (typeof globalThis.DOMRect === 'undefined') {
  const g = globalThis as unknown as { DOMRect?: typeof DOMRect };
  if (typeof g.DOMRect === 'undefined') {
    g.DOMRect = class DOMRect {
    x = 0; y = 0; width = 0; height = 0;
    top = 0; left = 0; right = 0; bottom = 0;
    constructor(x = 0, y = 0, w = 0, h = 0) {
      this.x = x; this.y = y; this.width = w; this.height = h;
      this.top = y; this.left = x; this.right = x + w; this.bottom = y + h;
    }
  } as unknown as typeof DOMRect;
}
}

// Radix Select necesita pointer capture en JSDOM
if (!('hasPointerCapture' in Element.prototype)) {
  Object.defineProperties(Element.prototype, {
    hasPointerCapture:   { value: () => false, configurable: true },
    setPointerCapture:   { value: () => {},    configurable: true },
    releasePointerCapture:{ value: () => {},    configurable: true },
  });
}

// (por si tu versión de jsdom no define PointerEvent)
if (!('PointerEvent' in window)) {
  // @ts-expect-error shim mínimo
  window.PointerEvent = class PointerEvent extends MouseEvent {};
}

// --- MSW debug opcional: activar con VITEST_DEBUG_MSW=1 ---
if (process.env.VITEST_DEBUG_MSW === '1') {
  server.events.on('request:start', ({ request }) => {
    console.log('[msw] start ', request.method, request.url);
  });
  server.events.on('request:match', ({ request }) => {
    console.log('[msw] match  ', request.url);
  });
  server.events.on('response:mocked', ({ request, response }) => {
    console.log('[msw] mocked', request.url, 'status', response.status);
  });

  // Limpieza de listeners
  afterAll(() => {
    const events = server.events as unknown as { removeAllListeners?: () => void };
    events.removeAllListeners?.();
  });
}

