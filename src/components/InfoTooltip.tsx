"use client";

import React, { useState, useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Arrow as PopoverArrow } from "@radix-ui/react-popover";
import { cn, formatTimeZoneLabel } from "@/lib/utils";
import { FEATURED_THRESHOLD } from "@/lib/constants";

/**
 * Reusable info tooltip with a small "i" badge trigger.
 * - Uses shadcn/ui Tooltip (Radix under the hood)
 * - Supports hover, click, or both trigger modes
 * - Dark tooltip surface (bg-black, border-zinc-900)
 */

export type InfoTooltipProps = {
  content: React.ReactNode;
  ariaLabel?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "center" | "start" | "end";
  className?: string;
  size?: "sm" | "md";
  triggerMode?: "hover" | "click" | "both";
  openOnFocus?: boolean;
  maxWidth?: string;
  customTrigger?: React.ReactNode;
};

export default function InfoTooltip({
  content,
  ariaLabel = "Open info",
  side = "top",
  align = "center",
  className,
  size = "sm",
  triggerMode = "both",
  openOnFocus = false, // lo dejamos para compat aunque acá ya no se usa
  maxWidth = "max-w-xs",
  customTrigger,
}: InfoTooltipProps) {
  // Detectar si estamos en dispositivo de pointer "coarse" (mobile, tablets, etc.)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

    // Popover open (mobile / click-only)
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Tooltip open (desktop / hover)
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // Ignoramos el primer intento de abrir (ej: auto-focus del Dialog)
  const justMountedRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");

    const update = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsCoarsePointer(event.matches);
    };

    update(mq);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ventana de 300ms donde ignoramos el primer open automático
  useEffect(() => {
    const t = setTimeout(() => {
      justMountedRef.current = false;
    }, 300);
    return () => clearTimeout(t);
  }, []);

  // En mobile (pointer coarse) o cuando pedís explícitamente triggerMode="click",
  // usamos Popover (click/tap puro, sin hover).
  const isClickOnlyMode = triggerMode === "click";
  const usePopover = isCoarsePointer || isClickOnlyMode;

  // Nodo trigger compartido (lo usamos tanto en Tooltip como en Popover)
  const triggerNode = customTrigger ? (
    <span
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
    >
      {customTrigger}
    </span>
  ) : (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "flex items-center justify-center rounded-full border bg-transparent text-emerald-700",
        "border-zinc-800 shadow-sm transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-0",
        "hover:bg-zinc-900/30 cursor-pointer",
        size === "sm" ? "h-4.5 w-4.5 text-[10px]" : "h-6 w-6 text-xs",
        className
      )}
    >
      <span className="block w-full text-center font-semibold leading-none">i</span>
    </button>
  );

  // --- Variante Popover (mobile + click-only) → tap abre, tap/click cierra, sin parpadeos ---
  if (usePopover) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
        <PopoverContent
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "relative rounded-xl border p-3 text-sm leading-relaxed",
            "bg-black text-zinc-300 border-zinc-900 shadow-2xl",
            "w-auto",
            maxWidth
          )}
        >
        <div className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
          {content}
        </div>

        {/* Rombo usando el Arrow real de Radix, igual que en tooltip.tsx */}
        <PopoverArrow
          className="absolute size-2.5 -left-1 -bottom-1 rotate-45 rounded-[2px] fill-emerald-700 bg-emerald-700"
        />
        </PopoverContent>
      </Popover>
    );
  }

  // --- Variante Tooltip (desktop / hover) → Radix se encarga:
  // hover/focus abre, click en el trigger mientras está abierto lo cierra.
  return (
    <Tooltip
      open={tooltipOpen}
      onOpenChange={(next) => {
        // Si intenta abrirse apenas monta (ej. auto-focus del Dialog)
        // y NO queremos abrir en focus, lo ignoramos.
        if (next && !openOnFocus && justMountedRef.current) {
          return;
        }
        setTooltipOpen(next);
      }}>
      <TooltipTrigger asChild>{triggerNode}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={6}
        className={cn(
          "rounded-xl border p-3 text-sm leading-relaxed",
          "bg-black text-zinc-300 border-zinc-900 shadow-2xl",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "w-auto",
          maxWidth
        )}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}


/* =============================================================================
 * Internal UI components (module scope)
 * ============================================================================= */
