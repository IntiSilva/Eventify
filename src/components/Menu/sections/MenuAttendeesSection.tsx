import { AttendeesLegendTooltip } from '@/components/InfoTooltip';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import { ChevronDown, ChevronUp } from 'lucide-react';
import AvatarStack from '@/components/AvatarStack';
import UserAvatar from '@/components/UserAvatar';

type AttendeeRsvp = EventWithCreatorAndRsvps['rsvps'][number];

type MenuAttendeesSectionProps = {
  confirmedAttendees: AttendeeRsvp[];
  rsvpsAll: AttendeeRsvp[];
  isAttendeeListOpen: boolean;
  onAttendeeListOpenChange: (open: boolean) => void;
  mode: 'editable' | 'non-editable';
};

export default function MenuAttendeesSection({
  confirmedAttendees,
  rsvpsAll,
  isAttendeeListOpen,
  onAttendeeListOpenChange,
  mode,
}: MenuAttendeesSectionProps) {
  return (
    <div className="mt-2 xs4:mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p
            data-testid="attendees-count"
            className="text-base xs4:text-md font-semibold font-heading text-zinc-200"
          >
            Attendees ({confirmedAttendees.length})
          </p>
          <AttendeesLegendTooltip
            side="top"
            align="start"
            triggerMode="both"
            size="sm"
            ariaLabel="Attendees legend"
            className="mt-1"
          />
        </div>
        {confirmedAttendees.length > 0 && (
          <AvatarStack rsvps={rsvpsAll} maxVisible={3} avatarSizeClassName="size-8" />
        )}
      </div>

      {confirmedAttendees.length > 0 ? (
        <Collapsible open={isAttendeeListOpen} onOpenChange={onAttendeeListOpenChange}>
          <CollapsibleTrigger asChild>
            <Button
              variant="link"
              className="text-xs xs4:text-sm text-emerald-500 hover:text-emerald-400 p-0 h-auto font-semibold cursor-pointer"
            >
              {isAttendeeListOpen ? 'Hide list' : `See all ${confirmedAttendees.length} attendees`}
              {isAttendeeListOpen ? (
                <ChevronUp className="size-4 ml-1" />
              ) : (
                <ChevronDown className="size-4 ml-1" />
              )}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="pt-1.5 md:pt-2">
              <ScrollArea
                data-allow-scroll
                className={cn(
                  'relative overflow-y-auto overscroll-y-contain pr-3',
                  'max-h-24 xs4:max-h-40',
                  '[@media(max-width:409px)_and_(max-height:690px)]:max-h-10',
                  '[@media(min-width:410px)_and_(max-height:790px)]:max-h-24',
                  '[&::-webkit-scrollbar]:w-1',
                  '[&::-webkit-scrollbar-track]:bg-transparent',
                  '[&::-webkit-scrollbar-thumb]:rounded-full',
                  '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
                  '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600',
                  '[&::-webkit-scrollbar-thumb:hover]:cursor-pointer'
                )}
              >
                <ul className="space-y-2">
                  {confirmedAttendees.map((rsvp) => (
                    <li
                      key={rsvp.user.clerkId}
                      className="flex items-center space-x-3 p-1.5 rounded-md hover:bg-zinc-900 transition-colors"
                    >
                      <UserAvatar
                        {...rsvp.user}
                        className="size-8"
                        variant="attendee"
                        borderVariant="static"
                        density="compact"
                      />
                      <span className="text-sm text-zinc-200 font-sans">{rsvp.user.username}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        mode === 'non-editable' && (
          <p className="text-sm text-zinc-500 italic mt-1 font-sans">Be the first to attend!</p>
        )
      )}
    </div>
  );
}
