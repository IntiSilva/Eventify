'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS } from 'date-fns/locale';
import AnimatedColorableText, { ColorableToken } from './AnimatedColorableText';

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
}: SearchResultsTitleProps) {
  const base = compact ? 'text-lg font-semibold' : 'text-3xl font-bold';


  const tokens = useMemo<ColorableToken[]>(() => {
    const out: ColorableToken[] = [];

    const _hasAny = !!(searchTerm || category || location || creator || date);
    if (!_hasAny) return out;

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
  }, [searchTerm, category, location, creator, date, creatorLabel]);

  if (tokens.length === 0) return null;

  return (
    <AnimatedColorableText
      tokens={tokens}
      as={as}
      containerClassName={cn('text-left', className)}
      headingClassName={cn(base, 'text-white font-display tracking-tight')}
      wordClassName="inline-block opacity-0"
      accentClassName="text-emerald-400"
      splitMode='char'
    />
  );
}
