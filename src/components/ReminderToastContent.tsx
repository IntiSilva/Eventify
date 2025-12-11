"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { patchReminderEverywhere } from "@/lib/mutateHelpers";
import type { ReminderType } from "@/generated/prisma";
import type { ReminderPatch } from "@/types/rsvp";
import { updateReminderPreference, type ReminderResult } from "@/app/(dashboard)/rsvp/actions";

import { Button } from "@/components/ui/button";
import { EmeraldScrollArea as ScrollArea } from "@/components/ui/emerald-scroll-area";
import { Clock, X } from "lucide-react";
import Lottie from "lottie-react";
import { LottieDoubleTapAnimatedIcon } from "@/lib/icons";

export const REMINDER_TOAST_ID = "reminder:singleton";

interface ReminderToastContentProps {
  eventId: string;
  eventDate: Date;
  onDismiss: () => void;
  isDesktop: boolean;
  doubleTap?: boolean;
  commitReminder: (eventId: string, userId: string, reminder: ReminderPatch) => void;
}

export default function ReminderToastContent({
  eventId,
  eventDate,
  onDismiss,
  isDesktop,
  doubleTap = false,
  commitReminder,
}: ReminderToastContentProps) {
  const [, startTransition] = useTransition();
  const { mutate } = useSWRConfig();

  /* ------------------------------------------------------------------ */
  /*  Local saving guard (anti-spam)                                    */
  /* ------------------------------------------------------------------ */
  const [isSaving, setIsSaving] = useState(false);

  /** Reapply toast positioning just in case */
  const toastOptions = {
    position: isDesktop ? "bottom-right" : "top-center",
  } as const;

  /* ------------------------------------------------------------------ */
  /*  Handle create / update / clear reminder                           */
  /* ------------------------------------------------------------------ */
  const handleSetReminder = (
    details: { preferenceType: ReminderType; offsetMinutes: number } | null
  ) => {
    if (isSaving) return; // Prevents double-clicks or continuous presses
    setIsSaving(true);

    // 1) Create the base promise
    const op = updateReminderPreference(eventId, details);

    // 2) Pass the promise to toast.promise
    startTransition(() => {
      toast.promise(op, {
        loading: "Saving preference…",
        success: (data: ReminderResult) => {
          /* ---------- Guard clause ---------- */
          if (!data.success) {
            onDismiss();
            return data.message;
          }

          const updated = data.updatedRsvp; // ReminderPatch 

          /* Broadcast the update to all visible lists */
          patchReminderEverywhere(mutate, eventId, updated);

          commitReminder(eventId, updated.userClerkId, updated);

          onDismiss();
          return data.message;
        },
        error: (err) =>
          err instanceof Error ? err.message : "Failed to save preference.",
        ...toastOptions,
      });
    });

    // 3) Release the guard once the promise completes
    op.finally(() => {
      setIsSaving(false);
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Build reminder options (filtered by current time)                 */
  /* ------------------------------------------------------------------ */
  const now = new Date();
  const hoursUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  const reminderOptions = [
    { type: "FORTY_EIGHT_HOURS", offset: 48 * 60, label: "2 days before" },
    { type: "SAME_DAY", offset: 12 * 60, label: "12 hours before" },
    { type: "SAME_DAY", offset: 4 * 60, label: "4 hours before" },
    { type: "MINUTES_BEFORE", offset: 120, label: "2 hours before" },
    { type: "MINUTES_BEFORE", offset: 60, label: "1 hour before" },
    { type: "MINUTES_BEFORE", offset: 30, label: "30 min before" },
    { type: "MINUTES_BEFORE", offset: 15, label: "15 min before" },
  ] as const;

  const availableOptions = reminderOptions.filter(
    (opt) => hoursUntilEvent > opt.offset / 60
  );

  const hasOptions = availableOptions.length > 0;

  /* ------------------------------------------------------------------ */
  /*  UI                                                                */
  /* ------------------------------------------------------------------ */
  return (
    <div
      className="bg-black p-3 rounded-lg shadow-xl text-white mx-auto max-w-3xs md:max-w-full flex flex-col space-y-3 border border-zinc-700 font-sans"
      aria-busy={isSaving}
      data-state={isSaving ? "saving" : "idle"}
    >
      {/* ---------- Header ---------- */}
      <div className="relative flex justify-center items-center mb-2">
        <div className="flex flex-col items-center text-center">
          <p className="font-heading font-semibold text-emerald-500">Set a Reminder</p>

          {doubleTap && (
            <>
              <Lottie
                animationData={LottieDoubleTapAnimatedIcon}
                loop={6}
                autoplay
                style={{ width: 40, height: 40, marginTop: "-2px" }}
              />
              <p className="text-xs text-zinc-400">(Double-tap to interact)</p>
            </>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-0 right-0 text-zinc-500 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* ---------- Options ---------- */}
      {hasOptions ? (
        <ScrollArea data-allow-scroll className="h-32 md:h-48 w-full border-none overscroll-y-contain" style={{WebkitOverflowScrolling: 'touch'}}>
          <div className="flex flex-col space-y-2 pr-2">
            {availableOptions.map((opt) => (
              <Button
                key={opt.label}
                className="w-full flex items-center justify-start gap-3 p-2.5 text-sm bg-black border border-zinc-800 hover:bg-emerald-950/50 hover:border-emerald-800 disabled:opacity-50 disabled:pointer-events-none"
                disabled={isSaving}
                onClick={() =>
                  handleSetReminder({
                    preferenceType: opt.type as ReminderType,
                    offsetMinutes: opt.offset,
                  })
                }
              >
                <Clock size={14} className="text-emerald-700" />
                <span>{opt.label}</span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <p className="text-center text-sm text-zinc-400">
          It&apos;s too close to the event to set a reminder.
        </p>
      )}

      {/* ---------- Clear reminder ---------- */}
      {hasOptions && (
        <button
          className="w-full p-2 rounded-md text-sm font-medium text-rose-500 bg-rose-900/40 hover:bg-rose-900/60 transition-colors duration-200 ease-in cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
          disabled={isSaving}
          onClick={() => handleSetReminder(null)}
        >
          Don&apos;t remind me
        </button>
      )}
    </div>
  );
}
