"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

// 🔧 ANTES: <TooltipProvider> acá adentro (mal)
// AHORA: solo Root
function Tooltip(
  props: React.ComponentProps<typeof TooltipPrimitive.Root>
) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
      className={cn(
        "relative z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance bg-primary text-primary-foreground",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        // saca zoom/slide del padre
        className
      )}
      sideOffset={sideOffset}
      {...props}
    >
      <div className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
        {children}
      </div>
      <TooltipPrimitive.Arrow
        className="absolute size-2.5 -left-1 -bottom-1 rotate-45 rounded-[2px] fill-emerald-700 bg-emerald-700"
      />
    </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
