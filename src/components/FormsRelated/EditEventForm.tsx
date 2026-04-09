'use client';

import { useEffect, useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { editEventSchema, type EditEventValues } from '@/schemas/events';
import {
  updateEvent,
  getEventPricingPreview,
  type EventPricingPreviewData,
} from '@/app/(dashboard)/events/actions';
import type { UpdateEventFormSerialized } from '@/types/eventPayloads';
import { toast } from 'sonner';

import type { EditableEvent, EventWithCreatorAndRsvps } from '@/types/event';
import {
  capitalizeFirstLetter,
  cn,
  pickerDateToUtc,
  utcIsoToWallClockDate,
  tzEqualForInstant,
  canonicalizeTimeZone,
  formatPrice,
} from '@/lib/utils';
import { useViewerTz } from '@/contexts/ViewerTzContext';
import { useMenu } from '@/contexts/MenuContext';
import { applyZodErrorsToForm, toFormError } from "@/lib/formErrors";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CurrencySelect, type Currency } from '@/components/ui/currency-select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateTimePicker } from '../ui/datetime-picker';
import { EventCategory, UserRole } from '@/generated/prisma';
import { PhoneInput } from '@/components/ui/phone-input';
import { isValidPhoneNumber } from 'react-phone-number-input';
import { Checkbox } from '@/components/ui/checkbox';
import { TimeZoneSelector } from './TimeZoneSelector';
import ContactPhoneMethodSelector, { type ContactPhoneApps } from "@/components/FormsRelated/ContactPhoneMethodSelector";
import { CollapseMotion } from "@/components/FormsRelated/CollapseMotion";
import AnimatedCharactersCounter from '../AnimatedText/AnimatedCharactersCounter';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import { FileAnimatedIcon } from '@/lib/icons';
import { PaidEventPricingTooltip } from '@/components/InfoTooltip';
import { Textarea } from '../ui/textarea';
import { Loader2 } from 'lucide-react';
import { startOfDay, addYears } from 'date-fns';
import { NumericFormat } from "react-number-format";
import { isStripeConnectReady } from '@/lib/payments/stripeConnectReadiness';

function formatPriceAmountFromCents(priceCents: number | null, currency: string | null): string {
  if (priceCents == null) return "";
  const code = (currency ?? "").toUpperCase();
  const isZeroDecimal = code === "JPY" || code === "CLP";
  if (isZeroDecimal) return String(priceCents);
  return String(priceCents / 100);
}

function parsePriceAmountToCents(priceAmount: string | undefined, exponent: number): number | null {
  const raw = (priceAmount ?? '').trim()
  const parsed = raw ? Number(raw) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return exponent === 0 ? Math.round(parsed) : Math.round(parsed * 100)
}

function hasOwnerConnectReadinessSnapshot(
  owner: EditableEvent['creator'] | null | undefined
): owner is NonNullable<EditableEvent['creator']> &
  Required<
    Pick<
      NonNullable<EditableEvent['creator']>,
      | 'stripeConnectAccountId'
      | 'stripeConnectPayoutsEnabled'
      | 'stripeConnectChargesEnabled'
      | 'stripeConnectDetailsSubmitted'
    >
  > {
  return (
    Boolean(owner) &&
    typeof owner?.stripeConnectAccountId !== 'undefined' &&
    typeof owner?.stripeConnectPayoutsEnabled === 'boolean' &&
    typeof owner?.stripeConnectChargesEnabled === 'boolean' &&
    typeof owner?.stripeConnectDetailsSubmitted === 'boolean'
  );
}

