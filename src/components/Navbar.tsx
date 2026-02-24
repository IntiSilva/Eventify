'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { UserButton, useUser } from '@clerk/nextjs';
import { UserRole } from '@/generated/prisma';
import ContactInfoPanel from './Contact/ContactInfoPanel';
import Searchbar from './Searchbar/Searchbar';
import AnimatedLogo from './AnimatedLogos/AnimatedLogo';
import { Phone } from 'lucide-react';
import { motion, type Variants } from 'motion/react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';
import { primeProfilePhone } from '@/lib/profilePhoneCache';
import { useSearchContext } from '@/contexts/SearchContext';

export default function Navbar() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const { user, isLoaded } = useUser();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isNarrowScreen = useMediaQuery('(max-width: 390px)');
  const { showNavbarSearchbar, onSearchSubmit } = useSearchContext();

  const role = (user?.publicMetadata?.role as UserRole) ?? UserRole.user;
  const canManageContact = role === UserRole.admin || role === UserRole.organizer;

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
        <div
          className="ml-2 flex items-center"
          onPointerEnter={prefetchContactPhone}
          onFocus={prefetchContactPhone}
          onPointerDown={prefetchContactPhone}
        >
          {/* Cross-fade wrapper */}
          <div className="relative w-7 h-7">
            {/* Skeleton */}
            <div
              className={cn(
                'absolute inset-0 rounded-full bg-white/20 animate-pulse transition-opacity duration-200 ease-out',
                isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
              )}
            />

            {/* UserButton */}
            <div
              className={cn(
                'absolute inset-0 transition-opacity duration-300 ease-in',
                isLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
            >
              {canManageContact ? (
                <UserButton>
                  <UserButton.MenuItems>
                    <UserButton.Action label="Contact" labelIcon={<Phone size={16} />} open="contact" />
                  </UserButton.MenuItems>
                  <UserButton.UserProfilePage label="Contact" url="contact" labelIcon={<Phone size={16} />}>
                    <ContactInfoPanel />
                  </UserButton.UserProfilePage>
                </UserButton>
              ) : (
                <UserButton />
              )}
            </div>
          </div>
        </div>
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
    onPointerEnter={prefetchContactPhone}
    onPointerDown={prefetchContactPhone}
    onFocus={prefetchContactPhone}
  >
    <div className="relative w-7 h-7">
      <div
        className={cn(
          'absolute inset-0 rounded-full bg-white/20 animate-pulse transition-opacity duration-200 ease-out',
          isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
      />
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-300 ease-in',
          isLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {canManageContact ? (
          <UserButton>
            <UserButton.MenuItems>
              <UserButton.Action label="Contact" labelIcon={<Phone size={16} />} open="contact" />
            </UserButton.MenuItems>
            <UserButton.UserProfilePage label="Contact" url="contact" labelIcon={<Phone size={16} />}>
              <ContactInfoPanel />
            </UserButton.UserProfilePage>
          </UserButton>
        ) : (
          <UserButton />
        )}
      </div>
    </div>
  </div>

</nav>

  );
}
