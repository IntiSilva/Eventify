'use client'

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, Variants } from 'motion/react';
import { cn } from '@/lib/utils';
import AnimatedIcon from './AnimatedIcon';
import InToHoverIcon from './InToHoverIcon';
import { 
  SearchAnimatedIcon, 
  SearchAnimatedIconHover, 
  XAnimatedIcon, 
  XAnimatedIconHover, 
  XAnimatedIconClick 
} from '@/lib/icons';

interface SearchToggleIconProps {
  isSearchUIVisible: boolean;
  isScrolled: boolean;
  isNarrowScreen: boolean;
  isDesktop: boolean;
  onClick: () => void;
}

const iconVariants: Variants = {
  enter: (isDesktop: boolean) => ({ rotate: isDesktop ? 90 : -90, scale: 0.5, opacity: 0 }),
  center: { rotate: 0, scale: 1, opacity: 1 },
  exit: (isDesktop: boolean) => ({ rotate: isDesktop ? -90 : 0, scale: 0.5, opacity: 0 }),
};

export default function SearchToggleIcon({ isSearchUIVisible, isScrolled, isNarrowScreen, isDesktop, onClick }: SearchToggleIconProps) {
  const [isIconHovered, setIsIconHovered] = useState(false);
  const [playSearchClickAnimation, setPlaySearchClickAnimation] = useState(false);
  const [playXClickAnimation, setPlayXClickAnimation] = useState(false);
  const clickAnimationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (clickAnimationTimeoutRef.current) clearTimeout(clickAnimationTimeoutRef.current);
    };
  }, []);
  
  const handleIconClick = () => {
    if (!isDesktop) {
        onClick();
        return;
    }
    if (playSearchClickAnimation || playXClickAnimation) return;
    if (clickAnimationTimeoutRef.current) clearTimeout(clickAnimationTimeoutRef.current);

    const action = isSearchUIVisible ? setPlayXClickAnimation : setPlaySearchClickAnimation;
    action(true);

    clickAnimationTimeoutRef.current = setTimeout(() => {
        onClick();
        action(false); 
    }, 150);
  };

  return (
    <div 
      className={cn(
        `flex items-center justify-center rounded-full relative shrink-0 transition-all duration-300 ease-in-out cursor-pointer`,
        isSearchUIVisible ? 'bg-emerald-700' : 'bg-transparent',  
        isNarrowScreen 
                ? (isScrolled ? 'w-[28px] h-[28px]' : 'w-[32px] h-[32px]') 
                : (isScrolled ? 'w-[33px] h-[33px]' : 'w-9 h-9')
      )} 
      onMouseEnter={isDesktop ? () => setIsIconHovered(true) : undefined} 
      onMouseLeave={isDesktop ? () => setIsIconHovered(false) : undefined} 
      onClick={handleIconClick}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {!isSearchUIVisible ? (
          <motion.div 
            key="search" 
            variants={iconVariants} 
            custom={isDesktop} 
            initial="enter" 
            animate="center" 
            exit="exit" 
            transition={{ type: "spring", stiffness: 400, damping: 25 }} 
            className="w-full h-full flex items-center justify-center"
          >
            <div className="relative w-[26px] h-[26px]">
              <AnimatedIcon 
                icon={SearchAnimatedIcon} 
                size={26} 
                state="in" 
                className={cn("absolute inset-0 transition-all ease-in-out duration-300", (isIconHovered || playSearchClickAnimation) && isDesktop ? "opacity-0" : "opacity-100")} 
              />
              <AnimatedIcon 
                icon={SearchAnimatedIconHover} 
                size={26} 
                state='hover' 
                colors={{primary: '#ffffff'}} 
                play={(isIconHovered || playSearchClickAnimation) && isDesktop} 
                className={cn("absolute inset-0 transition-all ease-in-out duration-300", (isIconHovered || playSearchClickAnimation) && isDesktop ? "opacity-100" : "opacity-0")} 
              />
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="close" 
            variants={iconVariants} 
            custom={isDesktop} 
            initial="enter" 
            animate="center" 
            exit="exit" 
            transition={{ type: "spring", stiffness: 400, damping: 25 }} 
            className="w-full h-full flex items-center justify-center"
          >
            <InToHoverIcon 
              isDesktop={isDesktop} 
              size={26} 
              inIcon={XAnimatedIcon} 
              hoverIcon={XAnimatedIconHover} 
              actionIcon={XAnimatedIconClick} 
              isParentHovered={isIconHovered} 
              playTrigger={playXClickAnimation} 
              resetTrigger={!isSearchUIVisible} 
              inColors={{primary: '#ffffff'}} 
              hoverColors={{primary: '#ffffff'}} 
              actionColors={{primary: '#ffffff'}} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}