import type React from 'react';

export type ScrollFeel = {
  gain: number;        // base sensitivity
  maxStepPx: number;   // per-tick clamp
  deadzonePx: number;  // ignore small noise
  blend: number;       // 0 = direct position, 1 = full inertia
  velScale: number;    // how much it contributes to inertia
  posScale: number;    // how much it contributes to direct position
};

export const SCROLL_FEELS: Record<'trackpad'|'wheel'|'buttery'|'tight', ScrollFeel> = {
  trackpad: { gain: 0.72, maxStepPx: 64,  deadzonePx: 1, blend: 0.65, velScale: 10, posScale: 0.12 },
  wheel:    { gain: 0.95, maxStepPx: 110, deadzonePx: 0, blend: 0.50, velScale: 14, posScale: 0.18 },
  buttery:  { gain: 0.66, maxStepPx: 56,  deadzonePx: 1, blend: 0.80, velScale:  9, posScale: 0.10 },
  tight:    { gain: 0.85, maxStepPx: 80,  deadzonePx: 1, blend: 0.25, velScale: 12, posScale: 0.20 },
};

export type DragFeel = ScrollFeel;
export const DRAG_DEFAULT: DragFeel = { gain: 1.0, maxStepPx: 96, deadzonePx: 0.5, blend: 0.40, velScale: 14, posScale: 0.22 };

// Common helper: applies gain + deadzone + clamp (without deciding vel/pos contribution)
export function applyStep(v: number, feel: { gain:number; maxStepPx:number; deadzonePx:number }): number {
  const x = v * feel.gain;
  if (Math.abs(x) < feel.deadzonePx) return 0;
  return clamp(x, -feel.maxStepPx, feel.maxStepPx);
}

/* ───────────────────────── Numbers / algebra ───────────────────────── */

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Mathematical modulo that always returns a positive result in [0, m). */
export function modulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Is the value practically zero? Useful for deadzones/latches. */
export function nearlyZero(v: number, eps: number = 1e-3): boolean {
  return Math.abs(v) < eps;
}

/** Continuous exponential decay: v(t+dt) = v * e^(-λ·dt) */
export function expDecay(v: number, lambda: number, dtSeconds: number): number {
  if (lambda <= 0) return v;
  if (dtSeconds <= 0) return v;
  return v * Math.exp(-lambda * dtSeconds);
}

/** “Smooth” alpha for exponential lerp: 1 - e^(-rate·dt) */
export function expLerpAlpha(rate: number, dtSeconds: number): number {
  if (rate <= 0 || dtSeconds <= 0) return 0;
  return 1 - Math.exp(-rate * dtSeconds);
}

/** Time-continuous, numerically stable exponential lerp. */
export function expLerp(current: number, target: number, rate: number, dtSeconds: number): number {
  const a = expLerpAlpha(rate, dtSeconds);
  return current + (target - current) * a;
}

/** Snap to the device-pixel-ratio grid (avoids jitter in transforms). */
export function snapToDpr(v: number, dpr?: number): number {
  const r =
    dpr ??
    (typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1);
  const safeR = r > 0 ? r : 1;
  return Math.round(v * safeR) / safeR;
}

/* ───────────────────────── Easing ───────────────────────── */

export function easeInOutCubic(t: number): number {
  // t in [0,1]
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ───────────────────────── Wheel / pointer ───────────────────────── */

/**
 * Converts the wheel delta to pixels, normalizing deltaMode:
 *  - 0: already in px
 *  - 1: lines ⇒ approx. 16 px per line
 *  - 2: pages ⇒ uses the container height (or fallbackViewport)
 */
export function wheelDeltaInPixels(
  e: React.WheelEvent,
  fallbackViewport: number = 800
): number {
  const ne = e.nativeEvent as WheelEvent;
  let delta = e.deltaY;

  // WheelEvent.deltaMode: 0=px, 1=line, 2=page
  if (ne.deltaMode === 1) {
    delta *= 16; // common heuristic
  } else if (ne.deltaMode === 2) {
    const h = (e.currentTarget as HTMLElement | null)?.clientHeight ?? fallbackViewport;
    delta *= h;
  }
  return delta;
}

/* ───────────────────────── Interactive / gating ───────────────────────── */

/** Selectors we consider “interactive” (don’t start drag/scroll when starting there). */
export const INTERACTIVE_SELECTOR =
  '[data-no-drag],button,a,[role="button"],input,select,textarea,[contenteditable="true"]';

/**
 * Returns true if the event started on an interactive target:
 *  - avoids capturing drag/scroll when the user intends to click/edit
 */
export function isInteractiveTarget(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest(INTERACTIVE_SELECTOR);
}
