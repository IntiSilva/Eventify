'use client';

import { useEffect, useRef, useState, ElementType } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animate, stagger, useInView } from 'motion/react';

type SplitMode = 'word' | 'char';

interface AnimatedTextProps {
  title: string;
  subtitle?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p';
  containerClassName?: string;
  headingClassName?: string;
  subtitleClassName?: string;
  /** Renders inline, right after the last character of the title */
  inlineAddon?: ReactNode;
  /** How to split the TITLE for animation: by words (default) or characters */
  splitMode?: SplitMode;
}

const isWhitespace = (str: string) => /^\s+$/.test(str);

function buildTitleUnits(
  root: HTMLSpanElement,
  text: string,
  mode: SplitMode
): HTMLElement[] {
  const doc = root.ownerDocument;
  root.textContent = '';
  const units: HTMLElement[] = [];

  if (mode === 'char') {
    // Split into segments while preserving spaces
    const parts = text.split(/(\s+)/);

    for (const part of parts) {
      if (!part) continue;

      if (isWhitespace(part)) {
        // Keep spaces as plain text so the browser can break BETWEEN words
        root.appendChild(doc.createTextNode(part));
      } else {
        // Word wrapper: this prevents line breaks inside the word
        const wordWrapper = doc.createElement('span');
        wordWrapper.style.display = 'inline-block';

        for (const ch of Array.from(part)) {
          const span = doc.createElement('span');
          span.textContent = ch;
          span.style.display = 'inline-block';
          wordWrapper.appendChild(span);

          // We still animate each individual letter
          units.push(span);
        }

        root.appendChild(wordWrapper);
      }
    }

    return units;
  }

  // --- 'word' mode, same behavior as before ---
  const parts = text.split(/(\s+)/); // Keeps whitespace segments

  for (const part of parts) {
    if (!part) continue;

    if (isWhitespace(part)) {
      root.appendChild(doc.createTextNode(part));
    } else {
      const span = doc.createElement('span');
      span.textContent = part;
      span.style.display = 'inline-block';
      root.appendChild(span);
      units.push(span);
    }
  }

  return units;
}

function buildSubtitleUnits(el: HTMLParagraphElement, text: string): HTMLElement[] {
  const doc = el.ownerDocument;
  el.textContent = '';
  const units: HTMLElement[] = [];

  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    if (!part) continue;

    if (isWhitespace(part)) {
      el.appendChild(doc.createTextNode(part));
    } else {
      const span = doc.createElement('span');
      span.textContent = part;
      span.style.display = 'inline-block';
      el.appendChild(span);
      units.push(span);
    }
  }

  return units;
}

export default function AnimatedText({
  title,
  subtitle = '',
  as = 'h2',
  containerClassName = 'text-center md:text-left',
  headingClassName =
    'text-4xl md:text-5xl lg:text-6xl text-white font-bold font-display tracking-widest opacity-0',
  subtitleClassName =
    'mt-4 text-md md:text-lg text-zinc-400 italic font-heading opacity-0',
  inlineAddon,
  splitMode = 'word',
}: AnimatedTextProps) {
  const HeadingTag = as as ElementType;

  const containerRef = useRef<HTMLDivElement>(null);

  // Overlay refs
  const titleRef = useRef<HTMLHeadingElement>(null);
  const splitRootRef = useRef<HTMLSpanElement>(null);
  const addonAnchorRef = useRef<HTMLSpanElement>(null);

  // Anchor element for the portal
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // Trigger animations once in view
  const isInView = useInView(containerRef, { once: true });

  // Prepare portal target after mount
  useEffect(() => {
    setAnchorEl(addonAnchorRef.current);
  }, []);

  useEffect(() => {
    if (!isInView) return;

    let cancelled = false;

    const run = async () => {
      // Wait for fonts so layout is stable before animating
      if (typeof document !== 'undefined' && 'fonts' in document) {
        try {
          await document.fonts.ready;
        } catch {
          // ignore
        }
      }
      if (cancelled) return;

      const root = splitRootRef.current;
      const headingEl = titleRef.current;
      if (!root || !headingEl) return;

      const subtitleEl =
        containerRef.current?.querySelector<HTMLParagraphElement>(
          '[data-animated-subtitle]'
        ) ?? null;

      // prefers-reduced-motion
      const prefersReduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReduced) {
        // TITLE without splitting or animation
        root.textContent = title;
        headingEl.style.visibility = 'visible';
        headingEl.style.opacity = '1';
        headingEl.style.transform = 'none';

        // SUBTITLE without splitting or animation
        if (subtitleEl && subtitle) {
          subtitleEl.textContent = subtitle;
          subtitleEl.style.visibility = 'visible';
          subtitleEl.style.opacity = '1';
          subtitleEl.style.transform = 'none';
        }
        return;
      }

      // --- TITLE: split + animation ---
      const titleUnits = buildTitleUnits(root, title, splitMode);

      headingEl.style.visibility = 'visible';
      headingEl.style.opacity = '1';
      headingEl.style.transform = 'none';

      titleUnits.forEach((node) => {
        node.style.opacity = '0';
      });

      // Same animation as AnimatedColorableText but without rotateX
      animate(
        titleUnits,
        {
          opacity: [0, 1],
          y: [20, 0],
        },
        {
          duration: 0.7,
          delay: stagger(splitMode === 'char' ? 0.02 : 0.05),
          type: 'spring',
          damping: 13,
          stiffness: 200,
        }
      );

      // --- SUBTITLE: still word-level, soft animation ---
      if (subtitleEl && subtitle) {
        const subtitleUnits = buildSubtitleUnits(subtitleEl, subtitle);

        subtitleEl.style.visibility = 'visible';
        subtitleEl.style.opacity = '1';
        subtitleEl.style.transform = 'none';

        subtitleUnits.forEach((node) => {
          node.style.opacity = '0';
        });

        animate(
          subtitleUnits,
          { opacity: [0, 1] },
          {
            duration: 0.5,
            delay: stagger(0.03, { startDelay: 0.5 }),
          }
        );
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [title, subtitle, isInView, splitMode]);

  return (
    <div ref={containerRef} className={`${containerClassName} relative`}>
      {/* SIZER: reserves space to avoid layout shift (includes addon placeholder if present) */}
      <div className="pointer-events-none invisible select-none" aria-hidden="true">
        <HeadingTag className={headingClassName}>
          {title}
          {inlineAddon ? (
            <span
              aria-hidden="true"
              className="inline-block align-baseline ml-2 w-[18px] h-[18px]"
            />
          ) : null}
        </HeadingTag>
        {subtitle ? <p className={subtitleClassName}>{subtitle}</p> : null}
      </div>

      {/* ANIMATED OVERLAY: does not affect layout; addon is mounted inline via portal on the anchor */}
      <div className="absolute inset-0 pointer-events-none">
        <HeadingTag ref={titleRef} className={headingClassName}>
          <span ref={splitRootRef} data-split-root />
          <span
            ref={addonAnchorRef}
            data-inline-addon-anchor
            className="inline-flex align-baseline ml-2 pointer-events-auto tracking-normal"
          />
        </HeadingTag>
        {subtitle ? (
          <p data-animated-subtitle className={subtitleClassName} />
        ) : null}
      </div>

      {/* Mount the addon on the anchor so it stays attached to the last character and respects line wraps */}
      {anchorEl && inlineAddon ? createPortal(inlineAddon, anchorEl) : null}
    </div>
  );
}
