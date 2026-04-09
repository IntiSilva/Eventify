import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EventWithCreatorAndRsvps } from '@/types/event';
import MenuArchiveEventButton from '../MenuArchiveEventButton';
import InToHoverIcon from '../../LordIcons/InToHoverIcon';
import {
  BellAnimatedIcon,
  BellAnimatedIconHover,
  CheckAnimatedIcon,
  CheckAnimatedIconHover,
} from '@/lib/icons';

type MenuFooterActionsRightProps = {
  isCurrentUserAttending: boolean;
  currentUserRsvp?: EventWithCreatorAndRsvps['rsvps'][number];
  showReminderConfigToast: () => void;
  isReminderBtnHovered: boolean;
  isChangeReminderHovered: boolean;
  onReminderBtnHoverChange: (hovered: boolean) => void;
  onChangeReminderHoverChange: (hovered: boolean) => void;
  isOpen: boolean;
  isDesktop: boolean;
  canManage: boolean;
  onEdit: () => void;
  eventId: string;
  onEventArchived: (id: string) => void;
};

export default function MenuFooterActionsRight({
  isCurrentUserAttending,
  currentUserRsvp,
  showReminderConfigToast,
  isReminderBtnHovered,
  isChangeReminderHovered,
  onReminderBtnHoverChange,
  onChangeReminderHoverChange,
  isOpen,
  isDesktop,
  canManage,
  onEdit,
  eventId,
  onEventArchived,
}: MenuFooterActionsRightProps) {
  return (
    <div className="flex items-center gap-2">
      {isCurrentUserAttending && !currentUserRsvp?.reminderScheduledAt && (
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-1.5 px-2.5 border-emerald-700 text-emerald-400 bg-emerald-950/50 hover:bg-emerald-900 hover:text-emerald-300 transition-colors duration-200 cursor-pointer"
          onClick={showReminderConfigToast}
          onMouseEnter={() => onReminderBtnHoverChange(true)}
          onMouseLeave={() => onReminderBtnHoverChange(false)}
        >
          <InToHoverIcon
            inIcon={BellAnimatedIcon}
            hoverIcon={BellAnimatedIconHover}
            size={20}
            resetTrigger={isOpen}
            isParentHovered={isReminderBtnHovered}
            isDesktop={isDesktop}
            className="cursor-pointer"
          />
          Set Reminder
        </Button>
      )}

      {isCurrentUserAttending && currentUserRsvp?.reminderScheduledAt && (
        <div className="inline-flex h-8 md:h-9 items-center gap-2 text-xs text-zinc-300 px-3 bg-black/50 rounded-md leading-none">
          <InToHoverIcon
            size={16}
            inIcon={CheckAnimatedIcon}
            hoverIcon={CheckAnimatedIconHover}
            isDesktop={isDesktop}
            resetTrigger={isOpen}
            isParentHovered={isChangeReminderHovered}
          />
          <span className="mt-px">Reminder active</span>
          <button
            onClick={showReminderConfigToast}
            className="font-semibold text-emerald-500 hover:underline text-[11px] cursor-pointer"
            onMouseEnter={() => onChangeReminderHoverChange(true)}
            onMouseLeave={() => onChangeReminderHoverChange(false)}
          >
            (change)
          </button>
        </div>
      )}

      {canManage && (
        <div className="flex gap-2">
          <Button
            onClick={onEdit}
            variant="secondary"
            size="sm"
            className={cn(
              'cursor-pointer',
              'border border-white/16 bg-white/[0.025] text-zinc-100',
              'hover:bg-white/[0.10] hover:border-white/24 hover:text-white',
              'focus-visible:ring-0 focus-visible:outline-none active:scale-95',
              'transition-[background,border-color,color] duration-200 ease-out'
            )}
          >
            Edit
          </Button>
          <MenuArchiveEventButton eventId={eventId} onEventArchived={onEventArchived} />
        </div>
      )}
    </div>
  );
}
