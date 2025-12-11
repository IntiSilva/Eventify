import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { cn } from "@/lib/utils";

type VariantName =
  | "accordion-spring"
  | "slide-up"
  | "scale-y"
  | "blur-in"
  | "tilt-3d"
  | "clip-reveal"
  | "fade";

type StyleTarget = Record<string, number | string>;

type VariantConfig = {
  initial: StyleTarget;
  animate: StyleTarget;
  exit: StyleTarget;
  transition?: Transition;
  wrapClass?: string;
  wrapStyle?: React.CSSProperties;
};

export function CollapseMotion({
  show,
  children,
  className,
  variant = "accordion-spring",
  duration = 0.28,
  delay = 0,
}: {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: VariantName;
  duration?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return show ? <div className={className}>{children}</div> : null;
  }

  const base: Transition = { duration, delay, ease: [0.22, 1, 0.36, 1] };

  const CONFIGS: Record<VariantName, VariantConfig> = {
    "accordion-spring": {
      initial: { opacity: 0, height: 0, y: -6 },
      animate: { opacity: 1, height: "auto", y: 0 },
      exit: { opacity: 0, height: 0, y: -6 },
      transition: { type: "spring", stiffness: 280, damping: 28, bounce: 0.15 },
      wrapClass: "overflow-hidden",
    },
    "slide-up": {
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: 12 },
      transition: base,
    },
    "scale-y": {
      initial: { opacity: 0, scaleY: 0.86, y: -4, transformOrigin: "top center" },
      animate: { opacity: 1, scaleY: 1, y: 0 },
      exit: { opacity: 0, scaleY: 0.86, y: -4 },
      transition: { ...base, duration: Math.max(0.22, duration - 0.04) },
      wrapClass: "origin-top",
    },
    "blur-in": {
      initial: { opacity: 0, filter: "blur(10px)", y: 8 },
      animate: { opacity: 1, filter: "blur(0px)", y: 0 },
      exit: { opacity: 0, filter: "blur(10px)", y: 8 },
      transition: base,
    },
    "tilt-3d": {
      initial: { opacity: 0, rotateX: -12, y: -8 },
      animate: { opacity: 1, rotateX: 0, y: 0 },
      exit: { opacity: 0, rotateX: -12, y: -8 },
      transition: { ...base, duration: Math.max(0.26, duration) },
      wrapStyle: { perspective: "900px", transformStyle: "preserve-3d" },
    },
    "clip-reveal": {
      initial: { opacity: 0, clipPath: "inset(0 0 100% 0 round 12px)" },
      animate: { opacity: 1, clipPath: "inset(0 0 0% 0 round 12px)" },
      exit: { opacity: 0, clipPath: "inset(0 0 100% 0 round 12px)" },
      transition: base,
      wrapClass: "overflow-hidden",
    },
    fade: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: base,
    },
  };

  const cfg: VariantConfig = CONFIGS[variant];

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {show && (
        <motion.div
          layout
          initial={cfg.initial}
          animate={cfg.animate}
          exit={cfg.exit}
          transition={cfg.transition}
          className={cn(cfg.wrapClass, className)}
          style={cfg.wrapStyle}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
