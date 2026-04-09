'use client'

/**
 * OnboardingClient
 * - Multi-step animated onboarding with motion variants and gated actions.
 * - Arrows (Next/Back) are Lottie-based icons controlled by 'play' flags.
 * - "Next" only renders when it's actionable.
 * - "Begin" appears for the final 'user' action state.
 * - Organizers use a dedicated Stripe step after the required phone number step.
 */

import { motion, type Variants, useAnimation, AnimatePresence, type MotionProps } from 'motion/react'
import { useEffect, useState, useTransition, useRef, useCallback, useMemo, type ReactNode } from 'react'
import type { UsernameAvailabilityResponse } from '@/types/api'

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import InputWithStatus, { type FieldStatus } from './InputWithStatus'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/ui/phone-input'
import { refreshClerkClientStateAfterOnboarding } from '@/components/Onboarding/refreshClerkClientState'
import { isValidPhoneNumber } from 'react-phone-number-input/min'
import { AuroraButton } from '@/components/CommonButtons/AuroraButton'
import LinesBackground from '../AnimatedBackgrounds/LinesBackground'
import AnimatedLogo from '@/components/AnimatedLogos/AnimatedLogo'
import AnimatedIcon from '@/components/LordIcons/AnimatedIcon'
import { LoadingDotsAnimatedIcon } from '@/lib/icons'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useUser, useSession } from '@clerk/nextjs'
import {
  completeOnboarding,
  submitOnboarding,
} from '@/app/(auth)/onboarding/[[...step]]/actions'
import { startConnectOnboarding } from '@/app/(dashboard)/organizer/actions'
import { cn, validateUsername } from '@/lib/utils'
import { NeonProgressBar } from '@/components/Onboarding/NeonProgressBar'
import AnimatedHeight from '@/components/Onboarding/AnimatedHeight'
import OrganizerStripeOnboardingStep from '@/components/Onboarding/OrganizerStripeOnboardingStep'
import {
  advanceOrganizerPhoneStep,
  getOnboardingProgress,
  type OrganizerProfileSnapshot,
  type OnboardingStep,
} from '@/components/Onboarding/onboardingFlow'
import TriStateArrowIcon from '@/components/LordIcons/TriStateArrowIcon'
import {
  FlatArrowAnimatedIcon,
  FlatArrowAnimatedIconHover,
  FlatArrowAnimatedIconClick,
} from '@/lib/icons'
import { useMediaQuery } from '@/lib/hooks'

/* ------------------------------------
 * Motion variants
 * ---------------------------------- */
const formDesktopVariants: Variants = {
  hidden: { opacity: 0, y: 220 }, // desktop: enter from bottom
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 80, damping: 12 },
  },
}

const formMobileVariants: Variants = {
  hidden: { opacity: 0, x: 220 }, // mobile: enter from right
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 85, damping: 14 },
  },
}

/* ------------------------------------
 * Wrapper that handles the animated lead-in
 * ---------------------------------- */
const FormWrapper = ({
  children,
  isDesktop,
}: {
  children: ReactNode
  isDesktop: boolean
}) => {
  
  const controls = useAnimation()

  useEffect(() => {
    // Delay the form entrance on desktop so the background/logo can lead first
    // before the glass card arrives with its own animation.
    const FORM_DELAY_MS = isDesktop ? 500 : 0
    const t = setTimeout(() => controls.start('visible'), FORM_DELAY_MS)
    return () => clearTimeout(t)
  }, [controls, isDesktop])


  return (
    <motion.div
      key={isDesktop ? 'desktop' : 'mobile'}
      className="w-full"
      variants={isDesktop ? formDesktopVariants : formMobileVariants}
      initial="hidden"
      animate={controls}
    >
      {children}
    </motion.div>
  )
}

/* ------------------------------------
 * Schema
 * ---------------------------------- */
const onboardingSchema = z
  .object({
    username: z
      .string()
      .min(4, { message: 'Username must be at least 4 characters.' })
      .max(25, { message: 'Username must be 25 characters or fewer.' })
      .regex(/^[a-zA-Z0-9._-]+$/, {
        message: 'Only letters, numbers, dot (.), underscore (_) and hyphen (-) are allowed.',
      }),
    role: z.enum(['user', 'organizer'], { required_error: 'Please select a role.' }),
    phoneNumber: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Enforce phone number only for organizers; validate with full international format
    if (data.role === 'organizer') {
      if (!data.phoneNumber || data.phoneNumber.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Phone number is required for organizers.',
          path: ['phoneNumber'],
        })
      } else if (!isValidPhoneNumber(data.phoneNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid phone number. Include country code.',
          path: ['phoneNumber'],
        })
      }
    }
  })

