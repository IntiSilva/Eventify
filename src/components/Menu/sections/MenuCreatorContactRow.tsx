import Link from 'next/link';
import UserAvatar from '@/components/UserAvatar';
import InToHoverIcon from '@/components/LordIcons/InToHoverIcon';
import {
  MailAnimatedIcon,
  MailAnimatedIconHover,
  WhatsappAnimatedIcon,
  WhatsappAnimatedIconHover,
  TelegramAnimatedIcon,
  TelegramAnimatedIconHover,
} from '@/lib/icons';
import type { EventWithCreatorAndRsvps } from '@/types/event';

type MenuCreatorContactRowProps = {
  creator: EventWithCreatorAndRsvps['creator'];
  contactEmail?: string | null;
  contactPhone?: string | null;
  phoneApps: 'whatsapp' | 'telegram' | 'both';
  phoneDigits: string;
  isOpen: boolean;
  isDesktop: boolean;
  isMailHovered: boolean;
  isWhatsappHovered: boolean;
  isTelegramHovered: boolean;
  onMailHoverChange: (hovered: boolean) => void;
  onWhatsappHoverChange: (hovered: boolean) => void;
  onTelegramHoverChange: (hovered: boolean) => void;
};

export default function MenuCreatorContactRow({
  creator,
  contactEmail,
  contactPhone,
  phoneApps,
  phoneDigits,
  isOpen,
  isDesktop,
  isMailHovered,
  isWhatsappHovered,
  isTelegramHovered,
  onMailHoverChange,
  onWhatsappHoverChange,
  onTelegramHoverChange,
}: MenuCreatorContactRowProps) {
  return (
    <div className="flex justify-between mt-3">
      <div className="flex items-center gap-3 text-zinc-300">
        <div className="shrink-0">
          <UserAvatar
            {...creator}
            className="size-3.5"
            fallbackClassName="text-[7px]"
            iterationCount={2}
            variant="creator"
            borderVariant="animated"
            density="normal"
          />
        </div>
        <span className="flex items-baseline">
          By: <p className="font-display text-xs xs4:text-sm ml-1">{creator.username}</p>
        </span>
      </div>

      {(contactEmail || contactPhone) && (
        <div className="flex items-center gap-3">
          {contactEmail && (
            <Link
              href={`mailto:${contactEmail}`}
              className="p-1 rounded-full bg-transparent border border-transparent hover:border-white transition duration-300 ease-in-out cursor-pointer"
              aria-label="Send an email"
              onMouseEnter={() => onMailHoverChange(true)}
              onMouseLeave={() => onMailHoverChange(false)}
            >
              <InToHoverIcon
                inIcon={MailAnimatedIcon}
                hoverIcon={MailAnimatedIconHover}
                size={28}
                resetTrigger={isOpen}
                isParentHovered={isMailHovered}
                isDesktop={isDesktop}
                className="cursor-pointer"
              />
            </Link>
          )}

          {contactPhone && (phoneApps === 'whatsapp' || phoneApps === 'both') && (
            <Link
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded-full bg-transparent border border-transparent hover:border-white transition duration-300 ease-in-out cursor-pointer"
              aria-label="Contact via WhatsApp"
              onMouseEnter={() => onWhatsappHoverChange(true)}
              onMouseLeave={() => onWhatsappHoverChange(false)}
            >
              <InToHoverIcon
                inIcon={WhatsappAnimatedIcon}
                hoverIcon={WhatsappAnimatedIconHover}
                size={28}
                resetTrigger={isOpen}
                isParentHovered={isWhatsappHovered}
                isDesktop={isDesktop}
                className="cursor-pointer"
              />
            </Link>
          )}

          {contactPhone && (phoneApps === 'telegram' || phoneApps === 'both') && (
            <Link
              href={`https://t.me/+${phoneDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-0.5 mt-[2px] rounded-full bg-transparent border border-transparent hover:border-white transition duration-300 ease-in-out cursor-pointer"
              aria-label="Contact via Telegram"
              onMouseEnter={() => onTelegramHoverChange(true)}
              onMouseLeave={() => onTelegramHoverChange(false)}
            >
              <InToHoverIcon
                inIcon={TelegramAnimatedIcon}
                hoverIcon={TelegramAnimatedIconHover}
                size={31}
                resetTrigger={isOpen}
                isParentHovered={isTelegramHovered}
                isDesktop={isDesktop}
                className="cursor-pointer"
              />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