function SpinBadge({ gradientClass }: { gradientClass: string }) {
  // 6 rotations in 60s → 10s per rotation
  const TOTAL_SPIN_SECONDS = 60;
  const ROTATIONS = 6;
  const perRotation = `${TOTAL_SPIN_SECONDS / ROTATIONS}s`;

  const styles = {
    "--duration-border-spin": perRotation,
    "--iteration-border-spin": ROTATIONS,
    animationTimingFunction: "linear",
    animationFillMode: "forwards",
  } as React.CSSProperties;

  return (
    <div className="relative h-4 w-4 rounded-full p-[1.2px] overflow-hidden">
      <span
        className={cn("absolute inset-[-1000%] rounded-full animate-border-spin", gradientClass)}
        style={styles}
      />
      <span className="relative block h-full w-full rounded-full bg-black" />
    </div>
  );
}

function Row({ label, gradientClass }: { label: string; gradientClass: string }) {
  return (
    <div className="flex items-center gap-2">
      <SpinBadge gradientClass={gradientClass} />
      <span className="text-xs font-sans">{label}</span>
    </div>
  );
}

/* =============================================================================
 * Preconfigured variants for quick use across your app
 * ============================================================================= */

export function TimezoneInfoTooltip(
  props: Omit<InfoTooltipProps, "content"> & {
    where?: "creator-form" | "menu-badge" | "menu-editable";
    eventTzDisplay?: string;
    viewerTz?: string;
  }
) {
  const { eventTzDisplay, viewerTz } = props;

 const textByWhere: Record<NonNullable<typeof props.where>, React.ReactNode> = {
  "creator-form": (
    <div className="space-y-1.5">
      <p>
        <span className="underline underline-offset-1">Tip:</span> If your event is in another
        country, <span className="italic text-rose-500">pick that country&apos;s time zone</span>. If
        it&apos;s local, just use <span className="italic text-emerald-500">Auto</span>.
      </p>
      <p className="text-zinc-500">
        This way, times won&apos;t break if you travel or change zones.
      </p>
    </div>
  ),
  "menu-badge": (
    <div className="space-y-1.5">
      <p>
        You&apos;re viewing an event outside of your time zone
        <span className="text-rose-500">
          {eventTzDisplay ? <> ({eventTzDisplay})</> : null}
        </span>
        . The badge{" "}
        <span className="text-emerald-500">“View in event&apos;s timezone”</span> lets you switch
        between your local time and the event&apos;s time.
      </p>
      <p className="text-zinc-500">
        This doesn&apos;t change the actual event date—it only changes how it&apos;s displayed.
      </p>
    </div>
  ),
  "menu-editable": (
    <div className="space-y-1.5">
      <p>
        You&apos;re viewing an event outside of your time zone
        <span className="text-rose-500">
          {eventTzDisplay ? <> ({eventTzDisplay})</> : null}
        </span>
      </p>
      <p className="text-zinc-500">
        Your time zone:{" "}
        <span className="text-emerald-500">{formatTimeZoneLabel(viewerTz!)}</span>
      </p>
    </div>
  ),
};


  return <InfoTooltip content={textByWhere[props.where ?? "creator-form"]} {...props} />;
}

export function AttendeesLegendTooltip(props: Omit<InfoTooltipProps, "content">) {
  // Fixed gradients (Tailwind JIT-friendly). Increased from ~25% to ~38% for stronger color.
  const GR_USER =
    "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#ffffff_38%,transparent_62%)]";
  const GR_ORGANIZER =
    "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#059669_38%,transparent_62%)]";
  const GR_ADMIN =
    "bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#e11d48_38%,transparent_62%)]";

  const ROLES = [
    { label: "User",       gradientClass: GR_USER },
    { label: "Organizer",  gradientClass: GR_ORGANIZER },
    { label: "Admin",      gradientClass: GR_ADMIN },
  ] as const;

  return (
      <InfoTooltip
        maxWidth="max-w-xs"
        content={
          <div className="flex flex-col gap-2 py-0.5">
            {ROLES.map((r) => (
              <Row key={r.label} label={r.label} gradientClass={r.gradientClass} />
            ))}
          </div>
        }
        {...props}
      />
    );
}

// -----------------------------------------------------------------------------
// FeaturedThresholdTooltip
// -----------------------------------------------------------------------------
export function FeaturedThresholdTooltip(props: Omit<InfoTooltipProps, "content">) {
  return (
    <InfoTooltip
      ariaLabel="How events become Featured"
      side="top"
      align="start"
      maxWidth="max-w-sm"
      content={
        <div className="space-y-1.5">
          <p>
            Events with at least{" "}
            <span className="text-emerald-500 font-semibold">{FEATURED_THRESHOLD}</span>{" "}
            attendees become featured.
          </p>
          <p className="text-zinc-500 text-xs">
            This number may go up as time goes by.
          </p>
        </div>
      }
      {...props}
    />
  );
}