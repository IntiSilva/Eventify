import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import AdminFeaturedBadge from '@/components/Badges/AdminFeaturedBadge';
import AuroraFeaturedBadge from '@/components/Badges/AuroraFeaturedBadge';
import PricingBadge from '@/components/Badges/PricingBadge';
import { cn, type BadgeState } from '@/lib/utils';

type MenuViewHeaderProps = {
  isDesktop: boolean;
  title: string;
  isPaid: boolean;
  eventStart: string | Date;
  isEventArchived: boolean;
  badgeState: BadgeState;
};

export default function MenuViewHeader({
  isDesktop,
  title,
  isPaid,
  eventStart,
  isEventArchived,
  badgeState,
}: MenuViewHeaderProps) {
  const isAdminBadge = badgeState === 'admin' || badgeState === 'both';
  const isAuroraBadge = badgeState === 'featured' || badgeState === 'both';

  if (isDesktop) {
    return (
      <DialogHeader
        className={cn(
          'px-6 pt-7 pb-4 relative shrink-0 text-left border-b border-zinc-800',
          badgeState !== 'none' ? 'pb-8.5' : ''
        )}
      >
        <div className="absolute top-1 left-1 z-10 pointer-events-none flex flex-col items-start gap-1">
          <PricingBadge variant="menu" isPaid={isPaid} eventStart={eventStart} />
          {isEventArchived && (
            <span className="inline-flex rounded-full border border-zinc-600/70 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200">
              Archived
            </span>
          )}
        </div>

        {badgeState !== 'none' && (
          <div
            className={cn('absolute z-10 flex bottom-1 right-1.5', {
              ' flex gap-x-1.5 items-end': badgeState === 'both',
            })}
          >
            {isAdminBadge && <AdminFeaturedBadge />}
            {isAuroraBadge && <AuroraFeaturedBadge />}
          </div>
        )}
        <DialogTitle className="text-3xl font-semibold font-heading bg-gradient-to-br from-emerald-400 to-cyan-400 text-transparent bg-clip-text text-shadow-sm text-shadow-emerald-900/50">
          {title}
        </DialogTitle>
      </DialogHeader>
    );
  }

  return (
    <DrawerHeader className="p-6 pb-4 shrink-0 text-left border-b border-zinc-800">
      <div className="absolute -top-4 left-2 z-10 pointer-events-none flex flex-col items-start gap-1">
        <PricingBadge variant="menu" isPaid={isPaid} eventStart={eventStart} />
        {isEventArchived && (
          <span className="inline-flex rounded-full border border-zinc-600/70 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200">
            Archived
          </span>
        )}
      </div>

      {badgeState !== 'none' && (
        <div
          className={cn('absolute z-10 flex', {
            '-top-4 right-1.5 flex-col gap-y-1.5 items-end': badgeState === 'both',
            '-top-4 right-1.5': badgeState === 'featured' || badgeState === 'admin',
          })}
        >
          {isAdminBadge && <AdminFeaturedBadge />}
          {isAuroraBadge && <AuroraFeaturedBadge />}
        </div>
      )}
      <DrawerTitle className="text-2xl xs4:text-3xl font-semibold font-heading bg-gradient-to-br from-emerald-400 to-cyan-400 text-transparent bg-clip-text text-shadow-sm text-shadow-emerald-900/50">
        {title}
      </DrawerTitle>
    </DrawerHeader>
  );
}
