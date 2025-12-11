'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { isValidPhoneNumber } from 'react-phone-number-input';
import { PhoneInput } from '../ui/phone-input';
import { savePhone } from './actions';
import {
  getCachedProfilePhone,
  primeProfilePhone,
  setCachedProfilePhone,
} from '@/lib/profilePhoneCache';
import AnimatedIcon from '../LordIcons/AnimatedIcon';
import { LoadingDotsAnimatedIcon } from '@/lib/icons';
import { toast } from 'sonner';

/** Normalize phone for comparison / persistence (E.164-ish) */
function normalizePhone(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const t = raw.replace(/^00/, '+');
  const keepPlus = t.startsWith('+');
  const digits = t.replace(/[^\d]/g, '');
  return keepPlus ? `+${digits}` : digits;
}

export default function ContactInfoPanel() {
  // Instant fill from cache; no flash
  const cached = getCachedProfilePhone();
  const [phone, setPhone] = useState<string>(cached ?? '');

  // Track original to detect "unchanged"
  const originalPhoneRef = useRef<string>(cached ?? '');

  // Prime once on mount if cache is missing
  const mountedRef = useRef<boolean>(true);
  const initialCachedRef = useRef<string | undefined>(cached);

  const [originalPhoneNormalized, setOriginalPhoneNormalized] = useState<string>(
    () => normalizePhone(cached ?? '')
  );

  useEffect(() => {
    mountedRef.current = true;

    if (initialCachedRef.current === undefined) {
      (async () => {
        try {
          const v = await primeProfilePhone();
          if (!mountedRef.current) return;
          if (typeof v === 'string') {
            originalPhoneRef.current = v;
            setPhone(v);
            setOriginalPhoneNormalized(normalizePhone(v));
          }
        } catch {
          // noop
        }
      })();
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);


  const [pending, startTransition] = useTransition();

  const unchanged = normalizePhone(phone) === originalPhoneNormalized;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    startTransition(async () => {
      try {
        if (unchanged) {
          toast.info('There are no changes to save.');
          return;
        }

        const normalized = normalizePhone(phone);
        const valid =
          !!normalized &&
          normalized.startsWith('+') &&
          isValidPhoneNumber(normalized);

        if (!valid) {
          toast.error('Invalid phone number', {
            description: 'Please check the country and number.',
          });
          return;
        }

        await savePhone(normalized);

        // keep caches in sync
        setCachedProfilePhone(normalized);
        originalPhoneRef.current = normalized;
        setOriginalPhoneNormalized(normalized);

        toast.success('Phone saved successfully.');
      } catch {
        toast.error('Could not save. Please try again.');
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-bold">Contact info</h2>
        <p className="text-sm text-zinc-400">
          This phone number is stored in your Eventify profile.
        </p>
      </div>

      {/* Phone editor (stored in your DB) */}
      <form onSubmit={onSubmit} className="space-y-4 border-t border-white/[0.07] pt-4" noValidate>
        <label className="block text-sm font-medium" htmlFor="contact-phone">
          Phone number
        </label>

        <PhoneInput
          id="contact-phone"
          name="tel"
          autoComplete="tel"
          className="w-full"
          defaultCountry="AR"
          international
          dropdownZIndex={10100} // above Clerk's modalBackdrop (10000)
          value={phone}
          onChange={(v: string | undefined) => setPhone(v || '')}
        />

        <button
          type="submit"
          disabled={pending || unchanged}
          className="rounded-md border border-emerald-500/50 bg-emerald-600/20 px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          aria-busy={pending}
          aria-disabled={pending || unchanged}
          title={unchanged ? 'No changes to save' : undefined}
        >
          {pending ? (
            <AnimatedIcon
              icon={LoadingDotsAnimatedIcon}
              colors={{ primary: '#ffffff' }}
              state="loop"
              size={24}
            />
          ) : (
            'Save'
          )}
        </button>
      </form>
    </div>
  );
}
