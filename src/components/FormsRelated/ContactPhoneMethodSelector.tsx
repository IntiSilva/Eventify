"use client";

import React from "react";
import { cn } from "@/lib/utils";
import TriStateCoinIcon from "../LordIcons/TriStateIconCoin";

import {
  WhatsappCoinAnimatedIcon,
  WhatsappCoinAnimatedIconClick,
  WhatsappCoinAnimatedIconLoop,
  TelegramAnimatedIcon,
  TelegramCoinAnimatedIconClick,
  TelegramCoinAnimatedIconLoop,
} from "@/lib/icons";

export type ContactPhoneApps = "whatsapp" | "telegram" | "both";

type Props = {
  value?: ContactPhoneApps;
  onChange: (v: ContactPhoneApps | undefined) => void;
  resetKey?: unknown;
  disabled?: boolean;
  showLabels?: boolean;
  className?: string;
};

function nextValue(wa: boolean, tg: boolean): ContactPhoneApps | undefined {
  if (wa && tg) return "both";
  if (wa) return "whatsapp";
  if (tg) return "telegram";
  return undefined;
}

export default function ContactPhoneMethodSelector({
  value,
  onChange,
  resetKey,
  disabled,
  showLabels = true,
  className,
}: Props) {
  const waOn = value === "whatsapp" || value === "both";
  const tgOn = value === "telegram" || value === "both";

  const toggleWA = (nextSelected: boolean) => onChange(nextValue(nextSelected, tgOn));
  const toggleTG = (nextSelected: boolean) => onChange(nextValue(waOn, nextSelected));

  return (
    <div
      className={cn(
        // Centered and symmetric grid
        "mx-auto grid grid-cols-2 place-items-center gap-8",
        "max-w-[460px]", // cap width so it doesn’t “float” visually
        className
      )}
    >
      {/* WhatsApp */}
      <button
        type="button"
        onClick={() => toggleWA(!waOn)}
        disabled={disabled}
        aria-pressed={waOn}
        className={cn(
          "group relative isolate flex flex-col items-center justify-center gap-1",
          // Homogeneous size for each option
          "w-[180px] min-h-[120px]",
          "rounded-2xl px-4 py-3",
          "transition-opacity duration-200",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          "border-0"
        )}
      >
        {/* White glow (hover when NOT selected) */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 rounded-2xl opacity-0 transition-opacity duration-300",
            !waOn && "group-hover:opacity-100"
          )}
        >
          <div className="absolute inset-0 rounded-2xl blur-xl bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.15)_40%,transparent_70%)]" />
        </div>

        {/* Green glow (selected) */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 rounded-2xl transition-opacity duration-300",
            waOn ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="absolute inset-0 rounded-2xl blur-xl bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.45)_0%,rgba(16,185,129,0.18)_40%,transparent_70%)]" />
        </div>

        {/* Label on top */}
        {showLabels && (
          <span
            className={cn(
              "relative z-10 text-base font-medium leading-none select-none",
              waOn ? "text-white" : "text-zinc-200"
            )}
            onClick={(e) => {
              e.preventDefault();
              toggleWA(!waOn);
            }}
          >
            WhatsApp
          </span>
        )}

        {/* Icon below, centered */}
        <div className="relative z-10 mt-1">
          <TriStateCoinIcon
            inIcon={WhatsappCoinAnimatedIcon}
            loopIcon={WhatsappCoinAnimatedIconLoop}
            clickIcon={WhatsappCoinAnimatedIconClick}
            selected={waOn}
            size={40}
            resetKey={resetKey}
            ariaLabel="WhatsApp"
            colors={{ primary: "#ffffff" }}
          />
        </div>
      </button>

      {/* Telegram */}
      <button
        type="button"
        onClick={() => toggleTG(!tgOn)}
        disabled={disabled}
        aria-pressed={tgOn}
        className={cn(
          "group relative isolate flex flex-col items-center justify-center gap-1",
          "w-[180px] min-h-[120px]",
          "rounded-2xl px-4 py-3",
          "transition-opacity duration-200",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          "border-0"
        )}
      >
        {/* White glow (hover when NOT selected) */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 rounded-2xl opacity-0 transition-opacity duration-300",
            !tgOn && "group-hover:opacity-100"
          )}
        >
          <div className="absolute inset-0 rounded-2xl blur-xl bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.15)_40%,transparent_70%)]" />
        </div>

        {/* Light-blue glow (selected) */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 rounded-2xl transition-opacity duration-300",
            tgOn ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="absolute inset-0 rounded-2xl blur-xl bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.45)_0%,rgba(56,189,248,0.18)_40%,transparent_70%)]" />
        </div>

        {/* Label on top */}
        {showLabels && (
          <span
            className={cn(
              "relative z-10 text-base font-medium leading-none select-none",
              tgOn ? "text-white" : "text-zinc-200"
            )}
            onClick={(e) => {
              e.preventDefault();
              toggleTG(!tgOn);
            }}
          >
            Telegram
          </span>
        )}

        {/* Icon below, centered */}
        <div className="relative z-10 mt-1">
          <TriStateCoinIcon
            inIcon={TelegramAnimatedIcon}
            loopIcon={TelegramCoinAnimatedIconLoop}
            clickIcon={TelegramCoinAnimatedIconClick}
            selected={tgOn}
            size={40}
            resetKey={resetKey}
            ariaLabel="Telegram"
            colors={{ primary: "#ffffff", secondary: "#0284c7" }}
          />
        </div>
      </button>
    </div>
  );
}
