'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EventCategory } from '@/generated/prisma';
import { capitalizeFirstLetter, cn } from '@/lib/utils';

const ALL_CATEGORIES_VALUE = '__ALL__';

interface SearchbarCategoryFilterProps {
  isScrolled: boolean;
  isNarrowScreen: boolean;
  isDesktop: boolean;
  onCategoryChange?: (category?: EventCategory) => void;
  selectedCategory?: EventCategory | '';
}

export default function SearchbarCategoryFilter({
  isScrolled,
  isDesktop,
  isNarrowScreen,
  onCategoryChange,
  selectedCategory,
}: SearchbarCategoryFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentCategoryQueryParam = searchParams.get('category') as EventCategory | null;

  // Use the controlled value if provided; otherwise fall back to the URL param
  const selectValue =
    selectedCategory !== undefined
      ? selectedCategory === '' ? ALL_CATEGORIES_VALUE : selectedCategory
      : currentCategoryQueryParam === null
        ? ALL_CATEGORIES_VALUE
        : currentCategoryQueryParam;

  const categoriesSorted = useMemo<EventCategory[]>(() => {
    const arr = Object.values(EventCategory) as EventCategory[];
    return [...arr].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, []);

  const handleCategoryChange = (newSelectedValue: string) => {
    // If parent provides a callback, delegate (centralized flow)
    if (onCategoryChange) {
      onCategoryChange(
        newSelectedValue === ALL_CATEGORIES_VALUE
          ? undefined
          : (newSelectedValue as EventCategory),
      );
      return;
    }

    // Fallback behavior (when used outside of the Searchbar wrapper)
    const newParams = new URLSearchParams(searchParams.toString());
    if (newSelectedValue === ALL_CATEGORIES_VALUE) {
      newParams.delete('category');
    } else {
      newParams.set('category', newSelectedValue);
    }
    router.push(`${pathname}?${newParams.toString()}`);
  };

  return (
    <Select value={selectValue} onValueChange={handleCategoryChange}>
      <SelectTrigger
        data-testid="sb-category"
        className={cn(
          'w-full bg-transparent border-0 text-white',
          'hover:bg-white',
          'rounded-full',
          'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none cursor-pointer',
          'transition-all duration-300',
          // Unified, responsive sizing logic
          isNarrowScreen
            // 1) Narrow screens
            ? (isScrolled ? '!h-7 text-[11px]' : '!h-8 text-[12px]')
            // 2) Non-narrow: check desktop
            : isDesktop
              ? (isScrolled ? 'w-[162px] !h-8 text-xs' : 'w-[180px] !h-9 text-sm')
              // 3) Non-narrow and non-desktop (regular mobile)
              : (isScrolled ? '!h-8 text-xs' : '!h-9 text-sm'),
        )}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent data-testid="sb-category-content" className="bg-black border-zinc-700 text-white">
        <SelectItem
          value={ALL_CATEGORIES_VALUE}
          className="hover:!bg-emerald-700 focus:!bg-emerald-600 cursor-pointer"
        >
          All Categories
        </SelectItem>

        {categoriesSorted.map((categoryEnumValue) => (
          <SelectItem
            key={categoryEnumValue}
            value={categoryEnumValue}
            className="hover:!bg-emerald-700 focus:!bg-emerald-600 cursor-pointer"
          >
            {capitalizeFirstLetter(categoryEnumValue) || categoryEnumValue}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
