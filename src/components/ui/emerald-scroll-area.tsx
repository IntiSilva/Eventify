"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const EmeraldScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    // MODIFICATION: Base styles are now part of the component definition.
    // Black background, zinc border, and rounded corners.
    className={cn(
      "relative overflow-hidden rounded-md border border-zinc-700 bg-black",
      className
    )}
    {...props}
  >
    {/* MODIFICATION: Added padding directly to the viewport for better content spacing. */}
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit] p-3">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
EmeraldScrollArea.displayName = "EmeraldScrollArea"

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      // Thinner scrollbar with transparent track
      orientation === "vertical" && "h-full w-1.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" && "h-1.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    {/* Emerald-900 thumb */}
    <ScrollAreaPrimitive.ScrollAreaThumb
      className="relative flex-1 rounded-full bg-emerald-900" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { EmeraldScrollArea, ScrollBar }