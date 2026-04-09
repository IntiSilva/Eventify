'use client';

import { useEffect, useState } from 'react';
import { UserButton, useUser } from '@clerk/nextjs';
import { CreditCard, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import ContactInfoPanel from '@/components/Contact/ContactInfoPanel';
import PaymentsConnectPanel from '@/components/Payments/PaymentsConnectPanel';

type NavbarUserControlProps = {
  canManageContact: boolean;
  canManagePaymentsConnect: boolean;
  onPrefetchContactPhone: () => void;
  className?: string;
};

export function NavbarUserControl({
  canManageContact,
  canManagePaymentsConnect,
  onPrefetchContactPhone,
  className,
}: NavbarUserControlProps) {
  const { isLoaded } = useUser();
  const [mounted, setMounted] = useState(false);
  const [showUserButton, setShowUserButton] = useState(false);

  useEffect(() => {
    const run = () => setMounted(true);
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }, []);

  useEffect(() => {
    if (!mounted || !isLoaded) {
      let cancelled = false;
      const run = () => {
        if (cancelled) return;
        setShowUserButton(false);
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else Promise.resolve().then(run);
      return () => {
        cancelled = true;
      };
    }

    const frame = requestAnimationFrame(() => {
      setShowUserButton(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [mounted, isLoaded]);

  const shouldMountUserLayer = mounted && isLoaded;

  const renderUserButton = () => {
    if (canManageContact) {
      return (
        <UserButton>
          <UserButton.MenuItems>
            <UserButton.Action label="Contact" labelIcon={<Phone size={16} />} open="contact" />
            {canManagePaymentsConnect && (
              <UserButton.Action
                label="Payments"
                labelIcon={<CreditCard size={16} />}
                open="payments-connect"
              />
            )}
          </UserButton.MenuItems>
          <UserButton.UserProfilePage label="Contact" url="contact" labelIcon={<Phone size={16} />}>
            <ContactInfoPanel />
          </UserButton.UserProfilePage>
          {canManagePaymentsConnect && (
            <UserButton.UserProfilePage
              label="Payments"
              url="payments-connect"
              labelIcon={<CreditCard size={16} />}
            >
              <PaymentsConnectPanel />
            </UserButton.UserProfilePage>
          )}
        </UserButton>
      );
    }

    return <UserButton />;
  };

  return (
    <div
      className={cn('flex items-center', className)}
      onPointerEnter={onPrefetchContactPhone}
      onFocus={onPrefetchContactPhone}
      onPointerDown={onPrefetchContactPhone}
    >
      <div className="relative h-7 w-7">
        <div
          className={cn(
            'absolute inset-0 rounded-full bg-white/20 animate-pulse transition-opacity duration-400 ease-out',
            showUserButton ? 'opacity-0 pointer-events-none' : 'opacity-100'
          )}
        />

        <div
          className={cn(
            'absolute inset-0 transition-[opacity,transform] duration-400 ease-in',
            shouldMountUserLayer
              ? showUserButton
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-95 pointer-events-none'
              : 'opacity-0 scale-95 pointer-events-none'
          )}
        >
          {shouldMountUserLayer ? renderUserButton() : null}
        </div>
      </div>
    </div>
  );
}