export type OnboardingFormData = z.infer<typeof onboardingSchema>

type UsernameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error'

function isAbortError(err: unknown): err is { name: 'AbortError' } {
  return typeof err === 'object' && err !== null && 'name' in err &&
         (err as { name?: unknown }).name === 'AbortError';
}


/* ------------------------------------
 * Component
 * ---------------------------------- */
export default function OnboardingClient() {
  const router = useRouter()
  const { user } = useUser()
  const { session } = useSession()
  const [pending, startTransition] = useTransition()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const [step, setStep] = useState<OnboardingStep>(1)

  // Animation & hover flags for arrow icons (Next/Back)
  const [playBack, setPlayBack] = useState(false)
  const [playNext, setPlayNext] = useState(false)
  const [hoverBack, setHoverBack] = useState(false)
  const [hoverNext, setHoverNext] = useState(false)

  // Counters for "in" animations
  const [backAppearTick, setBackAppearTick] = useState(0)
  const [nextAppearTick, setNextAppearTick] = useState(0)
  const [uStatus, setUStatus] = useState<UsernameStatus>('idle')
  const [lastSavedOrganizerProfile, setLastSavedOrganizerProfile] =
    useState<OrganizerProfileSnapshot | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /** Safe timeout: auto-clears on unmount. */
  function useSafeTimeout() {
    const r = useRef<number[]>([])
    useEffect(() => () => {
      r.current.forEach(clearTimeout)
      r.current = []
    }, [])
    return useCallback((fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      r.current.push(id)
      return id
    }, [])
  }
  const setSafeTimeout = useSafeTimeout()
  const ARROW_CLICK_MS = 200

  // React Hook Form + Zod resolver
  const form = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { username: '', role: undefined, phoneNumber: '' },
    mode: 'onChange',
    reValidateMode: 'onChange',
  })

  function mapServerFieldError(
    result: Awaited<ReturnType<typeof submitOnboarding>>
  ) {
    if (
      result.error?.field &&
      (result.error.field === 'username' ||
        result.error.field === 'role' ||
        result.error.field === 'phoneNumber')
    ) {
      form.setError(result.error.field as keyof OnboardingFormData, {
        type: 'server',
        message: result.error.message,
      })
      return true
    }

    return false
  }

  async function saveOnboardingData(
    data: OnboardingFormData,
    options?: { refreshRouter?: boolean; completeOnboarding?: boolean }
  ) {
    if (!user) return null

    let phoneToSubmit = data.phoneNumber
    if (data.role !== 'organizer' && data.phoneNumber === '') phoneToSubmit = undefined

    const result = await submitOnboarding(
      data.username,
      data.role,
      phoneToSubmit,
      { completeOnboarding: options?.completeOnboarding }
    )
    if (!result.success) {
      if (!mapServerFieldError(result)) {
        toast.error(result.message || 'Error saving data')
      }
      return null
    }

    await refreshClerkClientStateAfterOnboarding({
      user,
      session,
      router,
      refreshRouter: options?.refreshRouter,
    })
    return result
  }

  async function finalizeClerkOnboarding(
    role: Extract<OnboardingFormData['role'], 'user' | 'organizer'>,
    options?: { refreshRouter?: boolean }
  ) {
    if (!user) return null

    const result = await completeOnboarding(role)
    if (!result.success) {
      toast.error(result.error?.message || result.message || 'Error completing onboarding')
      return null
    }

    await refreshClerkClientStateAfterOnboarding({
      user,
      session,
      router,
      refreshRouter: options?.refreshRouter,
    })

    return result
  }

  function finishOnboarding(data: OnboardingFormData) {
    if (!user) return

    startTransition(() => {
      void (async () => {
        try {
          const result = await saveOnboardingData(data, {
            refreshRouter: false,
            completeOnboarding: true,
          })
          if (!result) return

          router.replace(data.role === 'organizer' ? '/organizer' : '/')
          toast.success(result.message || 'Onboarding successful!')
        } catch {
          toast.error('An unexpected error occurred.')
        }
      })()
    })
  }

  function advanceOrganizerToStripeStep(data: OnboardingFormData) {
    if (!user || data.role !== 'organizer') return

    startTransition(() => {
      void (async () => {
        try {
          const currentProfile: OrganizerProfileSnapshot = {
            username: data.username,
            role: 'organizer',
            phoneNumber: data.phoneNumber ?? '',
          }

          const stepResult = await advanceOrganizerPhoneStep({
            current: currentProfile,
            lastSaved: lastSavedOrganizerProfile,
            persist: async (profile) => {
              const result = await saveOnboardingData(profile, {
                refreshRouter: false,
                completeOnboarding: false,
              })
              if (!result) {
                throw new Error('organizer_profile_save_failed')
              }
            },
          })

          setLastSavedOrganizerProfile(stepResult.savedProfile)
          setStep(4)
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'organizer_profile_save_failed'
          ) {
            return
          }
          toast.error('An unexpected error occurred.')
        }
      })()
    })
  }

  function startOrganizerStripeOnboarding() {
    startTransition(() => {
      void (async () => {
        try {
          const connectResult = await startConnectOnboarding()
          if (!connectResult.success) {
            toast.error(connectResult.error)
            return
          }

          const completionResult = await finalizeClerkOnboarding('organizer', {
            refreshRouter: false,
          })
          if (!completionResult) return

          window.location.assign(connectResult.url)
        } catch {
          toast.error('An unexpected error occurred.')
        }
      })()
    })
  }

  function skipOrganizerStripeOnboarding() {
    startTransition(() => {
      void (async () => {
        try {
          const result = await finalizeClerkOnboarding('organizer', {
            refreshRouter: false,
          })
          if (!result) return

          router.replace('/organizer')
          toast.success(result.message || 'Onboarding successful!')
        } catch {
          toast.error('An unexpected error occurred.')
        }
      })()
    })
  }

  const onSubmit = (data: OnboardingFormData) => {
    if (data.role === 'organizer') {
      if (step === 3) {
        advanceOrganizerToStripeStep(data)
      }
      return
    }

    finishOnboarding(data)
  }

  // Live watches for gating logic
  const selectedRole = form.watch('role')
  const username = (form.watch('username') ?? '').trim()
  const usernameTrimmed = useMemo(() => username.trim(), [username])
  const localError = useMemo(() => validateUsername(usernameTrimmed) ?? null, [usernameTrimmed])
  const localValid = !localError
  const zodHasError = !!form.formState.errors.username

 const usernameStatusForUI: FieldStatus =
  !usernameTrimmed ? 'idle'
  : (localError || zodHasError) ? 'invalid'
  : uStatus;
  
  const phoneValue = (form.watch('phoneNumber') ?? '').trim()

  // Gating conditions

  const canProceedStep1 =
    localValid &&
    !zodHasError &&
    uStatus === 'available'
  const canProceedStep3 = selectedRole === 'organizer' && isValidPhoneNumber(phoneValue)
  const { currentStep, totalSteps } = getOnboardingProgress(step, selectedRole)

  // If you are on an organizer-only step and the role is switched away from 'organizer', force step back to 2.
  useEffect(() => {
    if (step >= 3 && selectedRole !== 'organizer') {
      setStep(2)
    }
    if (selectedRole !== 'organizer' && lastSavedOrganizerProfile) {
      setLastSavedOrganizerProfile(null)
    }
  }, [lastSavedOrganizerProfile, selectedRole, step])


  // Username availability logic 

  useEffect(() => {
  const value = usernameTrimmed;           // already computed above
  abortRef.current?.abort();

  if (!value) { 
    setUStatus('idle'); 
    return; 
  }
  // Local validation only: min 4 chars, regex, etc. If it fails, you DO NOT query.
  const localErr = validateUsername(value);
  if (localErr) { 
    setUStatus('invalid'); 
    return; 
  }

  setUStatus('checking');
  const ac = new AbortController();
  abortRef.current = ac;

  const t = setTimeout(async () => {
    try {
      const res = await fetch(
        `/api/username-availability?u=${encodeURIComponent(value)}`,
        {
          signal: ac.signal,
          cache: 'no-store',
        }
      );

      if (!res.ok) {
        setUStatus('error');
        return;
      }

      let json: UsernameAvailabilityResponse | null = null;
      try {
        json = (await res.json()) as UsernameAvailabilityResponse;
      } catch {
        // non-json response → handled below
      }

      if (!json || !json.success) {
        setUStatus('error');
        return;
      }

      setUStatus(json.data.available ? 'available' : 'taken');
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      console.error(
        'username availability failed',
        err instanceof Error ? err.message : err
      );
      setUStatus('error');
    }
  }, 350);

  return () => { clearTimeout(t); ac.abort(); };
}, [usernameTrimmed]);


  /* ------------------------------------
   * Visibility flags
   * ---------------------------------- */

  const nextDisabled = pending || (step === 1 && uStatus === 'checking');

  const showBegin = !playNext && !playBack && step === 2 && selectedRole === 'user'

  const showBackBtn = step > 1

  const showNextBtn =
    (step === 1 && canProceedStep1) ||
    (step === 2 && selectedRole === 'organizer') ||
    (step === 3 && canProceedStep3)

  const prevShowNextBtnRef = useRef(showNextBtn)
  useEffect(() => {
    if (!prevShowNextBtnRef.current && showNextBtn && !playNext) {
      setHoverNext(false)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setNextAppearTick((t) => t + 1))
      })
    }
    if (prevShowNextBtnRef.current && !showNextBtn) {
      setHoverNext(false)
    }
    prevShowNextBtnRef.current = showNextBtn
  }, [showNextBtn, playNext])

  const prevStepRef = useRef(step)
  useEffect(() => {
    if (prevStepRef.current === 1 && step > 1 && !playBack) {
      setHoverBack(false)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBackAppearTick((t) => t + 1))
      })
    }
    if (step === 1) {
      setHoverBack(false)
    }
    prevStepRef.current = step
  }, [step, playBack])

  /* ------------------------------------
   * Step transitions
   * ---------------------------------- */
  const stepMotion: Pick<MotionProps, 'initial' | 'animate' | 'exit'> = {
    initial: { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 120, damping: 16 } },
    exit: { opacity: 0, x: -40, transition: { duration: 0.18 } },
  }

  /* ------------------------------------
   * Navigation handlers (Next/Back)
   * ---------------------------------- */
  async function handleNext() {
    if (step === 1) {
      if (!canProceedStep1) return
      const ok = await form.trigger(['username'])
      if (!ok) return
      setStep(2)
    } else if (step === 2) {
      const ok = await form.trigger(['role'])
      if (!ok) return
      if (form.getValues('role') === 'organizer') {
        setStep(3)
      }
    } else if (step === 3) {
      const ok = await form.trigger(['phoneNumber'])
      if (!ok) return

      const values = form.getValues()
      if (values.role !== 'organizer') return

      advanceOrganizerToStripeStep({
        username: values.username,
        role: values.role,
        phoneNumber: values.phoneNumber,
      })
    }
  }

  function handleBack() {
    if (step === 1) return
    if (step === 4) {
      setStep(3)
    } else if (step === 3) {
      setStep(2)
    } else {
      setStep(1)
    }
  }

  return (
    <div className="relative min-h-dvh bg-black overflow-hidden">
      <LinesBackground delayMobile={0.2} />

      {/* Centered layout */}
      <main className="relative z-10 max-w-xl min-h-dvh mx-auto p-6 flex flex-col justify-center">
        <AnimatedLogo className="w-14 h-14 md:w-16 md:h-16 mx-auto mb-8" />

        <FormWrapper isDesktop={isDesktop}>
          <Form {...form}>
            <AnimatedHeight
              className={cn(
                'w-full rounded-2xl border border-white/10 bg-black/10',
                'backdrop-blur-sm [-webkit-backdrop-filter:blur(8px)] [backdrop-filter:blur(8px)]'
              )}
            >
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6 px-4 py-14"
              >
                {/* Heading + progress */}
                <h1 className="text-3xl text-center text-white font-bold mb-4 font-display tracking-widest">
                  Create your profile
                </h1>
                <p className="text-center text-zinc-400 mb-4">
                  Just {totalSteps} step(s). You&apos;ll be done in under a minute.
                </p>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">
                    Step {currentStep} of {totalSteps}
                  </span>
                  <div
                    className="flex-1"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((currentStep / totalSteps) * 100)}
                  >
                    <NeonProgressBar value={currentStep / totalSteps} height={6} />
                  </div>
                </div>

                {/* Steps */}
                <div>
                  <AnimatePresence mode="wait">
                    {step === 1 && (
                      <motion.div key="step-1" {...(stepMotion)}>
                        <FormField
                          control={form.control}
                          name="username"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-white mb-2 font-semibold font-heading text-lg">
                                Username
                              </FormLabel>
                              <FormControl>
                                <InputWithStatus
                                  {...field}
                                  data-testid="onb-username"
                                  placeholder="e.g. johndoe"
                                  maxLength={25}
                                  status={usernameStatusForUI}
                                  hideHint={!!form.formState.errors.username}
                                  describedById="onb-username-status"
                                />
                              </FormControl>
                              <FormMessage />
                              <p className="text-xs text-zinc-400">
                                This will be displayed when creating or attending an event.
                              </p>

                            </FormItem>
                          )}
                        />
                      </motion.div>
                    )}

                    {step === 2 && (
                      <motion.div key="step-2" {...(stepMotion)}>
                        <FormField
                          control={form.control}
                          name="role"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-white mb-2 justify-center font-semibold font-heading text-lg">
                                What will you do here?
                              </FormLabel>
                              <FormControl>
                                {/* Role buttons (neutral when unselected, emerald glass when selected) */}
                                <div className="flex gap-4">
                                  <Button
                                    type="button"
                                    data-testid="onb-role-user"
                                    className={`flex-1 cursor-pointer rounded-xl ${
                                      field.value === 'user'
                                        ? 'border border-emerald-500 bg-emerald-900/50 text-white shadow-[0_0_14px_rgba(16,185,129,0.15)] hover:bg-emerald-900/70 hover:shadow-[0_0_22px_rgba(16,185,129,0.22)]'
                                        : 'border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.06] hover:border-white/16 hover:text-zinc-200'
                                    } focus-visible:ring-0 focus-visible:outline-none active:scale-95 transition-[background,box-shadow,border-color,color] duration-200 ease-out`}
                                    onClick={() => {
                                      // Selecting 'user' keeps you in step 2 and reveals Begin
                                      field.onChange('user')
                                    }}
                                  >
                                    Attend events
                                  </Button>

                                  <Button
                                    type="button"
                                    data-testid="onb-role-organizer"
                                    className={`flex-1 cursor-pointer rounded-xl ${
                                      field.value === 'organizer'
                                        ? 'border border-emerald-500 bg-emerald-900/50 text-white shadow-[0_0_14px_rgba(16,185,129,0.15)] hover:bg-emerald-900/70 hover:shadow-[0_0_22px_rgba(16,185,129,0.22)]'
                                        : 'border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.06] hover:border-white/16 hover:text-zinc-200'
                                    } focus-visible:ring-0 focus-visible:outline-none active:scale-95 transition-[background,box-shadow,border-color,color] duration-200 ease-out`}
                                    onClick={() => {
                                      // Selecting 'organizer' switches the flow to step 3 via Next
                                      field.onChange('organizer')
                                    }}
                                  >
                                    Organize events
                                  </Button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </motion.div>
                    )}

                    {step === 3 && selectedRole === 'organizer' && (
                      <motion.div key="step-3" {...(stepMotion)}>
                        <FormField
                          control={form.control}
                          name="phoneNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-white mb-2 font-semibold font-heading text-lg">
                                Phone number <span className="text-red-500 text-sm font-sans">(required)</span>
                              </FormLabel>
                              <FormControl>
                                <PhoneInput
                                  data-testid="onb-phone"
                                  placeholder="Enter a phone number"
                                  defaultCountry="AR"
                                  international
                                  className="text-white"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                              <p className="text-xs text-zinc-400">
                                Add a public organizer contact number before you start selling tickets.
                              </p>
                            </FormItem>
                          )}
                        />
                      </motion.div>
                    )}

                    {step === 4 && selectedRole === 'organizer' && (
                      <motion.div key="step-4" {...(stepMotion)}>
                        <OrganizerStripeOnboardingStep
                          isPending={pending}
                          onConnect={() => {
                            if (pending) return
                            startOrganizerStripeOnboarding()
                          }}
                          onSkip={() => {
                            if (pending) return
                            skipOrganizerStripeOnboarding()
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Footer actions */}
                <div className="flex items-center pt-2">
                  {/* Back button */}
                  <button
                    type="button"
                    data-testid="onb-back"
                    onMouseEnter={() => setHoverBack(true)}
                    onMouseLeave={() => setHoverBack(false)}
                    onClick={() => {
                      if (pending || playBack || step === 1) return
                      setPlayBack(true) // play Lottie click
                      handleBack() // change step immediately
                      setSafeTimeout(() => setPlayBack(false), ARROW_CLICK_MS)
                    }}
                    className={cn(
                      'inline-flex items-center justify-center size-10 leading-none rounded-full cursor-pointer',
                      'border border-white/10 bg-white/[0.04] hover:bg-white/[0.06] text-white',
                      'transition-opacity duration-300',
                      showBackBtn ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    )}
                    disabled={pending}
                    aria-label="Back"
                    title="Back"
                    tabIndex={showBackBtn ? 0 : -1}
                  >
                    <TriStateArrowIcon
                      className="-scale-x-100"
                      isDesktop={isDesktop}
                      size={24}
                      inIcon={FlatArrowAnimatedIcon}
                      hoverIcon={FlatArrowAnimatedIconHover}
                      clickIcon={FlatArrowAnimatedIconClick}
                      inColors={{ primary: '#ffffff' }}
                      hoverColors={{ primary: '#ffffff' }}
                      clickColors={{ primary: '#ffffff' }}
                      playTrigger={playBack}
                      hovered={hoverBack}
                      resetTrigger={`${backAppearTick}`}
                      onActionComplete={() => {
                        setPlayBack(false)
                      }}
                    />
                  </button>

                  {/* Next / Continue + Begin */}
                  <div className="ml-auto flex items-center">
                    <AnimatePresence mode="wait">
                      {showNextBtn && (
                        <motion.button
                          data-testid="onb-next"
                          key="next"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          type="button"
                          onMouseEnter={() => setHoverNext(true)}
                          onMouseLeave={() => setHoverNext(false)}
                          onClick={() => {
                            if (pending || playNext || !showNextBtn) return
                            setPlayNext(true)          // play Lottie click
                            handleNext()               // commit the step transition
                            setSafeTimeout(() => setPlayNext(false), ARROW_CLICK_MS)
                          }}
                          className="inline-flex items-center justify-center size-10 leading-none rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.06] text-white cursor-pointer"
                          disabled={nextDisabled}
                          aria-label="Continue"
                        >
                          <TriStateArrowIcon
                            isDesktop={isDesktop}
                            size={24}
                            inIcon={FlatArrowAnimatedIcon}
                            hoverIcon={FlatArrowAnimatedIconHover}
                            clickIcon={FlatArrowAnimatedIconClick}
                            inColors={{ primary: '#ffffff' }}
                            hoverColors={{ primary: '#ffffff' }}
                            clickColors={{ primary: '#ffffff' }}
                            playTrigger={playNext}
                            hovered={hoverNext}
                            resetTrigger={`${nextAppearTick}`}
                            onActionComplete={() => setPlayNext(false)}
                          />
                        </motion.button>
                      )}

                      {showBegin && (
                        <motion.div
                          key="begin"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="ml-3"
                        >
                          <AuroraButton
                            type="submit"
                            data-testid="onb-begin"
                            variant="outline"
                            className="w-auto cursor-pointer mt-0 bg-black text-white border border-zinc-900 hover:border-zinc-700 hover:bg-emerald-700/20 hover:text-white transition-colors duration-300 ease-in-out"
                            disabled={pending}
                          >
                            {pending ? (
                              <AnimatedIcon
                                icon={LoadingDotsAnimatedIcon}
                                colors={{ primary: '#ffffff' }}
                                state="loop"
                                size={24}
                              />
                            ) : (
                              'Begin'
                            )}
                          </AuroraButton>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </form>
            </AnimatedHeight>
          </Form>
        </FormWrapper>
      </main>
    </div>
  )
}
