'use client'

import { useTransition, useEffect, useMemo, useState } from 'react'
import Image from 'next/image';
import { useSWRConfig } from 'swr';
import { revalidateEventLists } from '@/lib/mutateHelpers';
import { motion, type Variants } from 'motion/react'
import { useRouter } from 'next/navigation'
import { createEvent, type CreateEventResult, type EventFormSerialized } from '@/app/(dashboard)/events/actions'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createEventSchema, type CreateEventValues } from '@/schemas/events'
import { toast } from 'sonner'

import { cn, capitalizeFirstLetter, canonicalizeTimeZone, pickerDateToUtc } from '@/lib/utils'
import { useViewerTz } from '@/contexts/ViewerTzContext'
import { applyZodErrorsToForm, toFormError } from '@/lib/formErrors'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { CurrencySelect, type Currency } from '@/components/ui/currency-select'
import { PhoneInput } from '@/components/ui/phone-input'
import { isValidPhoneNumber } from 'react-phone-number-input';
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { TimeZoneSelector } from '@/components/FormsRelated/TimeZoneSelector'
import ContactPhoneMethodSelector, { type ContactPhoneApps } from '@/components/FormsRelated/ContactPhoneMethodSelector'
import { CollapseMotion } from '@/components/FormsRelated/CollapseMotion'
import AnimatedCharactersCounter from '@/components/AnimatedText/AnimatedCharactersCounter'
import DashboardPageWrapper from '@/components/DashboardPageWrapper'

import { EventCategory } from '@/generated/prisma'
import { useUser } from '@clerk/nextjs'
import { AuroraButton } from '@/components/CommonButtons/AuroraButton'
import { format, isToday, addHours, startOfDay, addYears, set, add } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { NumericFormat } from "react-number-format";

/* =======================
   Animations
======================= */
const easing = [0.22, 1, 0.36, 1] as const
const containerVariants: Variants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: easing, when: 'beforeChildren', staggerChildren: 0.15, delayChildren: 0.04 },
  },
}
const itemVariants: Variants = { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: easing } } }
function AnimatedFormSection({ children }: { children: React.ReactNode }) {
  return <motion.div variants={itemVariants} layout>{children}</motion.div>
}

type Props = {
  profilePhoneNumber: string | null
}

