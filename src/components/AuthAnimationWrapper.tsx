'use client';

import { Children, isValidElement, useEffect, useState } from 'react';
import {
  AnimatePresence,
  motion,
  type Variants,
  useReducedMotion,
} from 'motion/react';
import { useMediaQuery } from '@/lib/hooks';


/*
 * - Mobile: plays a short intro (centered title) over a full-screen overlay,
 *   then reveals the Clerk form underneath.
 * - The form is mounted with a slight delay on mobile so the first paint
 *   stays light, and is fully "ready" by the time the intro finishes.
 * - Desktop: simple 2-column layout with entrance animations.
 */


interface AuthAnimationWrapperProps {
  children: React.ReactNode;
}

/**
 * How long the intro (centered title) stays visible on mobile
 * before transitioning to the form.
 */
const INTRO_DURATION_MS = 2200;

/**
 * When to mount the Clerk form on mobile (while the intro is running).
 * We mount it after this delay so the very first render stays light.
 */
const FORM_MOUNT_DELAY_MS = 700;

/** Desktop container: simple fade-in + small stagger between children */
const desktopContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delay: 0.3,
      staggerChildren: 0.35,
    },
  },
};

/** Desktop text column: fade + slight upward lift */
const desktopTextVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: 'easeOut' },
  },
};

/** Desktop form column: slide-in from the right */
const desktopFormVariants: Variants = {
  hidden: { opacity: 0, x: 80 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      type: 'spring',
      stiffness: 70,
      damping: 12,
    },
  },
};

/** Mobile intro (centered title) */
const mobileIntroVariants: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      // Slight delay so the background “arrives first”
      delay: 0.4,
      duration: 0.5,
      ease: 'easeOut',
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: 0.35,
      ease: 'easeInOut',
    },
  },
};

/**
 * Mobile form variants.
 * We keep the form in the tree while the intro is visible,
 * but we fade/slide it in only after the intro finishes.
 */
const mobileFormVariants: Variants = {
  initial: { opacity: 0, y: 40 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: 'easeOut',
    },
  },
};

export default function AuthAnimationWrapper({
  children,
}: AuthAnimationWrapperProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const prefersReducedMotion = useReducedMotion();

  const childArray = Children.toArray(children);
  const animatedText = childArray[0];
  const formComponent = childArray[1];

  // On first render, decide if we want the intro phase:
  // - Only on mobile
  // - Only if the user does NOT request reduced motion
  const shouldHaveIntroAtFirstRender =
    !isDesktop && !prefersReducedMotion;

  /**
   * introDone = false → we are in the "intro" phase (centered title)
   * introDone = true  → the form becomes the primary focus
   */
  const [introDone, setIntroDone] = useState<boolean>(
    () => !shouldHaveIntroAtFirstRender,
  );

  /**
   * formMounted controls WHEN we mount the <SignIn>/<SignUp>.
   *
   * - Desktop or reduced motion → mount immediately (no delay).
   * - Mobile with animations    → mount after a small delay
   *   while the intro is playing, but keep it visually hidden.
   */
  const shouldDelayFormMount =
    !isDesktop && !prefersReducedMotion;

  const [formMounted, setFormMounted] = useState<boolean>(
    () => !shouldDelayFormMount,
  );

  // Schedule the end of the intro on mobile (with animations enabled)
  useEffect(() => {
    const shouldIntro = !isDesktop && !prefersReducedMotion;

    if (!shouldIntro || introDone) return;

    const timeoutId = window.setTimeout(() => {
      setIntroDone(true);
    }, INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isDesktop, prefersReducedMotion, introDone]);

  // Schedule when to mount the form on mobile (while the intro is running)
  useEffect(() => {
    const shouldDelay = !isDesktop && !prefersReducedMotion;

    // Desktop or reduced motion → already mounted, nothing to do.
    if (!shouldDelay || formMounted) return;

    const timeoutId = window.setTimeout(() => {
      setFormMounted(true);
    }, FORM_MOUNT_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isDesktop, prefersReducedMotion, formMounted]);

  // ========= DESKTOP LAYOUT =========
  if (isDesktop) {
    return (
      <motion.main
        className="relative z-10 flex min-h-screen flex-col md:flex-row"
        variants={prefersReducedMotion ? undefined : desktopContainerVariants}
        initial={prefersReducedMotion ? undefined : 'hidden'}
        animate={prefersReducedMotion ? undefined : 'visible'}
      >
        {/* Text column */}
        <motion.div
          className="flex w-full items-center justify-center py-4 px-8 md:w-1/2 md:p-12"
          variants={prefersReducedMotion ? undefined : desktopTextVariants}
        >
          {isValidElement(animatedText) ? animatedText : null}
        </motion.div>

        {/* Form column */}
        <motion.div
          className="relative flex w-full items-center justify-center p-6 md:w-1/2"
          variants={prefersReducedMotion ? undefined : desktopFormVariants}
        >
          <div className="relative inline-block">
            {/* Glass / blur only on desktop */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 rounded-2xl bg-black/10
                         backdrop-blur-sm [-webkit-backdrop-filter:blur(8px)]
                         [backdrop-filter:blur(8px)]"
            />
            <div className="relative z-10">
              {isValidElement(formComponent) ? formComponent : null}
            </div>
          </div>
        </motion.div>
      </motion.main>
    );
  }

  // ========= MOBILE LAYOUT (intro overlay → form) =========

  const showIntro = !introDone && !prefersReducedMotion;
  const formIsVisuallyVisible = introDone || prefersReducedMotion;

  return (
    <main className="relative z-10 min-h-screen px-6 py-8 flex items-center justify-center">
      {/* FORM: rendered in normal flow.
         If it is taller than the viewport, the page can scroll. */}
      <div className="w-full max-w-md mx-auto">
        {formMounted && (
          <motion.section
            key="auth-form"
            variants={mobileFormVariants}
            initial="initial"
            animate={formIsVisuallyVisible ? 'animate' : 'initial'}
            style={{
              // Avoid interactions while the intro is still visible
              pointerEvents: formIsVisuallyVisible ? 'auto' : 'none',
            }}
          >
            {isValidElement(formComponent) ? formComponent : null}
          </motion.section>
        )}
      </div>

      {/* INTRO: full-screen overlay above the form while it plays */}
      <AnimatePresence>
        {showIntro && (
          <motion.section
            key="auth-intro"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={mobileIntroVariants}
            className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center px-6 text-center"
          >
            <div className="w-full max-w-md">
              {isValidElement(animatedText) ? animatedText : null}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
