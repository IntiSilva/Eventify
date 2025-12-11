'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import InToHoverIcon from '@/components/LordIcons/InToHoverIcon';
import {
  ArrowAnimatedIcon,
  ArrowAnimatedIconHover,
  ArrowAnimatedIconClick,
} from '@/lib/icons';

interface AnimatedCarouselArrowProps {
  direction: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
  isDesktop: boolean;
  className?: string;
  variant?: 'carousel' | 'pagination';
  size?: number;          // desktop & default
  mobileSize?: number;    // optional for mobile
}

export default function AnimatedCarouselArrow({
  direction,
  onClick,
  disabled,
  isDesktop,
  className = '',
  variant = 'carousel',
  size = 36,
  mobileSize,
}: AnimatedCarouselArrowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [playClick, setPlayClick] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clean up the timer if the component unmounts
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = () => {
    if (disabled || playClick) return;
    setPlayClick(true);
    onClick();
    // Reset the click animation state after a short delay
    timeoutRef.current = setTimeout(() => {
      setPlayClick(false);
    }, 150); // Click animation duration
  };

  const rotation = direction === 'left' ? '-rotate-90' : 'rotate-90';

  const variantClasses =
    variant === 'carousel'
      ? 'absolute top-1/2 -translate-y-1/2 hidden sm:flex'
      : 'static translate-y-0 flex'; // pagination

  const iconSize = isDesktop ? size : (mobileSize ?? size);

  return (
    <button
      type="button"
      className={cn(
        'p-2 rounded-full z-10 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled ? 'opacity-30 cursor-not-allowed' : 'opacity-100 cursor-pointer',
        variantClasses,
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Scroll previous' : 'Scroll next'}
    >
      <div className={rotation}>
        <InToHoverIcon
          isDesktop={isDesktop}
          size={iconSize}
          inIcon={ArrowAnimatedIcon}
          hoverIcon={ArrowAnimatedIconHover}
          actionIcon={ArrowAnimatedIconClick}
          isParentHovered={isHovered}
          playTrigger={playClick}
          resetTrigger={false}
          inColors={{ primary: '#ffffff' }}
          hoverColors={{ primary: '#ffffff' }}
          actionColors={{ primary: '#ffffff' }}
        />
      </div>
    </button>
  );
}
