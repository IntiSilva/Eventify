'use client';

import React, { ElementType, useEffect, useMemo, useRef } from 'react';
import { animate, stagger, useInView } from 'motion/react';
import { cn } from '@/lib/utils';

export type ColorableToken = {
  text: string;
  accent?: boolean;
};

type SplitMode = 'word' | 'char';

// Helper: detects strings that are only whitespace characters
const isWhitespace = (str: string) => /^\s+$/.test(str);

// Each unit is either a WORD (visible text) or a SPACE between words/tokens.
// We animate only the characters inside WORD units.
type Unit =
  | { type: 'word'; key: string; text: string; accent?: boolean }
  | { type: 'space'; key: string };

interface AnimatedColorableTextProps {
  tokens: ColorableToken[];
  as?: 'h1' | 'h2' | 'h3' | 'p';
  containerClassName?: string;
  headingClassName?: string;
  wordClassName?: string; // common styles for each animated unit (chars or words)
  accentClassName?: string; // styles for units with accent=true
  splitMode?: SplitMode;
}

export default function AnimatedColorableText({
  tokens,
  as = 'h2',
  containerClassName = 'text-left',
  headingClassName = 'text-3xl font-bold text-white font-display tracking-tight',
  wordClassName = 'inline-block opacity-0',
  accentClassName = 'text-emerald-400',
  splitMode = 'word',
}: AnimatedColorableTextProps) {
  const HeadingTag = as as ElementType;

  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isInView = useInView(containerRef, { once: true });

  const units = useMemo<Unit[]>(() => {
    const out: Unit[] = [];
    let counter = 0;

    tokens.forEach((t, tokenIndex) => {
      // Split each token preserving whitespace segments
      const parts = t.text.split(/(\s+)/);

      for (const part of parts) {
        if (!part) continue;

        if (isWhitespace(part)) {
          // Real whitespace between words inside this token
          out.push({
            type: 'space',
            key: `space-${tokenIndex}-${counter++}`,
          });
        } else {
          // Visible word segment (e.g. "Results", "for", "New", "York")
          out.push({
            type: 'word',
            key: `word-${tokenIndex}-${counter++}`,
            text: part,
            accent: t.accent,
          });
        }
      }

      // Extra space between tokens:
      // e.g. "Events [ ] on [ ] November..."
      if (tokenIndex < tokens.length - 1) {
        out.push({
          type: 'space',
          key: `space-token-${tokenIndex}-${counter++}`,
        });
      }
    });

    return out;
  }, [tokens]);

  useEffect(() => {
    if (!isInView || !headingRef.current) return;

    const nodes = headingRef.current.querySelectorAll<HTMLElement>('[data-char]');
    if (!nodes.length) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      // In reduced motion, show text immediately without fancy animation
      nodes.forEach((node) => {
        node.style.opacity = '1';
        node.style.transform = 'none';
      });
      return;
    }

    // Minimal initial state: hidden; we animate them in with Motion One
    nodes.forEach((node) => {
      node.style.opacity = '0';
    });

    animate(
      nodes,
      {
        opacity: [0, 1],
        y: [20, 0],
        rotateX: [90, 0],
      },
      {
        duration: 0.7,
        delay: stagger(splitMode === 'char' ? 0.02 : 0.05),
        type: 'spring',
        damping: 13,
        stiffness: 200,
      }
    );
  }, [isInView, tokens, splitMode]);

  return (
    <div ref={containerRef} className={containerClassName}>
      <HeadingTag ref={headingRef} className={headingClassName}>
        {units.map((u, idx) => {
          if (u.type === 'space') {
            // In CHAR mode we render real spaces between word wrappers.
            // In WORD mode we rely on &nbsp; inside the word spans instead.
            if (splitMode === 'char') {
              return ' ';
            }
            return null;
          }

          if (splitMode === 'char') {
            // CHAR MODE:
            // - Wrap each word in an inline-block span so the word never breaks.
            // - Inside that wrapper, we render one <span data-char> per letter
            //   so we still get character-by-character animation.
            return (
              <span
                key={u.key}
                className={cn('inline-block', u.accent && accentClassName)}
              >
                {Array.from(u.text).map((ch, charIndex) => (
                  <span
                    key={`${u.key}-ch-${charIndex}`}
                    data-char
                    className={wordClassName}
                  >
                    {ch}
                  </span>
                ))}
              </span>
            );
          }

          // WORD MODE:
          // - Single <span data-char> per word (original behavior).
          // - We keep a non-breaking space between words so tiny words
          //   don't float alone when wrapping.
          return (
            <span
              key={u.key}
              data-char
              className={cn(wordClassName, u.accent && accentClassName)}
            >
              {u.text}
              {idx !== units.length - 1 && (
                <span aria-hidden="true">&nbsp;</span>
              )}
            </span>
          );
        })}
      </HeadingTag>
    </div>
  );
}
