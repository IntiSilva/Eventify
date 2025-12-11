import { Variants } from 'motion/react';

// Authentication flow animation: “Neon Gate”
export const processFlowVariants: Variants = {
  // Initial state of the INCOMING PAGE
  initial: {
    x: '100%',        // Starts off-screen to the right
    scale: 1.05,      // Slightly larger, as if closer to the viewer
    opacity: 0,
    filter: 'blur(10px)', // Starts blurred to suggest speed
  },
  // Final state of the INCOMING PAGE
  animate: {
    x: '0%',
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)', // Sharpen as it settles in place
    transition: {
      type: 'spring',
      damping: 30,
      stiffness: 100,
      duration: 0.7,
    },
  },
  // Animation for the OUTGOING PAGE
  exit: {
    x: '-20%',        // Slides slightly left, not all the way out
    scale: 0.9,       // Shrinks to feel like it’s moving away
    opacity: 0,
    filter: 'blur(8px) brightness(0.6)', // Blurs and darkens as it departs
    // Neon glow magic:
    boxShadow: '40px 0px 60px -20px rgba(16, 185, 129, 0.3)', // Emerald-ish shadow
    transition: {
      type: 'tween',
      ease: 'easeOut',
      duration: 0.5,
    },
  },
};

export const GRID_STAGGER_IN  = 0.06; // staggered entrance
export const GRID_STAGGER_OUT = 0.05; // staggered exit
export const ITEM_EXIT_DURATION = 0.18; // must match the “exit” duration used by bloomItemVariants

export const gridStaggerVariants: Variants = {
  // We don’t move the container; we only orchestrate children
  initial: { opacity: 1 },
  animate: {
    opacity: 1,
    transition: {
      when: 'beforeChildren',
      staggerChildren: GRID_STAGGER_IN,
    },
  },
  exit: {
    opacity: 1,
    transition: {
      when: 'afterChildren',
      staggerChildren: GRID_STAGGER_OUT,
      staggerDirection: -1, // last one leaves first
    },
  },
};

// Child item animation for the main flow: “Content Bloom”
export const bloomItemVariants: Variants = {
  initial: {
    opacity: 0,
    y: 20,
    scale: 0.98,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 260,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    y: 6,
    scale: 0.98,
    filter: 'blur(2px)',
    transition: { duration: 0.18, ease: [0.2, 0.0, 0.2, 1] },
  },
};
