'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { UserRole } from '@/generated/prisma';
import Searchbar from '@/components/Searchbar/Searchbar';
import AnimatedLogo from '@/components/AnimatedLogos/AnimatedLogo';
import { motion, type Variants } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';
import { primeProfilePhone } from '@/lib/profilePhoneCache';
import { useSearchContext } from '@/contexts/SearchContext';
import { NavbarUserControl } from './NavbarUserControl';

type NavbarProps = {
  viewerRole?: UserRole | null;
};

export default function Navbar({ viewerRole = null }: NavbarProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const { user } = useUser();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isNarrowScreen = useMediaQuery('(max-width: 390px)');
  const { showNavbarSearchbar, onSearchSubmit } = useSearchContext();

  const role =
    viewerRole ??
    ((user?.publicMetadata?.role as UserRole | undefined) ?? UserRole.user);
  const canManageContact = role === UserRole.admin || role === UserRole.organizer;
  const canManagePaymentsConnect = role === UserRole.organizer;

  const prefetchContactPhone = () => {
    // Only warm cache for admins/organizers
    if (!canManageContact) return;
    void primeProfilePhone();
  };

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // LOGO VARIANTS:
  // When hidden, it slides left (-20px) and its width collapses to 0.
  const logoVariants: Variants = {
    visible: {
      opacity: 1,
      scale: 1,
      width: 'auto',
      x: 0,
      transition: { type: 'spring', stiffness: 400, damping: 30 },
    },
    hidden: {
      opacity: 0,
      scale: 0.5,
      width: 0,
      x: -20,
      transition: { duration: 0.2 },
    },
  };

  const userButtonVariants: Variants = {
    visible: {
      opacity: 1,
      scale: 1,
      width: 'auto',
      x: 0,
      transition: { type: 'spring', stiffness: 400, damping: 30 },
    },
    hidden: {
      opacity: 0,
      scale: 0.5,
      width: 0,
      x: 20,
      transition: { duration: 0.2 },
    },
  };

  return (
    <nav
      className={cn(
        'fixed top-0 w-full z-50 flex items-center justify-between max-xs2:p-2 px-4 sm:px-6 py-4 bg-black border-b border-zinc-800 transition-all duration-300 ease-in-out',
        isScrolled ? 'h-[52px]' : 'h-[65px]'
      )}
      data-role="navbar"
    >
      {/* --- MOBILE VIEW --- */}
      <div className="sm:hidden flex items-center justify-between w-full">
        <div className={cn('transition-transform duration-300', !isDesktop && isScrolled && 'scale-90')}>
          <motion.div variants={logoVariants} animate={isSearchOpen ? 'hidden' : 'visible'}>
            <Link href="/" className="text-2xl text-white font-bold">
              <div className="w-8">
                <AnimatedLogo />
              </div>
            </Link>
          </motion.div>
        </div>

        <div className="flex-1 flex justify-end">
          {showNavbarSearchbar && (
            <Suspense fallback={null}>
              <Searchbar
                onVisibilityChange={setIsSearchOpen}
                isScrolled={isScrolled}
                isDesktop={isDesktop}
                isNarrowScreen={isNarrowScreen}
                onSearchSubmit={onSearchSubmit}
              />
            </Suspense>
          )}
        </div>

        <div>
          <motion.div
            variants={userButtonVariants}
            animate={isSearchOpen || (!isDesktop && isScrolled) ? 'hidden' : 'visible'}
          >
            <NavbarUserControl
              className="ml-2"
              canManageContact={canManageContact}
              canManagePaymentsConnect={canManagePaymentsConnect}
              onPrefetchContactPhone={prefetchContactPhone}
            />
          </motion.div>
        </div>
      </div>

      {/* --- DESKTOP VIEW --- */}

      <div className="hidden md:flex">
        {showNavbarSearchbar && (
          <Suspense fallback={null}>
            <Searchbar
              isScrolled={isScrolled}
              isDesktop={isDesktop}
              isNarrowScreen={isNarrowScreen}
              onSearchSubmit={onSearchSubmit}
            />
          </Suspense>
        )}
      </div>

      <div
        className={cn(
          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block transition-transform duration-300',
          isDesktop && isScrolled && 'scale-75'
        )}
      >
        <Link href="/" className="font-bold pointer-events-auto">
          <div className="w-7">
            <AnimatedLogo />
          </div>
        </Link>
      </div>

      <div
        className={cn(
          'hidden md:flex justify-end origin-right transition-transform duration-300',
          isDesktop && isScrolled && 'scale-90'
        )}
      >
        <NavbarUserControl
          canManageContact={canManageContact}
          canManagePaymentsConnect={canManagePaymentsConnect}
          onPrefetchContactPhone={prefetchContactPhone}
        />
      </div>
    </nav>
  );
}
