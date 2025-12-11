'use client';

import { useTransition, useState } from 'react';
import { toast } from 'sonner';
import { deleteEvent } from '@/app/(dashboard)/events/actions';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type Props = {
  eventId: string;
  onEventDeleted?: (id: string) => void;
  confirmLabel?: string;
  title?: string;
  description?: string;
};

export default function DeleteEventButton({
  eventId,
  onEventDeleted,
  confirmLabel = 'Delete',
  title = 'Delete event',
  description = 'This action cannot be undone. This will permanently delete the event.',
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      const loadingId = toast.loading('Deleting event...');
      try {
        const result = await deleteEvent(eventId); // returns DeleteEventResult
        if (result.success) {
          toast.success(result.message ?? 'Event deleted', { id: loadingId });
          setOpen(false);
          onEventDeleted?.(eventId);
        } else {
          toast.error(result.message ?? 'Could not delete event', { id: loadingId });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        toast.error(message, { id: loadingId });
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {/* Trigger ALWAYS red (base) + reinforced on hover/focus */}
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          className={[
            'cursor-pointer transition-colors duration-200 active:scale-95',
            // always visible red base
            'text-white border border-rose-800 bg-rose-950/50',
            // reinforced hover/focus
            'hover:bg-rose-900/60 hover:border-rose-700',
            'focus:bg-rose-900/60 focus:border-rose-700',
          ].join(' ')}
        >
          Delete
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="bg-black border-zinc-700 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-emerald-400">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-500">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mt-4">
          {/* CANCEL = “Edit” menu style (reinforced white) */}
          <AlertDialogCancel
            disabled={isPending}
            className={[
              'cursor-pointer transition-[background,border-color,color] duration-200 ease-out active:scale-95',
              'border border-white/16 bg-white/[0.025] text-zinc-100',
              'hover:bg-white/[0.10] hover:border-white/24 hover:text-white',
              'focus-visible:ring-0 focus-visible:outline-none',
            ].join(' ')}
          >
            Cancel
          </AlertDialogCancel>

          {/* DELETE = same red as the trigger */}
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending}
            className={[
              'cursor-pointer transition-colors duration-200 active:scale-95 disabled:opacity-70',
              'text-white border border-rose-800 bg-rose-950/50',
              'hover:bg-rose-900/60 hover:border-rose-700',
              'focus:bg-rose-900/60 focus:border-rose-700',
            ].join(' ')}
          >
            {isPending ? 'Deleting...' : (confirmLabel ?? 'Delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
