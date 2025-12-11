// Centralized theme for all emails (single dark theme).
export const colors = {
  bg: "#000000",
  card: "#0a0a0a",        // a slightly lighter black for the card background
  border: "#3f3f46",      // zinc-700
  fg: "#ffffff",
  muted: "#a1a1aa",       // zinc-400
  brand: "#6366f1",       // indigo-500 (example for CTAs)
};

export const radii = {
  card: 10,   // ~rounded-md/lg
  button: 8,
};

export const fonts = {
  // Emails have limited webfont support; we map to safe stacks.
  display: '"Michroma", Arial, sans-serif',
  heading: '"Plus Jakarta Sans", Arial, sans-serif',
  body:
    '"Figtree", -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

export const layout = {
  maxWidth: 560,
  gutterX: 24,
  gutterY: 32,
};