export default function CreateEventForm({ profilePhoneNumber }: Props) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { user: clerkUser } = useUser()
  const { viewerTz } = useViewerTz()
  const { mutate } = useSWRConfig()
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const isE2E = process.env.NEXT_PUBLIC_E2E === '1';


  // ===== RHF init (default values without a useEffect) =====
  const form = useForm<CreateEventValues>({
    resolver: zodResolver(createEventSchema),
    defaultValues: {
      title: '',
      description: '',
      date: (() => {

         if (isE2E) { //e2e: deterministic date/time (tomorrow 09:00, viewer time)
          return add(startOfDay(new Date()), { days: 1, hours: 9 })
        }
        const now = new Date()
        let d = addHours(now, 4)
        if (d.getDate() !== now.getDate() || d.getHours() >= 22) {
          const tomorrow = add(startOfDay(now), { days: 1 })
          d = set(tomorrow, { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 })
        } else {
          const mins = d.getMinutes()
          if (mins > 0 && mins <= 15) d.setMinutes(15, 0, 0)
          else if (mins > 15 && mins <= 30) d.setMinutes(30, 0, 0)
          else if (mins > 30 && mins <= 45) d.setMinutes(45, 0, 0)
          else if (mins > 45) { d = addHours(d, 1); d.setMinutes(0, 0, 0) }
          const minAllowed = addHours(new Date(), 4)
          if (isToday(d) && d < minAllowed) {
            d = minAllowed
            const m = d.getMinutes()
            if (m > 0 && m <= 15) d.setMinutes(15, 0, 0)
            else if (m > 15 && m <= 30) d.setMinutes(30, 0, 0)
            else if (m > 30 && m <= 45) d.setMinutes(45, 0, 0)
            else if (m > 45) { d = addHours(d, 1); d.setMinutes(0, 0, 0) }
          }
        }
        return d
      })(),
      tzMode: 'auto',
      eventTimeZone: viewerTz, // will sync below if viewerTz changes
      location: '',
      category: undefined,
      contactEmail: clerkUser?.primaryEmailAddress?.emailAddress || '',
      contactPhone: profilePhoneNumber ?? '',
      contactPhoneApps: undefined,
      useProfilePhone: !!profilePhoneNumber,
      isPaid: false,
      priceAmount: '',
      currency: '',
    },
  })

  const eventTimeZoneValue = useWatch({
    control: form.control,
    name: 'eventTimeZone',
  })

  // RHF watchers for UI
  const [
    titleValue,
    descriptionValue,
    locationValue,
    useProfilePhoneValue,
    isPaidValue,
    currencyValue,
  ] = useWatch({
    control: form.control,
    name: ['title', 'description', 'location', 'useProfilePhone', 'isPaid', 'currency'],
  })
  
  const currencyCode = (currencyValue ?? '').toUpperCase()
  const isZeroDecimal = currencyCode === 'JPY' || currencyCode === 'CLP'
  const exponent = isZeroDecimal ? 0 : 2

  // The PhoneInput leaves an empty string ("") when there is no valid number
  const phoneE164 = useWatch({ control: form.control, name: 'contactPhone' }) ?? ''
  // Country-based validation using react-phone-number-input/libphonenumber
  // If the value is in E.164 format (+54..., +1..., etc.), you don't need defaultCountry.
  // If your input works in national mode, pass defaultCountry in the <PhoneInput /> component
  const isManualPhoneValid = !!phoneE164 && isValidPhoneNumber(phoneE164 as string)


  const phoneSelected = useProfilePhoneValue
    ? !!profilePhoneNumber
    : isManualPhoneValid

  const sortedCategoryValues = useMemo(() => {
    return [...Object.values(EventCategory)].sort((a, b) => {
      const A = String(a).toLowerCase()
      const B = String(b).toLowerCase()
      return A < B ? -1 : A > B ? 1 : 0
    })
  }, [])

  // Keep contactPhone in sync with the "use profile phone" toggle
 useEffect(() => {
    if (useProfilePhoneValue && profilePhoneNumber) {
      form.setValue('contactPhone', profilePhoneNumber, { shouldValidate: true })
    } else {
      form.setValue('contactPhone', '', { shouldValidate: true })
    }
  }, [useProfilePhoneValue, profilePhoneNumber, form])

  // Clears contactPhoneApps if the MANUAL PHONE number is not valid
  useEffect(() => {
    if (!useProfilePhoneValue && !isManualPhoneValid) {
      form.setValue('contactPhoneApps', undefined, { shouldDirty: true, shouldValidate: false });
    }
  }, [useProfilePhoneValue, isManualPhoneValid, form]);

  // Sync eventTimeZone when viewerTz changes and tzMode is 'auto'
  useEffect(() => {
    if (form.getValues('tzMode') === 'auto') {
      form.setValue('eventTimeZone', viewerTz, { shouldValidate: true })
    }
  }, [viewerTz, form])

  // Submit handler
  const onSubmit = (values: CreateEventValues) => {
    const loadingToastId = toast.loading('Creating your event...', { duration: 1000 })

    startTransition(() => {
      void (async () => {
        try {
          const {
            title, description, date, location, category,
            contactEmail, contactPhone, contactPhoneApps,
            tzMode, eventTimeZone,
          } = values

          const finalTz = tzMode === 'auto' ? canonicalizeTimeZone(viewerTz) : eventTimeZone!
          const eventDateUTC = pickerDateToUtc(date, finalTz)
          const normalizedEmail = contactEmail?.trim() || null
          const normalizedPhone = contactPhone?.trim() || null
          const normalizedPhoneApps = normalizedPhone ? contactPhoneApps : undefined

          const isPaid = values.isPaid === true
          const raw = (values.priceAmount ?? '').trim()
          const amount = raw ? Number(raw) : NaN

          const priceCents =
            isPaid && Number.isFinite(amount) && amount > 0
              ? (exponent === 0 ? Math.round(amount) : Math.round(amount * 100))
              : null
          const currency = isPaid && values.currency?.trim()
            ? (values.currency.trim().toUpperCase())
            : null

          const payload: EventFormSerialized = {
            title,
            description,
            date: eventDateUTC.toISOString(),
            eventTimeZone: finalTz,
            location,
            category,
            contactEmail: normalizedEmail,
            contactPhone: normalizedPhone,
            contactPhoneApps: normalizedPhoneApps,
            isPaid: isPaid || undefined,
            priceCents: priceCents ?? null,
            currency: currency ?? null,
          }

          const result = (await createEvent(payload)) as CreateEventResult

          if (result && result.success === false) {
            toast.error(result.message || 'Failed to create event', { id: loadingToastId })
            if (result.errors) {
              applyZodErrorsToForm(form, toFormError<CreateEventValues>(result.errors), { setRoot: true })
            }
            return
          }

          if (result && result.message) {
            toast.success(result.message, {
              id: loadingToastId,
              description: `Scheduled for ${format(values.date, 'PPp', { locale: enUS })}`,
              duration: 1000,
            })
            await revalidateEventLists(mutate)
            const role = clerkUser?.publicMetadata?.role as string | undefined
            const destination = role === 'admin' ? '/admin' : role === 'organizer' ? '/organizer' : '/'
            router.push(destination)
            return
          }

          toast.error('Event creation status unclear.', { id: loadingToastId })
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'An unexpected error occurred while creating event.'
          toast.error(message, { id: loadingToastId })
        }
      })()
    })
  }




  return (
    <DashboardPageWrapper>
      <motion.section
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-xl mx-1.5 xs3:mx-2 md:mx-auto my-8 p-5 md:p-6 text-white bg-black border border-zinc-700 rounded-xl shadow-lg"
      >
        <h1 className="text-2xl font-bold mb-6 font-display">Create a new event</h1>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Title */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white font-heading">Title</FormLabel>
                    <FormControl>
                      <Input type="text" maxLength={60} {...field} className="bg-black text-white border-zinc-700 focus-visible:ring-emerald-500" />
                    </FormControl>
                    <div className="flex justify-start items-baseline gap-2 ml-1.5">
                      <AnimatedCharactersCounter currentValue={titleValue} maxLength={60} />
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Description */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white font-heading">Description</FormLabel>
                    <FormControl>
                      <Textarea maxLength={5000} {...field} className="bg-black text-white border-zinc-700 focus-visible:ring-emerald-500" />
                    </FormControl>
                    <div className="flex justify-start items-baseline gap-2 ml-1.5">
                      <AnimatedCharactersCounter currentValue={descriptionValue} maxLength={5000} />
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Location */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white font-heading">Location</FormLabel>
                    <FormControl>
                      <Input type="text" maxLength={255} {...field} className="bg-black text-white border-zinc-700 focus-visible:ring-emerald-500" />
                    </FormControl>
                    <div className="flex justify-start items-baseline gap-2 ml-1.5">
                      <AnimatedCharactersCounter currentValue={locationValue} maxLength={255} />
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

                        
            {/* Time Zone */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="tzMode"
                render={({ field }) => (
                  <FormItem>
                    <TimeZoneSelector
                      tzMode={field.value as 'auto' | 'manual'}
                      onTzModeChange={field.onChange}
                      eventTimeZone={eventTimeZoneValue}
                      onEventTimeZoneChange={(tz) => form.setValue('eventTimeZone', tz, { shouldDirty: true, shouldValidate: true })}
                      viewerTz={viewerTz}
                      eventTzError={form.formState.errors.eventTimeZone?.message as string | undefined}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Date & Time */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="text-white font-heading">Date and Time</FormLabel>
                    <FormControl>
                      <DateTimePicker
                        value={field.value}
                        onChange={field.onChange}
                        hourCycle={12}
                        granularity="minute"
                        hidden={{ before: startOfDay(new Date()), after: addYears(startOfDay(new Date()), 2) }}
                        yearRange={2}
                        placeholder="Pick a date and time"
                        className="bg-black border-zinc-700 hover:bg-white hover:text-black data-[state=open]:ring-2 data-[state=open]:ring-emerald-500 text-white cursor-pointer"
                        lockPrevAtCurrentMonth={true}
                        filterPastMonthsInSelect={true}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AnimatedFormSection>


            {/* Paid event */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="isPaid"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-md border p-3 xs3:p-4 shadow bg-black border-zinc-700">
                    <div className="space-y-1.5">
                      <FormLabel className="text-white font-heading">Paid event</FormLabel>
                      <p className=" text-2xs md:text-xs text-zinc-400">Users pay a ticket to attend</p>
                    </div>
                    {/* Right side: Powered by Stripe + Switch */}
                    <div className="flex items-center gap-8 xs3:gap-3">
                      {/* Brand block */}
                        <div
                        className={cn(
                          "flex items-center whitespace-nowrap select-none transition-all duration-300 ease-in-out",
                          field.value ? "opacity-100 md:scale-110 md:mr-1" : "opacity-60 md:scale-100 md:mr-0"
                        )}
                      >
                        <span className="text-[10px] font-medium tracking-wide text-zinc-500 select-none">
                          Powered by
                        </span>

                        <div className="flex items-center gap-0.5 md:gap-0">
                          <Image
                            src="/stripe-logo-white.svg"
                            alt="Stripe"
                            width={96}
                            height={32}
                            className="h-6 w-auto"
                          />
                          <Image
                            src="/stripe-logo.jpeg"
                            alt="Stripe"
                            width={24}
                            height={24}
                            className="h-5 w-5 object-contain"
                          />
                        </div>
                      </div>

                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="data-[state=unchecked]:bg-zinc-900 data-[state=checked]:bg-emerald-600 cursor-pointer"
                        />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Price & currency (when paid) */}
            <CollapseMotion show={!!isPaidValue} variant="blur-in">
            <div className="space-y-2">
              <FormLabel className={cn(
                (form.formState.errors.currency || form.formState.errors.priceAmount) && "text-destructive",
                "text-white font-heading"
              )}>
                Ticket Price
              </FormLabel>

              <div className="flex items-center gap-2">
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
                          // IMPORTANT: guardamos el valor "raw" (sin miles). Ej: "10000" o "10000.5"
                          onValueChange={(values) => field.onChange(values.value || "")}
                          valueIsNumericString
                          thousandSeparator="."
                          decimalSeparator=","
                          allowedDecimalSeparators={[".", ","]}
                          decimalScale={exponent}
                          fixedDecimalScale={false}
                          allowNegative={false}
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
            </div>
            </CollapseMotion>



            {/* Category */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white font-heading">Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl>
                        <SelectTrigger className="bg-black text-white border-zinc-700 focus:ring-emerald-500 cursor-pointer">
                          <SelectValue placeholder="Select a category">
                            {field.value ? capitalizeFirstLetter(field.value) : 'Select a category'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-black text-white border-zinc-700">
                        {sortedCategoryValues.map((cv) => (
                          <SelectItem key={cv} value={cv} className="capitalize cursor-pointer hover:bg-zinc-700">
                            {capitalizeFirstLetter(cv)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Contact Email */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white font-heading">Contact Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="event.contact@example.com"
                        {...field}
                        value={field.value ?? ''}
                        className="bg-black text-white border-zinc-700 focus-visible:ring-emerald-500 placeholder:text-zinc-700"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Use profile phone */}
            <AnimatedFormSection>
              <FormField
                control={form.control}
                name="useProfilePhone"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 rounded-md border p-4 shadow bg-black border-zinc-700">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!profilePhoneNumber}
                        className="data-[state=checked]:bg-emerald-600 border-zinc-600 cursor-pointer"
                        id="useProfilePhoneCheckbox"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel htmlFor="useProfilePhoneCheckbox" className="cursor-pointer text-white font-heading">
                        Use my profile phone number for event contact?
                      </FormLabel>
                      {profilePhoneNumber && field.value && <p className="text-xs text-zinc-400">{profilePhoneNumber}</p>}
                      {!profilePhoneNumber && (
                        <p className="text-xs text-red-500">
                          {form.getValues('useProfilePhone') ? 'No profile phone to use.' : 'No phone number found in your organizer profile.'}
                        </p>
                      )}
                    </div>
                  </FormItem>
                )}
              />
            </AnimatedFormSection>

            {/* Optional Contact Phone (if not using profile) */}
            <CollapseMotion show={!useProfilePhoneValue} variant="blur-in">
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white font-heading">Contact Phone (Optional if email provided)</FormLabel>
                    <FormControl>
                      <PhoneInput defaultCountry="AR" international value={field.value ?? ''} onChange={field.onChange} className="w-full" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CollapseMotion>

            {/* Phone apps (if phone is selected) */}
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
                        resetKey={useProfilePhoneValue ? 'profile' : (isManualPhoneValid ? 'valid' : 'empty')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CollapseMotion>

            {/* Submit */}
            <AnimatedFormSection>
              <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.985 }} transition={{ duration: 0.15 }}>
                <AuroraButton type="submit" disabled={isPending} className="w-full text-white cursor-pointer font-display">
                  {isPending ? 'Creating your event...' : 'Create event'}
                </AuroraButton>
              </motion.div>
            </AnimatedFormSection>
          </form>
        </Form>
      </motion.section>
    </DashboardPageWrapper>
  )
}
