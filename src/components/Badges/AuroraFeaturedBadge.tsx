'use client';

import { motion } from 'motion/react';
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useMediaQuery } from '@/lib/hooks';

interface Props {
  variant?: 'carousel' | 'list';   // ← new prop
}

// 1. Base animation with higher opacity and scale for more presence.
const baseAuroraLayers = [
  { initial: { x: "-15%", scale: 0.9, opacity: 0.5 }, animate: { x: "15%", scale: 1.0, opacity: 0.6 }, transition: { duration: 12, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } },
  { initial: { y: "-20%", x: "25%", scale: 0.8, opacity: 0.4 }, animate: { y: "20%", x: "-25%", scale: 0.9, opacity: 0.5 }, transition: { duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -2 } },
  { initial: { y: "20%", x: "-25%", scale: 1.0, opacity: 0.6 }, animate: { y: "-20%", x: "25%", scale: 0.8, opacity: 0.4 }, transition: { duration: 8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -4 } },
] as const;

// Animations for MOBILE (390px to 767px)
const mobileAuroraLayers = [
  { initial: { x: "-15%", scale: 0.9, opacity: 0.3 }, animate: { x: "15%", scale: 1.0, opacity: 0.4 }, transition: { duration: 12, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } },
  { initial: { y: "-20%", x: "25%", scale: 0.7, opacity: 0.2 }, animate: { y: "20%", x: "-25%", scale: 0.9, opacity: 0.3 }, transition: { duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -2 } },
  { initial: { y: "20%", x: "-25%", scale: 1.0, opacity: 0.4 }, animate: { y: "-20%", x: "25%", scale: 0.8, opacity: 0.2 }, transition: { duration: 8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -4 } },
] as const;

// Animations for DESKTOP (>= 768px)
const desktopAuroraLayers = [
  { initial: { x: "-20%", scale: 1, opacity: 0.3 }, animate: { x: "20%", scale: 1.2, opacity: 0.5 }, transition: { duration: 12, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }, gradient: "radial-gradient(ellipse at center, #34d399, transparent 60%)" },
  { initial: { y: "-25%", x: "30%", scale: 0.8, opacity: 0.2 }, animate: { y: "25%", x: "-30%", scale: 1, opacity: 0.4 }, transition: { duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -2 }, gradient: "radial-gradient(ellipse at center, #10b981, transparent 60%)" },
  { initial: { y: "25%", x: "-30%", scale: 1.1, opacity: 0.5 }, animate: { y: "-25%", x: "30%", scale: 0.9, opacity: 0.2 }, transition: { duration: 8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -4 }, gradient: "radial-gradient(ellipse at center, #a7f3d0, transparent 70%)" },
] as const;

export default function AuroraFeaturedBadge({ variant = 'carousel' }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isMobile = useMediaQuery('(min-width: 390px)');

  const auroraLayers = isDesktop
    ? desktopAuroraLayers
    : isMobile
      ? mobileAuroraLayers
      : baseAuroraLayers;

  const mobileGradients = [
    "radial-gradient(ellipse at center, #34d399, transparent 60%)",
    "radial-gradient(ellipse at center, #10b981, transparent 60%)",
    "radial-gradient(ellipse at center, #a7f3d0, transparent 70%)"
  ];

  /* === classes depending on layout === */
  const sizeClasses =
    variant === 'list'
      ? 'px-2 xs3:px-3 md:px-4 py-1 xs3:py-1 md:py-1.5 rounded-sm xs3:rounded-md'
      : 'px-1 xs3:px-1.5 md:px-2.5 py-0.5 xs3:py-0.5 md:py-1 rounded-[4px] xs3:rounded-sm';

  const iconClasses =
    variant === 'list'
      ? 'h-[9px] w-[9px] xs3:h-[10px] xs3:w-[10px] md:h-4 md:w-4'
      : 'h-[7px] w-[7px] xs3:h-2 xs3:w-2 md:h-3 md:w-3';

  const textClasses =
    variant === 'list'
      ? 'text-[9px] xs3:text-2xs md:text-[12px]'
      : 'text-[7px] xs3:text-3xs md:text-[11px]';

  return (
    <Badge
      data-testid="aurora-featured-badge"
      variant="default"
      //2. Apply the same padding and border styles as Admin's Badge.
      className={cn(
        'relative rounded-[4px] xs3:rounded-sm overflow-hidden bg-black text-white border border-emerald-900 shadow-lg cursor-default',
        sizeClasses,
      )}
    >
      <div aria-hidden="true" className="absolute inset-0 -z-0">
        {auroraLayers.map((layer, i) => (
          <motion.div
            key={i}
            className="absolute inset-0"
            initial={layer.initial}
            animate={layer.animate}
            transition={layer.transition}
            style={{
              backgroundImage: isDesktop ? desktopAuroraLayers[i].gradient : mobileGradients[i]
            }}
          />
        ))}
      </div>
      {/*3. Apply the same text and icon styles. */}
      <div className="relative z-10 flex items-center gap-0.5">
        <Sparkles className={cn('max-xs3:mb-0.5', iconClasses)} />
        <p className={cn('font-semibold', textClasses)}>Featured</p>
      </div>
    </Badge>
  );
}
