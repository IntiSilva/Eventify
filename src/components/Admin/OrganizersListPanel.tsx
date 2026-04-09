'use client';

import { Search, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  AdminOrganizerSummary,
  OrganizerRoleFilter,
  OrganizerSortOption,
} from './types';

type OrganizersListPanelProps = {
  organizers: AdminOrganizerSummary[];
  selectedId: string | null;
  searchValue: string;
  roleFilter: OrganizerRoleFilter;
  sortBy: OrganizerSortOption;
  currentUserId: string | null;
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: OrganizerRoleFilter) => void;
  onSortChange: (value: OrganizerSortOption) => void;
  onSelectOrganizer: (clerkId: string) => void;
};

const ROLE_FILTER_OPTIONS: Array<{ value: OrganizerRoleFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'organizer', label: 'Organizers' },
  { value: 'admin', label: 'Admins' },
];

const ROLE_FILTER_ACTIVE_CLASS: Record<OrganizerRoleFilter, string> = {
  all: 'border-cyan-700 bg-cyan-950/40 text-cyan-100 hover:bg-cyan-950/55 hover:text-cyan-100',
  organizer: 'border-emerald-700 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-950/55 hover:text-emerald-100',
  admin: 'border-rose-700 bg-rose-950/40 text-rose-100 hover:bg-rose-950/55 hover:text-rose-100',
};

const SORT_OPTIONS: Array<{ value: OrganizerSortOption; label: string }> = [
  { value: 'you-first', label: 'You first' },
  { value: 'events-desc', label: 'Most events' },
  { value: 'az', label: 'A-Z' },
];

function getOrganizerDisplayName(organizer: AdminOrganizerSummary) {
  const fullName = [organizer.firstName, organizer.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return fullName.length > 0 ? fullName : organizer.username;
}

export default function OrganizersListPanel({
  organizers,
  selectedId,
  searchValue,
  roleFilter,
  sortBy,
  currentUserId,
  onSearchChange,
  onRoleFilterChange,
  onSortChange,
  onSelectOrganizer,
}: OrganizersListPanelProps) {
  const headerTitle =
    roleFilter === 'all'
      ? 'All users'
      : roleFilter === 'admin'
        ? 'Admins'
        : 'Organizers';

  return (
    <section className="rounded-xl border border-zinc-800 bg-black/60 flex flex-col">
      <div className="border-b border-zinc-800 px-4 py-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">{headerTitle}</h2>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
            {organizers.length}
          </span>
        </div>

        <div className="mt-3 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search users..."
              className="h-9 border-zinc-800 bg-zinc-950 pl-8 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {ROLE_FILTER_OPTIONS.map((option) => {
              const isActive = roleFilter === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onRoleFilterChange(option.value)}
                  className={cn(
                    'h-7 border px-2.5 text-xs transition-colors',
                    isActive
                      ? ROLE_FILTER_ACTIVE_CLASS[option.value]
                      : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900 hover:text-zinc-100'
                  )}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Sort</span>
            <Select value={sortBy} onValueChange={(value) => onSortChange(value as OrganizerSortOption)}>
              <SelectTrigger className="h-8 w-[150px] border-zinc-700 bg-zinc-950 text-xs text-zinc-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-950 text-zinc-100">
                {SORT_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="cursor-pointer text-xs"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="max-h-[60dvh] xs4:max-h-[68dvh] md:max-h-[68dvh] overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-900 [&::-webkit-scrollbar-thumb:hover]:bg-emerald-600">
        {organizers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 px-3 py-5 text-center text-xs text-zinc-400">
            No users match the current filters.
          </div>
        ) : (
          organizers.map((organizer) => {
            const isSelected = organizer.clerkId === selectedId;
            const isYou = currentUserId === organizer.clerkId;
            const roleLabel = isYou
              ? 'You'
              : organizer.role === 'admin'
                ? 'Admin'
                : 'Organizer';

            return (
              <button
                key={organizer.clerkId}
                type="button"
                onClick={() => onSelectOrganizer(organizer.clerkId)}
                className={cn(
                  'mb-2 flex w-full items-start justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
                  isSelected
                    ? 'border-emerald-700 bg-emerald-950/35'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900/60'
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{organizer.username}</p>
                  <p className="truncate text-xs text-zinc-400">{getOrganizerDisplayName(organizer)}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300">
                      {roleLabel}
                    </span>
                  </div>
                </div>

                <div className="ml-3 shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-white">
                    {organizer._count.createdEvents}
                  </p>
                  <p className="text-[10px] text-zinc-500">events</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
