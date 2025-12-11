'use client';
import React from 'react';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { cn } from "@/lib/utils";

// Animations for the button
const auroraButtonLayers = [
  { initial: { x: "-40%", scale: 1, opacity: 0.4 }, animate: { x: "40%", scale: 1.2, opacity: 0.6 }, transition: { duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }, gradient: "radial-gradient(ellipse at center, #34d399, transparent 60%)" },
  { initial: { y: "-50%", x: "60%", scale: 0.8, opacity: 0.3 }, animate: { y: "50%", x: "-60%", scale: 1, opacity: 0.5 }, transition: { duration: 8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -2 }, gradient: "radial-gradient(ellipse at center, #10b981, transparent 60%)" },
  { initial: { y: "50%", x: "-60%", scale: 1.1, opacity: 0.6 }, animate: { y: "-50%", x: "60%", scale: 0.9, opacity: 0.3 }, transition: { duration: 6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: -4 }, gradient: "radial-gradient(ellipse at center, #a7f3d0, transparent 70%)" },
] as const;


export type AuroraButtonProps = React.ComponentPropsWithoutRef<typeof Button> & {
  emeraldBorder?: boolean;
};
type AuroraButtonRef = React.ComponentRef<typeof Button>;

export const AuroraButton = React.forwardRef<AuroraButtonRef, AuroraButtonProps>(
  ({ className, children, emeraldBorder = false, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        className={cn(
          'relative overflow-hidden bg-transparent hover:bg-transparent',
          '[transition-property:box-shadow,transform,border-color] duration-300 ease-out',
          'hover:shadow-[0px_2px_5px_rgba(16,185,129,0.8),_0px_0px_40px_rgba(16,185,129,0.3)]',
          'active:scale-[0.985]',
          // Apply border only if requested. Includes border-color transition.
          emeraldBorder && 'border border-emerald-900 hover:border-emerald-600',
          className
        )}
        {...props}
      >
        {/* Aurora layer */}
        <div aria-hidden="true" className="absolute inset-0 -z-0">
          {auroraButtonLayers.map((layer, i) => (
            <motion.div
              key={i}
              className="absolute inset-0"
              initial={layer.initial}
              animate={layer.animate}
              transition={layer.transition}
              style={{ backgroundImage: layer.gradient }}
            />
          ))}
        </div>

        {/* Button content */}
        <span className="relative z-10">{children}</span>
      </Button>
    );
  }
);

AuroraButton.displayName = 'AuroraButton';
