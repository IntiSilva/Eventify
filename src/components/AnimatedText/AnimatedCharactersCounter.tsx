'use client';

import { useEffect } from "react";
import { useAnimate, motion, transform, useReducedMotion } from "motion/react";

interface AnimatedCharactersCounterProps {
  currentValue?: string;
  maxLength: number;
}

const AnimatedCharactersCounter = ({
  currentValue = "",
  maxLength,
}: AnimatedCharactersCounterProps) => {
  const charactersRemaining = maxLength - currentValue.length;
  const [scope, animate] = useAnimate();
  const shouldReduceMotion = useReducedMotion();
  const THRESHOLD = 10;

  // map remaining → color
  const mapRemainingToColor = transform(
    [-1, THRESHOLD / 2],
    ["#ef4444", "#a1a1aa"]
  );

  // Always reset to scale:1 whenever the threshold or reduce‐motion flag flips
  useEffect(() => {
    animate(
      scope.current,
      { scale: 1 },
      { duration: 0.1 }
    );
  }, [THRESHOLD, shouldReduceMotion, animate, scope]);

  useEffect(() => {
    // REDUCED‑MOTION MODE: only animate when within threshold
    if (shouldReduceMotion) {
      if (charactersRemaining > THRESHOLD) {
        // do nothing beyond the reset above
        return;
      }
      const velocity = transform([0, THRESHOLD], [50, 0])(
        Math.max(0, charactersRemaining)
      );
      animate(
        scope.current,
        { scale: [1.25, 1] },
        {
          type: "spring",
          velocity,
          stiffness: 700,
          damping: 80,
        }
      );
      return;
    }

     // NORMAL MODE: animate on *every* change
    // when past threshold (<= THRESHOLD) we pop larger, otherwise smaller
    const isLow = charactersRemaining <= THRESHOLD;
    const popScale = isLow ? [2, 1.4] : [1.2, 1];
    const stiffness = isLow ? 600 : 500;
    const damping = isLow ? 20 : 25;
    const duration = isLow ? 0.4 : 0.3; // More duration if close to limit

    animate(
      scope.current,
      { scale: popScale },
      {
        type: "spring",
        stiffness,
        damping,
        duration,
      }
    );
  }, [charactersRemaining, shouldReduceMotion, animate, scope]);

  return (
    <div className="flex text-2xs font-display">
      <motion.span
        ref={scope}
        style={{ color: mapRemainingToColor(charactersRemaining) }}
        className={`font-semibold ${
          charactersRemaining < 0 ? "text-rose-500" : ""
        }`}
      >
        {charactersRemaining}
      </motion.span>
    </div>
  );
};

export default AnimatedCharactersCounter;
