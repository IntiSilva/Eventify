import type { RolesForEvents } from '@/types/event';

export type AdminOrganizerSummary = {
  clerkId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  hasImage: boolean | null;
  role: RolesForEvents;
  _count: { createdEvents: number };
};

export type OrganizerRoleFilter = 'all' | 'admin' | 'organizer';
export type OrganizerSortOption = 'you-first' | 'events-desc' | 'az';
