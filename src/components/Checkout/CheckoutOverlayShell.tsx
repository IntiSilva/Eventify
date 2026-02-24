'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const CHECKOUT_OPENED_EVENT = 'eventify:checkout-opened';

// Scrollbar styling classes to be applied to scroll containers
const SCROLLBAR_CLASSES = cn(
  '[&::-webkit-scrollbar]:w-1',
  '[&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
  '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600',
  '[&::-webkit-scrollbar-thumb:hover]:cursor-pointer'
);

interface CheckoutOverlayShellProps {
  title: string;
  children: React.ReactNode;
  eventId?: string;
}

export default function CheckoutOverlayShell({ title, children, eventId }: CheckoutOverlayShellProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(true);

  // ✅ 80% al abrir, 100% al subir
  const snapPoints = useMemo<number[]>(() => [0.8, 1], []);
  const [activeSnapPoint, setActiveSnapPoint] = useState<number | null>(0.8);

  const handleSetActiveSnapPoint = (snapPoint: string | number | null) => {
    // vaul permite string|number|null en el type, pero nosotros usamos number
    setActiveSnapPoint(typeof snapPoint === 'number' ? snapPoint : null);
  };
  // Dispatch "overlay mounted" event
  useEffect(() => {
    if (!eventId) return;
    window.dispatchEvent(new CustomEvent(CHECKOUT_OPENED_EVENT, { detail: { eventId } }));
  }, [eventId]);


  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) router.back();
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="p-0 bg-black border border-zinc-800 shadow-2xl max-h-[90vh] overflow-hidden !max-w-none !w-[min(72rem,calc(100vw-2rem))] 2xl:!w-[min(80rem,calc(100vw-4rem))] [&_button]:cursor-pointer [&_button]:text-white">
          <DialogHeader className="p-6 pb-4 shrink-0 border-b border-zinc-800">
            <DialogTitle className="text-lg md:text-2xl 3xl:text-5xl font-semibold text-white">{title}</DialogTitle>
          </DialogHeader>
          <div className={cn('px-6 pb-6 overflow-y-auto max-h-[calc(90vh-84px)]', SCROLLBAR_CLASSES)}>
            {children}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Mobile Drawer with snap points and full-height override
  return (
    <Drawer 
      open={open}
      onOpenChange={handleOpenChange}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={handleSetActiveSnapPoint}
    >
      <DrawerContent 
        className={cn(
          'bg-black border border-zinc-800',
          // Override default bottom drawer constraints to allow full height expansion
          'data-[vaul-drawer-direction=bottom]:mt-0',
          'data-[vaul-drawer-direction=bottom]:max-h-[100dvh]'
        )}
      >
        <DrawerHeader className="p-4 pb-3 shrink-0 border-b border-zinc-800">
          <DrawerTitle className="text-lg md:text-2xl xl:text-3xl 3xl:text-5xl text-center md:text-start font-semibold text-white">{title}</DrawerTitle>
        </DrawerHeader>
        {/* Scrollable body with padding separation from header and custom scrollbar */}
        <div className={cn(
          'flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-6',
          SCROLLBAR_CLASSES
        )}>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}