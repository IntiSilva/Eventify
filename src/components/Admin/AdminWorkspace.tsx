'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import UsersEventsPanel from './UsersEventsPanel';
import SelectedUserWorkspaceStats from './SelectedUserWorkspaceStats';
import type { AdminOrganizerSummary } from './types';
import {
  isApiErrorResponse,
  type AdminSelectedUserWorkspaceStatsResponse,
} from '@/types/api';

type SelectedUserWorkspaceStatsData = Extract<
  AdminSelectedUserWorkspaceStatsResponse,
  { success: true }
>['data'];

type AdminWorkspaceProps = {
  organizer: AdminOrganizerSummary;
  currentUserId: string | null;
  authReady: boolean;
  onBack?: () => void;
};

function getRoleLabel(organizer: AdminOrganizerSummary, currentUserId: string | null) {
  if (currentUserId === organizer.clerkId) return 'You';
  return organizer.role === 'admin' ? 'Admin' : 'Organizer';
}

function getRoleBadgeClassName(
  organizer: AdminOrganizerSummary,
  currentUserId: string | null
): string {
  if (currentUserId === organizer.clerkId) {
    return 'border-indigo-700/60 bg-indigo-950/45 text-indigo-100';
  }
  if (organizer.role === 'admin') {
    return 'border-rose-700/60 bg-rose-950/45 text-rose-100';
  }
  return 'border-emerald-700/60 bg-emerald-950/40 text-emerald-100';
}

function getOrganizerName(organizer: AdminOrganizerSummary) {
  const fullName = [organizer.firstName, organizer.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return fullName.length > 0 ? fullName : organizer.username;
}

function AdminWorkspace({
  organizer,
  currentUserId,
  authReady,
  onBack,
}: AdminWorkspaceProps) {
  const workspaceTopAnchorRef = useRef<HTMLElement | null>(null);
  const statsByUserRef = useRef<Map<string, SelectedUserWorkspaceStatsData>>(new Map());
  const [selectedUserStats, setSelectedUserStats] = useState<SelectedUserWorkspaceStatsData | null>(
    null
  );
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsLoadError, setStatsLoadError] = useState(false);

  const handleRequestScrollToTop = useCallback(() => {
    requestAnimationFrame(() => {
      workspaceTopAnchorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    if (!authReady) return;

    const selectedUserId = organizer.clerkId;
    const cached = statsByUserRef.current.get(selectedUserId);

    if (cached) {
      setSelectedUserStats(cached);
      setStatsLoading(false);
      setStatsLoadError(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setSelectedUserStats(null);
    setStatsLoading(true);
    setStatsLoadError(false);

    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${selectedUserId}/workspace-stats`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        const json = (await res
          .json()
          .catch(() => null)) as AdminSelectedUserWorkspaceStatsResponse | null;

        if (cancelled) return;

        if (!res.ok || !json || isApiErrorResponse(json)) {
          throw new Error(
            isApiErrorResponse(json) ? json.error : `HTTP ${res.status}`
          );
        }

        statsByUserRef.current.set(selectedUserId, json.data);
        setSelectedUserStats(json.data);
        setStatsLoadError(false);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error('[AdminWorkspace] Failed to fetch selected-user stats:', error);
        setSelectedUserStats(null);
        setStatsLoadError(true);
      } finally {
        if (!cancelled) {
          setStatsLoading(false);
        }
      }
    })().catch(() => {
      // Prevent uncaught promise errors in development environments
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authReady, organizer.clerkId]);

  return (
    <section
      ref={workspaceTopAnchorRef}
      className="scroll-mt-0 border border-zinc-800 bg-black/50 md:scroll-mt-16 md:rounded-xl md:flex md:flex-col"
    >
      <div className="border-b border-zinc-800 px-4 py-4 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {onBack ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onBack}
                className="mb-2 h-8 px-2 text-zinc-300 hover:bg-white/[0.04] hover:text-white"
              >
                <ArrowLeft className="mr-1 size-4" />
                Organizers
              </Button>
            ) : null}

            <h2 className="truncate text-lg font-semibold text-white md:text-xl">
              {organizer.username}
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-400 md:text-sm">
              {getOrganizerName(organizer)}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <span
              className={cn(
                'inline-flex rounded-full border px-2 py-0.5 text-[11px]',
                getRoleBadgeClassName(organizer, currentUserId)
              )}
            >
              {getRoleLabel(organizer, currentUserId)}
            </span>
            <p className="mt-1 text-xs text-zinc-500">
              {organizer._count.createdEvents} active events
            </p>
          </div>
        </div>
      </div>

      <SelectedUserWorkspaceStats
        stats={selectedUserStats}
        isLoading={statsLoading}
        hasError={statsLoadError}
      />

      <div className="relative">
        <UsersEventsPanel
          key={organizer.clerkId}
          userId={organizer.clerkId}
          authReady={authReady}
          onRequestScrollToTop={handleRequestScrollToTop}
        />
      </div>
    </section>
  );
}

AdminWorkspace.displayName = 'AdminWorkspace';

export default memo(AdminWorkspace);
