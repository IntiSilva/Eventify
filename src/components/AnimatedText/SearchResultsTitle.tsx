'use client';

import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS } from 'date-fns/locale';
import AnimatedColorableText, { ColorableToken } from './AnimatedColorableText';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import { LoadingDotsAnimatedIcon } from '@/lib/icons';

export interface SearchResultsTitleProps {
  searchTerm?: string | null;
  category?: string | null;
  location?: string | null;
  creator?: string | null;
  date?: string | null;                 // ISO (YYYY-MM-DD)
  creatorLabel?: 'Organized by' | 'Created by' | 'Made by';
  as?: 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
  compact?: boolean;
   /**
   * Parent-driven: true while the results list is still fetching / pending.
   * The busy icon will only show AFTER the title animation is done.
   */
  isBusy?: boolean;
  /** Optional: fired once when the title animation is considered done for the current filters. */
  onTitleAnimationDone?: () => void;
  /** Optional: override busy icon size (px). */
  busyIconSize?: number;
}

function cap(str?: string | null) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function formattedDate(date?: string | null) {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;

  // Anchor at 12:00 UTC so the calendar day is stable no matter the environment TZ
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));

  // ("PPP" with enUS),
  return formatInTimeZone(utcNoon, 'UTC', 'PPP', { locale: enUS });
}


export default function SearchResultsTitle({
  searchTerm,
  category,
  location,
  creator,
  date,
  creatorLabel = 'Organized by',
  as = 'h2',
  className,
  compact = false,
  isBusy = false,
  onTitleAnimationDone,
  busyIconSize
}: SearchResultsTitleProps) {
  const base = compact ? 'text-lg font-semibold' : 'text-3xl font-bold';
  const hasAny = !!(searchTerm || category || location || creator || date);


  const tokens = useMemo<ColorableToken[]>(() => {
    const out: ColorableToken[] = [];

    if (!hasAny) return out;

    const _cat = cap(category);
    const _loc = cap(location);
    const _creator = cap(creator);
    const _date = formattedDate(date);

    if (searchTerm) {
      out.push({ text: 'Results for' });
      out.push({ text: `“${searchTerm}”`, accent: true });
    } else {
      out.push({ text: 'Events' });
    }

    if (_cat) {
      out.push({ text: 'in' });
      out.push({ text: _cat, accent: true });
    }

    if (_loc) {
      out.push({ text: 'in' });
      out.push({ text: _loc, accent: true });
    }

    if (_creator) {
      out.push({ text: creatorLabel });
      out.push({ text: _creator, accent: true });
    }

    if (_date) {
      out.push({ text: 'on' });
      out.push({ text: _date, accent: true });
    }

    return out;
  }, [searchTerm, category, location, creator, date, creatorLabel, hasAny]);

  // Signature to reset "done" when filters change
  const sig = useMemo(() => {
    return [
      searchTerm ?? '',
      category ?? '',
      location ?? '',
      creator ?? '',
      date ?? '',
      creatorLabel,
      compact ? '1' : '0',
    ].join('|');
  }, [searchTerm, category, location, creator, date, creatorLabel, compact]);

  const doneSigRef = useRef<string>('');
  const [doneSig, setDoneSig] = useState<string>('');

   
  const animDone = doneSig === sig;

  const handleAnimationComplete = useCallback(() => {
  // Dedupe in case it arrives twice
  if (doneSigRef.current === sig) return;
  doneSigRef.current = sig;

  setDoneSig(sig);
  onTitleAnimationDone?.();
}, [sig, onTitleAnimationDone]);

 useEffect(() => {
    if (hasAny) return;

    doneSigRef.current = '';

    // Async reset to satisfy react-hooks/set-state-in-effect
    const t = setTimeout(() => {
      setDoneSig('');
    }, 0);

    return () => clearTimeout(t);
  }, [hasAny]);

  const showBusyIcon = hasAny && isBusy && animDone;
  const trailingBusyAddon = showBusyIcon ? ( 
    <>
    <span
    className="
      pointer-events-none
      absolute left-full ml-2
      bottom-0
      translate-y-[0.1em] md:translate-y-[0.2em]
      inline-flex items-end
      leading-none
    "
    role="status"
    aria-live="polite"
  >
    <AnimatedIcon
      icon={LoadingDotsAnimatedIcon}
      state="loop"
      disableInternalHover
      size={busyIconSize ?? 20}
      colors={{primary: "#34d399"}} //Emerald-400
      className="block"
    />
  </span>
    </>
  ): null;


  if (!hasAny) return null;

  return (
    <div className={cn('text-left', className)} key={sig}>
      <div className="relative inline-block">
        <AnimatedColorableText
          tokens={tokens}
          as={as}
          containerClassName="text-left"
          headingClassName={cn(base, 'text-white font-display tracking-tight')}
          wordClassName="inline-block opacity-0"
          accentClassName="text-emerald-400"
          splitMode="char"
          onAnimationComplete={handleAnimationComplete}
          trailingAddon={trailingBusyAddon}

        />
      </div>
    </div>
  );
}
