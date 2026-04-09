'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useMediaQuery } from '@/lib/hooks';
import OrganizersListPanel from './OrganizersListPanel';
import AdminWorkspace from './AdminWorkspace';
import type {
  AdminOrganizerSummary,
  OrganizerRoleFilter,
  OrganizerSortOption,
} from './types';

type AdminManagementShellProps = {
  usersWithEvents: AdminOrganizerSummary[];
  initialViewerClerkId: string | null;
};

function normalizeForSearch(value: string): string {
  return value.trim().toLowerCase();
}

function matchesOrganizerSearch(organizer: AdminOrganizerSummary, searchToken: string): boolean {
  if (searchToken.length === 0) return true;

  const fullName = `${organizer.firstName ?? ''} ${organizer.lastName ?? ''}`.trim();
  const haystack = `${organizer.username} ${fullName}`.toLowerCase();
  return haystack.includes(searchToken);
}

function sortOrganizers(
  organizers: AdminOrganizerSummary[],
  sortBy: OrganizerSortOption,
  currentUserId: string | null
): AdminOrganizerSummary[] {
  const byUsername = (a: AdminOrganizerSummary, b: AdminOrganizerSummary) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });

  return [...organizers].sort((a, b) => {
    if (sortBy === 'events-desc') {
      const byEvents = b._count.createdEvents - a._count.createdEvents;
      if (byEvents !== 0) return byEvents;
      return byUsername(a, b);
    }

    if (sortBy === 'az') {
      return byUsername(a, b);
    }

    // you-first
    if (currentUserId) {
      if (a.clerkId === currentUserId && b.clerkId !== currentUserId) return -1;
      if (b.clerkId === currentUserId && a.clerkId !== currentUserId) return 1;
    }

    const byEvents = b._count.createdEvents - a._count.createdEvents;
    if (byEvents !== 0) return byEvents;
    return byUsername(a, b);
  });
}

export default function AdminManagementShell({
  usersWithEvents,
  initialViewerClerkId,
}: AdminManagementShellProps) {
  const { userId, isLoaded: isClerkLoaded } = useAuth();
  const currentUserId = userId ?? initialViewerClerkId ?? null;
  const authReady = isClerkLoaded && Boolean(currentUserId);

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [searchValue, setSearchValue] = useState('');
  const [roleFilter, setRoleFilter] = useState<OrganizerRoleFilter>('all');
  const [sortBy, setSortBy] = useState<OrganizerSortOption>('you-first');
  const [selectedOrganizerId, setSelectedOrganizerId] = useState<string | null>(null);
  const [mobileWorkspaceOpen, setMobileWorkspaceOpen] = useState(false);

  const scopedOrganizers = useMemo(() => {
    const roleScoped =
      roleFilter === 'all'
        ? usersWithEvents
        : usersWithEvents.filter((organizer) => organizer.role === roleFilter);
    return sortOrganizers(roleScoped, sortBy, currentUserId);
  }, [usersWithEvents, roleFilter, sortBy, currentUserId]);

  const organizers = useMemo(() => {
    const searchToken = normalizeForSearch(searchValue);
    return scopedOrganizers.filter((organizer) =>
      matchesOrganizerSearch(organizer, searchToken)
    );
  }, [scopedOrganizers, searchValue]);

  const organizersById = useMemo(
    () => new Map(usersWithEvents.map((organizer) => [organizer.clerkId, organizer] as const)),
    [usersWithEvents]
  );

  useEffect(() => {
    if (!isClerkLoaded) return;

    const timer = window.setTimeout(() => {
      if (usersWithEvents.length === 0) {
        setSelectedOrganizerId(null);
        setMobileWorkspaceOpen(false);
        return;
      }

      const fallbackId = scopedOrganizers[0]?.clerkId ?? usersWithEvents[0]?.clerkId ?? null;

      setSelectedOrganizerId((previous) => {
        if (previous && organizersById.has(previous)) {
          return previous;
        }

        if (!isDesktop) {
          return null;
        }

        return fallbackId;
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isClerkLoaded, usersWithEvents, scopedOrganizers, organizersById, isDesktop]);

  useEffect(() => {
    if (!isDesktop) return;

    const timer = window.setTimeout(() => {
      setMobileWorkspaceOpen(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isDesktop]);

  const selectedOrganizer = useMemo(() => {
    if (selectedOrganizerId) {
      return organizersById.get(selectedOrganizerId) ?? null;
    }

    if (isDesktop) {
      return scopedOrganizers[0] ?? usersWithEvents[0] ?? null;
    }

    return null;
  }, [selectedOrganizerId, organizersById, isDesktop, scopedOrganizers, usersWithEvents]);

  const handleSelectOrganizer = useCallback((organizerId: string) => {
    setSelectedOrganizerId(organizerId);
    if (!isDesktop) {
      setMobileWorkspaceOpen(true);
    }
  }, [isDesktop]);

  return (
    <>
      <div className="grid gap-4 lg:px-12 md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] md:items-start">
        <div className="min-h-0">
          <OrganizersListPanel
            organizers={organizers}
            selectedId={selectedOrganizer?.clerkId ?? null}
            searchValue={searchValue}
            roleFilter={roleFilter}
            sortBy={sortBy}
            currentUserId={currentUserId}
            onSearchChange={setSearchValue}
            onRoleFilterChange={setRoleFilter}
            onSortChange={setSortBy}
            onSelectOrganizer={handleSelectOrganizer}
          />
        </div>

        <div className="min-h-0">
          {isDesktop ? (
            !authReady ? (
              <section className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-black/30 px-6 text-center text-sm text-zinc-400">
                Preparing admin workspace...
              </section>
            ) : selectedOrganizer ? (
              <AdminWorkspace
                organizer={selectedOrganizer}
                currentUserId={currentUserId}
                authReady={authReady}
              />
            ) : (
              <section className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-black/30 px-6 text-center text-sm text-zinc-400">
                Select an organizer to manage their events.
              </section>
            )
          ) : null}
        </div>
      </div>

      {!isDesktop && authReady && selectedOrganizer ? (
        <Drawer
          open={mobileWorkspaceOpen}
          onOpenChange={setMobileWorkspaceOpen}
          direction="right"
        >
          <DrawerContent className="overflow-hidden border-white/10 bg-zinc-950 p-0 text-white data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-full">
            <div className="sr-only">
              <DrawerTitle>Organizer workspace</DrawerTitle>
              <DrawerDescription>
                Manage organizer events and filters.
              </DrawerDescription>
            </div>

            {mobileWorkspaceOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
                <AdminWorkspace
                  organizer={selectedOrganizer}
                  currentUserId={currentUserId}
                  authReady={authReady}
                  onBack={() => setMobileWorkspaceOpen(false)}
                />
              </div>
            ) : null}
          </DrawerContent>
        </Drawer>
      ) : null}
    </>
  );
}
