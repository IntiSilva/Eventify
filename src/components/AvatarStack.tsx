import type { ComponentProps } from 'react';
import UserAvatar from './UserAvatar';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import { RSVPStatus } from '@/generated/prisma';
import { cn } from '@/lib/utils';

interface AvatarStackProps {
  rsvps: EventWithCreatorAndRsvps['rsvps'];
  maxVisible?: number;
  avatarSizeClassName?: string;
  avatarBorderClassName?: string;
  plusCounterClassName?: string;
  /**
   * Extra props forwarded to every UserAvatar in the stack.
   * Useful to control things like borderVariant, density, etc. per context.
   */
  userAvatarProps?: Partial<ComponentProps<typeof UserAvatar>>;
}

export default function AvatarStack({
  rsvps,
  maxVisible = 3,
  avatarSizeClassName = 'size-8',
  avatarBorderClassName = 'border-transparent',
  plusCounterClassName,
  userAvatarProps,
}: AvatarStackProps) {
  // Filter only confirmed attendees
  const confirmedAttendees = rsvps.filter((rsvp) => rsvp.status === RSVPStatus.confirmed);

  // If there are no confirmed attendees, render nothing (or you could show a placeholder)
  if (!confirmedAttendees.length) {
    return null;
  }

  const visibleAttendees = confirmedAttendees.slice(0, maxVisible);
  const remainingCount = confirmedAttendees.length - visibleAttendees.length;

  return (
    <div className="flex items-center">
      {visibleAttendees.map((rsvp, index) => (
        <div
          key={rsvp.user.clerkId}
          className={cn(
            "rounded-full",
            avatarBorderClassName,
            // Overlap each avatar slightly with the previous one
            index > 0 && "-ml-2 md:-ml-3",
          )}
          // Higher z-index for avatars closer to the end of the array
          style={{ zIndex: visibleAttendees.length - index }}
        >
          <UserAvatar
            // Base user data from the RSVP user object
            {...rsvp.user}
            // Allow parent to override / extend avatar behavior & styling
            {...userAvatarProps}
            // Merge size + base background + any custom className from userAvatarProps
            className={cn(
              avatarSizeClassName,
              "bg-black",
              userAvatarProps?.className,
            )}
            // Ensure the fallback text stays sized nicely by default
            fallbackClassName={cn(
              "text-xs",
              userAvatarProps?.fallbackClassName,
            )}
          />
        </div>
      ))}
      {remainingCount > 0 && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full text-emerald-500 font-semibold',
            avatarSizeClassName,
            avatarBorderClassName,
            '-ml-1 md:-ml-2', // Overlap with the previous avatar
            'text-xs',
            'pb-4 md:pb-5',
            plusCounterClassName
          )}
          style={{ zIndex: 100 }} // Ensure the counter stays above visible avatars
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}
