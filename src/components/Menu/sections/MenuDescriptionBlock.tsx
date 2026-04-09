import { DialogDescription } from '@/components/ui/dialog';
import { DrawerDescription } from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type MenuDescriptionBlockProps = {
  description?: string | null;
  isDesktop: boolean;
};

export default function MenuDescriptionBlock({ description, isDesktop }: MenuDescriptionBlockProps) {
  if (!description) return null;

  const descriptionProps = {
    className: 'text-xs xs4:text-sm text-zinc-200 font-sans pr-6',
    children: description,
  };

  return (
    <div className="mb-2 md:mb-3">
      <ScrollArea
        className={cn(
          'max-h-24 overflow-y-auto overscroll-contain',
          '[&::-webkit-scrollbar]:w-1',
          '[&::-webkit-scrollbar-track]:bg-transparent',
          '[&::-webkit-scrollbar-thumb]:rounded-full',
          '[&::-webkit-scrollbar-thumb]:bg-emerald-900',
          '[&::-webkit-scrollbar-thumb:hover]:bg-emerald-600',
          '[&::-webkit-scrollbar-thumb:hover]:cursor-pointer'
        )}
      >
        {isDesktop ? (
          <DialogDescription {...descriptionProps} />
        ) : (
          <DrawerDescription {...descriptionProps} />
        )}
      </ScrollArea>
    </div>
  );
}
