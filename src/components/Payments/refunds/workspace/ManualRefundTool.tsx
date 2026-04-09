"use client"

import { useState } from "react"
import { ChevronDown, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface ManualRefundToolProps {
  onSubmit: (paymentId: string, note?: string | null) => Promise<boolean>
  isPending?: boolean
}

export function ManualRefundTool({
  onSubmit,
  isPending = false,
}: ManualRefundToolProps) {
  const [open, setOpen] = useState(false)
  const [paymentId, setPaymentId] = useState("")
  const [note, setNote] = useState("")

  const handleSubmit = async () => {
    const normalizedPaymentId = paymentId.trim()
    if (!normalizedPaymentId) return

    const didSucceed = await onSubmit(
      normalizedPaymentId,
      note.trim().length > 0 ? note.trim() : null
    )

    if (!didSucceed) return

    setPaymentId("")
    setNote("")
    setOpen(false)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-white/10 bg-white/[0.02]">
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 cursor-pointer">
          <div className="flex items-center gap-2">
            <Wrench className="size-3.5 text-zinc-400" />
            <span className="text-xs font-medium text-zinc-300">
              Advanced
            </span>
            <span className="hidden text-[10px] text-zinc-500 sm:inline">
              Manual Refund Tool
            </span>
          </div>
          <ChevronDown
            className={cn(
              "size-3.5 text-zinc-400 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator className="bg-white/10" />
          <div className="px-4 py-4">
            <p className="mb-4 text-xs leading-relaxed text-zinc-400">
              Issue a manual refund directly by Payment ID. This bypasses the
              request workflow and should be used only when needed.
            </p>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="manual-payment-id"
                  className="text-xs text-zinc-400"
                >
                  Payment ID
                </label>
                <Input
                  id="manual-payment-id"
                  value={paymentId}
                  onChange={(event) => setPaymentId(event.target.value)}
                  placeholder="pay_..."
                  className="h-8 border-zinc-800 bg-black/30 text-xs font-mono text-zinc-100 placeholder:text-zinc-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="manual-reason"
                  className="text-xs text-zinc-400"
                >
                  Note (optional)
                </label>
                <Textarea
                  id="manual-reason"
                  value={note}
                  onChange={(event) => setNote(event.target.value.slice(0, 500))}
                  maxLength={500}
                  placeholder="Internal note..."
                  className="min-h-20 border-zinc-800 bg-black/30 text-xs text-zinc-100 placeholder:text-zinc-500"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-zinc-500">{note.length}/500</span>
                <Button
                  size="sm"
                  type="button"
                  onClick={handleSubmit}
                  disabled={isPending || paymentId.trim().length === 0}
                  className="bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  {isPending ? "Issuing..." : "Issue Manual Refund"}
                </Button>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
