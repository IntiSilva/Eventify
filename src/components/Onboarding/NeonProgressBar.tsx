import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export function NeonProgressBar({
  value,               // 0..1
  height = 6,
  className,
}: { value: number; height?: number; className?: string }) {
  return (
    <svg
      className={cn("w-full overflow-visible", className)}
      width="100%"
      height={height}
      viewBox={`0 0 100 ${height}`} // Animate in "units 0..100”
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
    >
      {/* Track */}
      <line
        x1={0}
        y1={height / 2}
        x2={100}
        y2={height / 2}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={height}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        />

      {/* Black fill + green glow verde (no stroke) */}
      <motion.line
        x1={0}
        y1={height / 2}
        x2={100 * Math.max(0, Math.min(1, value))}
        y2={height / 2}
        stroke="#0a0a0b"
        strokeWidth={height}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={false}
        animate={{ x2: 100 * Math.max(0, Math.min(1, value)) }}
        transition={{ type: 'spring', stiffness: 160, damping: 22, mass: 0.6 }}
        style={{
            filter:
            'drop-shadow(0 0 1px rgba(16,185,129,.75)) drop-shadow(0 0 0.5px rgba(16,185,129,.9))',
        }}
        />
    </svg>
  );
}