export default function EditEventForm({
  event,
  onCancel,
  onSuccess,
}: {
  event: EditableEvent;
  onCancel(): void;
  onSuccess(updated?: EventWithCreatorAndRsvps): void;
}) {
  const [isPending, startTransition] = useTransition();
  const { viewerTz } = useViewerTz();
  const { profilePhone } = useMenu(); // may be: undefined (loading) | null (no phone) | string
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const [pricingPreview, setPricingPreview] = useState<EventPricingPreviewData | null>(null);
  const [pricingPreviewLoading, setPricingPreviewLoading] = useState(false);
  const ownerConnectSnapshotAvailable = hasOwnerConnectReadinessSnapshot(event.creator);
  const requiresReadyOrganizerOwner =
    event.creator?.role === UserRole.organizer &&
    ownerConnectSnapshotAvailable &&
    !isStripeConnectReady(event.creator);

  // Determine default zone and mode based on the event’s zone
  const defaultEventTz = event.eventTimeZone ?? viewerTz;
  const defaultTzMode  = tzEqualForInstant(defaultEventTz, viewerTz, new Date(event.date))
  ? 'auto'
  : 'manual';

  const form = useForm<EditEventValues>({
    resolver: zodResolver(editEventSchema),
    defaultValues: {
      title: event.title,
      description: event.description,
      date: defaultTzMode === 'manual'
        ? utcIsoToWallClockDate(event.date, defaultEventTz)
        : new Date(event.date),
      tzMode: defaultTzMode,
      eventTimeZone: defaultEventTz,
      location: event.location,
      category: event.category,
      contactEmail: event.contactEmail ?? "",
      contactPhone: event.contactPhone ?? "",
      // if the event already had a selection, use it; if it had a phone but no apps (legacy data), default to 'whatsapp'; if no phone, leave undefined
      // normalize DB null -> undefined for RHF/Zod optional
      contactPhoneApps: event.contactPhone ? (event.contactPhoneApps ?? undefined) : undefined,
      useProfilePhone: false,
      isPaid: event.isPaid ?? false,
      priceAmount: formatPriceAmountFromCents(event.priceCents, event.currency),
      currency: event.currency ?? "",
    },
  });

  const eventTimeZoneValue = useWatch({
    control: form.control,
    name: 'eventTimeZone',
  });

  const [titleValue, descriptionValue, locationValue, useProfilePhoneValue, isPaidValue, currencyValue, priceAmountValue] = useWatch({
    control: form.control,
    name: ["title", "description", "location", "useProfilePhone", "isPaid", "currency", "priceAmount"],
  });
  const shouldShowManualPhoneInput = !useProfilePhoneValue;
  const currencyCode = (currencyValue ?? "").toUpperCase();
  const isZeroDecimal = currencyCode === "JPY" || currencyCode === "CLP";
  const exponent = isZeroDecimal ? 0 : 2;
  const pricingPreviewMode =
    event.creator?.role === UserRole.organizer
      ? 'organizer'
      : event.creator?.role === UserRole.admin
        ? 'admin'
        : null;
  const shouldShowPricingPreview = pricingPreviewMode !== null;
  // Current phone values (profile and manual)
  const manualPhoneE164 = useWatch({ control: form.control, name: "contactPhone" }) ?? "";
  const profilePhoneE164 = profilePhone ?? ""; // can be empty if no profile phone
  const isManualPhoneValid = !!manualPhoneE164 && isValidPhoneNumber(manualPhoneE164);
  const isProfilePhoneValid = !!profilePhoneE164 && isValidPhoneNumber(profilePhoneE164);
  // Show the contact apps block ONLY if the corresponding phone (profile/manual) is valid
  const phoneSelected = useProfilePhoneValue ? isProfilePhoneValid : isManualPhoneValid;


  // useEffect to handle changes to useProfilePhoneValue
  useEffect(() => {
    if (useProfilePhoneValue) {
      // When using profile phone, copy it into the form only if it exists
      if (profilePhone) form.setValue("contactPhone", profilePhone, { shouldValidate: true });
    } else {
      if (form.getValues("contactPhone") === profilePhone) {
        // Revert to the event’s original phone if it was different from the profile one,
        // or to "" if the original was also the profile phone (to force manual entry when the field appears).
        if (event.contactPhone === profilePhone) {
          form.setValue("contactPhone", "", { shouldValidate: true });
        } else {
          form.setValue("contactPhone", event.contactPhone ?? "", { shouldValidate: true });
        }
      }
      // If the current value is NOT the profile phone (e.g., the user typed manually),
      // when unchecking, keep that manual value.
    }
  }, [useProfilePhoneValue, profilePhone, form, event.contactPhone]);

  // When the profile phone finishes loading in context, reflect only the checkbox state.
  useEffect(() => {
    if (profilePhone === undefined) return; // still loading

    const matchesProfile = !!profilePhone && (event.contactPhone ?? '') === profilePhone;

    // Only toggle the checkbox; do not overwrite contactPhone here.
      form.setValue('useProfilePhone', matchesProfile, {
        shouldDirty: false,
        shouldValidate: false,
      });
    }, [profilePhone, event.contactPhone, form]);

  // Clear contactPhoneApps if the manual phone becomes invalid (or empty)
  useEffect(() => {
    if (!useProfilePhoneValue && !isManualPhoneValid) {
      if (form.getValues("contactPhoneApps") !== undefined) {
        form.setValue("contactPhoneApps", undefined, { shouldDirty: true, shouldValidate: false });
      }
    }
  }, [useProfilePhoneValue, isManualPhoneValid, form]);



  // Sync eventTimeZone when viewerTz changes in auto mode
  useEffect(() => {
    if (form.getValues('tzMode') === 'auto') {
      form.setValue('eventTimeZone', canonicalizeTimeZone(viewerTz), { shouldValidate: true });
    }
  }, [viewerTz, form]);

  useEffect(() => {
    const normalizedCurrency = (currencyValue ?? '').trim().toUpperCase()
    const parsedPriceCents = parsePriceAmountToCents(priceAmountValue ?? '', exponent)

    if (
      !pricingPreviewMode ||
      !isPaidValue ||
      !parsedPriceCents ||
      normalizedCurrency.length !== 3
    ) {
      setPricingPreview(null)
      setPricingPreviewLoading(false)
      return
    }

    let canceled = false
    setPricingPreviewLoading(true)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await getEventPricingPreview({
            isPaid: true,
            priceCents: parsedPriceCents,
            currency: normalizedCurrency,
            previewMode: pricingPreviewMode,
          })
          if (canceled) return
          setPricingPreview(result.success ? result.data : null)
        } catch {
          if (!canceled) {
            setPricingPreview(null)
          }
        } finally {
          if (!canceled) {
            setPricingPreviewLoading(false)
          }
        }
      })()
    }, 250)

    return () => {
      canceled = true
      window.clearTimeout(timer)
    }
  }, [
    currencyValue,
    exponent,
    isPaidValue,
    priceAmountValue,
    pricingPreviewMode,
  ])

  function onSubmit(values: EditEventValues) {
    const loadingToastId = toast.loading("Editing your event...");

    startTransition(async () => {
      try {
        const {
            title,
            description,
            date,
            location,
            category,
            contactEmail,
            contactPhone,
            contactPhoneApps,
            tzMode,
            eventTimeZone,
            isPaid,
            priceAmount,
            currency,
          } = values;

          const finalTz = tzMode === "auto" ? viewerTz : eventTimeZone!;
          const eventDateUTC = pickerDateToUtc(date, finalTz);
          const rawPrice = (priceAmount ?? "").trim();
          const parsedAmount = rawPrice ? Number(rawPrice) : NaN;
          const normalizedIsPaid = isPaid === true;
          const normalizedPriceCents =
            normalizedIsPaid && Number.isFinite(parsedAmount) && parsedAmount > 0
              ? (exponent === 0 ? Math.round(parsedAmount) : Math.round(parsedAmount * 100))
              : null;
          const normalizedCurrency =
            normalizedIsPaid && currency?.trim()
              ? currency.trim().toUpperCase()
              : null;

          const payload: UpdateEventFormSerialized = {
            id: event.id,                                               // ← required in update
            title,
            description,
            date: eventDateUTC.toISOString(),
            eventTimeZone: tzMode === 'auto' ? viewerTz : eventTimeZone!,
            location,
            category,
            contactEmail: contactEmail?.trim() || null,                 // "" -> null
            contactPhone: contactPhone?.trim() || null,                 // "" -> null
            contactPhoneApps: contactPhone ? contactPhoneApps : undefined, // keep undefined until user chooses
            isPaid: normalizedIsPaid,
            priceCents: normalizedPriceCents,
            currency: normalizedCurrency,
          };

          const result = await updateEvent(payload);

          /* ---------- backend error ---------- */
          if (!result.success) {
            toast.error(
              result.message || "Failed to update event. Please check errors.",
              { id: loadingToastId },
            );

            if (result.errors) {
              const errors = result.errors;
              const currentValues = form.getValues();

              applyZodErrorsToForm(
                form,
                toFormError<EditEventValues>(errors),
                { setRoot: true }
              );

              Object.entries(errors).forEach(([key, value]) => {
                const messages = Array.isArray(value)
                  ? value
                  : value?._errors ?? [];

                if (messages.length > 0 && !(key in currentValues)) {
                  toast.error(`Form error: ${messages.join(", ")}`, {
                    id: String(Math.random()),
                  });
                }
              });
            }

            return;
          }

          /* ---------- success ---------- */
          toast.success(result.message || "Event updated", {
            id: loadingToastId,
            description: `Changes saved for ${values.title}`,
            icon: (
              <AnimatedIcon
                icon={FileAnimatedIcon}
                size={24}
                state="in"
                persistAfterIn
              />
            ),
          });

          if (result.updatedEvent) {
            onSuccess(result.updatedEvent);     // optimistic update
          } else {
            onSuccess();                        // “no changes” or updatedEvent = null
          }

      } catch (err: unknown) {
        const message = err instanceof Error
          ? err.message
          : "An unexpected error occurred while updating event.";
        toast.error(message, { id: loadingToastId });
      }
    });
  }

  return (
    <Form {...form}>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 text-white p-6 sm:pt-0">

        {/* Title */}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input {...field} type="text" maxLength={60} className="bg-black border-zinc-700 focus-visible:ring-emerald-500" />
              </FormControl>
              <div className="flex justify-start ml-1.5">
                <FormMessage />
                <AnimatedCharactersCounter currentValue={titleValue} maxLength={60} />
              </div>
            </FormItem>
          )}
        />
        
        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} maxLength={5000} className="bg-black border-zinc-700 focus-visible:ring-emerald-500" />
              </FormControl>
              <div className="flex justify-start ml-1.5">
                <FormMessage />
                <AnimatedCharactersCounter currentValue={descriptionValue} maxLength={5000} />
              </div>
            </FormItem>
          )}
        />

        {/* Location */}
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location</FormLabel>
              <FormControl>
                <Input {...field} type="text" maxLength={255} className="bg-black border-zinc-700 focus-visible:ring-emerald-500" />
              </FormControl>
              <div className="flex justify-start ml-1.5">
                <FormMessage />
                <AnimatedCharactersCounter currentValue={locationValue} maxLength={255} />
              </div>
            </FormItem>
          )}
        />

        {/* Date and Time Picker */}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date and Time</FormLabel>
              <FormControl>
                <DateTimePicker
                  value={field.value}
                  onChange={field.onChange}
                  hourCycle={12}
                  granularity="minute"
                  hidden={{
                    before: startOfDay(new Date()),
                    after: addYears(startOfDay(new Date()), 2),
                  }}
                  yearRange={2}
                  className="bg-black border-zinc-700 hover:bg-white data-[state=open]:ring-2 data-[state=open]:ring-emerald-500 cursor-pointer"
                  lockPrevAtCurrentMonth={true}
                  filterPastMonthsInSelect={true}
                  popoverPortalled={false}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* -------- Time Zone -------- */}
        <FormField
          control={form.control}
          name="tzMode"
          render={({ field }) => (
            <FormItem>
              <TimeZoneSelector
                tzMode={field.value as 'auto' | 'manual'}
                onTzModeChange={field.onChange}
                eventTimeZone={eventTimeZoneValue}
                onEventTimeZoneChange={(tz) =>
                  form.setValue('eventTimeZone', tz, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                viewerTz={viewerTz}
                eventTzError={form.formState.errors.eventTimeZone?.message as string | undefined}
                className="mt-0"
              />
              <FormMessage />
              {field.value === 'manual' && (
                <FormField
                  control={form.control}
                  name="eventTimeZone"
                  render={() => (
                    <FormItem className="sr-only">
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </FormItem>
          )}
        />

        {/* Pricing / ticketing */}
        <FormField
          control={form.control}
          name="isPaid"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4 bg-black border-zinc-700">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FormLabel>Paid event</FormLabel>
                  <PaidEventPricingTooltip where="edit" />
                </div>
                <p className="text-xs text-zinc-400">Changes apply to future purchases only.</p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={requiresReadyOrganizerOwner}
                  className="data-[state=unchecked]:bg-zinc-900 data-[state=checked]:bg-emerald-600 cursor-pointer"
                />
              </FormControl>
            </FormItem>
          )}
        />
        {requiresReadyOrganizerOwner && (
          <p className="mt-2 text-xs text-amber-300">
            This event pays out to the organizer, so Stripe Connect must be fully enabled before it can stay paid.
          </p>
        )}

        <CollapseMotion show={!!isPaidValue} variant="blur-in">
          <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/30 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-white">Ticket price</p>
              <p className="text-xs text-zinc-400">See the info tooltip above for pricing rules and restrictions.</p>
            </div>

            <div className="flex items-start gap-2">
              <FormField
                control={form.control}
                name="currency"
                render={({ field, fieldState }) => (
                  <FormControl>
                    <CurrencySelect
                      {...field}
                      onValueChange={field.onChange}
                      onCurrencySelect={setSelectedCurrency}
                      placeholder="USD"
                      currencies="all"
                      variant="small"
                      disabled={requiresReadyOrganizerOwner}
                      valid={!fieldState.invalid}
                    />
                  </FormControl>
                )}
              />

              <FormField
                control={form.control}
                name="priceAmount"
                render={({ field, fieldState }) => (
                  <div className="relative w-full">
                    <FormControl>
                      <NumericFormat
                        customInput={Input}
                        value={field.value ?? ""}
                        onValueChange={(values) => field.onChange(values.value || "")}
                        valueIsNumericString
                        thousandSeparator="."
                        decimalSeparator=","
                        allowedDecimalSeparators={[".", ","]}
                        decimalScale={exponent}
                        fixedDecimalScale={false}
                        allowNegative={false}
                        disabled={requiresReadyOrganizerOwner}
                        placeholder="0"
                        className={cn(
                          "pr-10 bg-black text-white border-zinc-700 placeholder:text-zinc-400",
                          "focus-visible:ring-emerald-500 focus-visible:border-emerald-500",
                          fieldState.invalid && "border-red-500"
                        )}
                      />
                    </FormControl>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-300">
                      {selectedCurrency?.symbol}
                    </span>
                  </div>
                )}
              />
            </div>

            {(form.formState.errors.currency || form.formState.errors.priceAmount) && (
              <div className="text-[0.8rem] font-medium text-destructive">
                {form.formState.errors.currency?.message && <p>{form.formState.errors.currency.message}</p>}
                {form.formState.errors.priceAmount?.message && <p>{form.formState.errors.priceAmount.message}</p>}
              </div>
            )}

            {shouldShowPricingPreview && (
              <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/30 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Pricing Preview</p>

                {pricingPreviewLoading ? (
                  <p className="mt-2 text-xs text-zinc-400">Updating preview...</p>
                ) : pricingPreview ? (
                  <div className="mt-2 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Ticket price</span>
                      <span className="text-white">
                        {formatPrice(pricingPreview.exact.ticketAmountCents, pricingPreview.currency)}
                      </span>
                    </div>
                    {pricingPreview.previewMode === 'organizer' && (
                      <div className="flex items-center justify-between text-zinc-300">
                        <span>Platform fee</span>
                        <span className="text-white">
                          {formatPrice(pricingPreview.exact.platformFeeAmountCents, pricingPreview.currency)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>Estimated Stripe fee</span>
                      <span>
                        {formatPrice(pricingPreview.estimated.stripeFeeAmountCents, pricingPreview.currency)}
                      </span>
                    </div>
                    <div className="h-px bg-zinc-800" />
                    <div className="flex items-center justify-between font-medium text-emerald-300">
                      <span>
                        {pricingPreview.previewMode === 'organizer'
                          ? 'Estimated organizer net'
                          : 'Estimated final net'}
                      </span>
                      <span>
                        {formatPrice(pricingPreview.estimated.finalNetAmountCents, pricingPreview.currency)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-zinc-400">
                    Enter a valid paid ticket price to preview your estimated payout.
                  </p>
                )}

                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  Estimated fields may vary from final Stripe settlement values.
                </p>
              </div>
            )}
          </div>
        </CollapseMotion>

        {/* Category */}
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="bg-black border-zinc-700 focus:ring-emerald-500 cursor-pointer">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="bg-black text-white border-zinc-700">
                  {Object.values(EventCategory).map((cat) => (
                    <SelectItem key={cat} value={cat} className="capitalize cursor-pointer hover:bg-zinc-700">
                      {capitalizeFirstLetter(cat)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Contact Email */}
        <FormField
          control={form.control}
          name="contactEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} value={field.value ?? ""} className="bg-black border-zinc-700 focus-visible:ring-emerald-500" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Checkbox 'Use profile phone' */}
        <FormField
          control={form.control}
          name="useProfilePhone"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 rounded-md border p-4 bg-black border-zinc-700">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={profilePhone === undefined} // disable while loading
                  className="data-[state=checked]:bg-emerald-600 border-zinc-600"
                  id="edit-useProfilePhoneCheckbox"
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel htmlFor="edit-useProfilePhoneCheckbox" className="cursor-pointer">
                  Use my profile phone number?
                </FormLabel>
                {/* Show the number only when toggle is on and the phone exists */}
                {field.value && profilePhone && (
                  <p className="text-xs text-zinc-400">{profilePhone}</p>
                )}
                {/* If resolved to null (no phone on profile), show the message */}
                {profilePhone === null && (
                  <p className="text-xs text-red-500">No phone number found in your profile.</p>
                )}
              </div>
            </FormItem>
          )}
        />

        {/* Phone Input (Conditional) */}
        <CollapseMotion show={shouldShowManualPhoneInput} variant="blur-in">
          <FormField
            control={form.control}
            name="contactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white font-heading">
                  Contact Phone (Optional if email provided)
                </FormLabel>
                <FormControl>
                  <PhoneInput
                    defaultCountry="AR"
                    international
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    className="w-full"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CollapseMotion>

        {/* Phone Contact Method */}
        <CollapseMotion show={phoneSelected} variant="slide-up">
          <FormField
            control={form.control}
            name="contactPhoneApps"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact method (for phone)</FormLabel>
                <FormControl>
                  <ContactPhoneMethodSelector
                    value={field.value as ContactPhoneApps | undefined}
                    onChange={(v) => field.onChange(v)}
                    // Avoid remounts on every keystroke: only reset when source or validity changes
                    resetKey={useProfilePhoneValue ? "profile" : (isManualPhoneValid ? "valid" : "empty")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CollapseMotion>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t border-zinc-800">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isPending}
            className="border border-white/16 bg-white/[0.025] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 focus:bg-white/[0.08] focus:text-white transition-colors duration-200 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className={cn(
              "cursor-pointer transition-colors duration-200 active:scale-95 disabled:opacity-70",
              "text-white border border-emerald-800 bg-emerald-950/50",
              "hover:bg-emerald-900/60 hover:border-emerald-700",
              "focus:bg-emerald-900/60 focus:border-emerald-700",
              "focus-visible:outline-none focus-visible:ring-0",
            )}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
