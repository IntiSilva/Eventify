'use client';

import { Loader2, Check, X, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type FieldStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

type BaseProps = React.ComponentProps<typeof Input>;
type Props = Omit<BaseProps, 'status'> & {
  status: FieldStatus;
  hideHint?: boolean;
  describedById?: string;
  hintChecking?: string;
  hintAvailable?: string;
  hintTaken?: string;
  hintInvalid?: string;
  hintError?: string;
  hintIdle?: string;
};

const hintColor: Record<FieldStatus, string> = {
  idle:      'text-zinc-400',
  checking:  'text-zinc-400',
  available: 'text-emerald-400',
  taken:     'text-destructive',
  invalid:   'text-destructive',
  error:     'text-amber-400',
};

function StatusIcon({ status }: { status: FieldStatus }) {
  switch (status) {
    case 'checking':  return <Loader2 className="size-4 animate-spin text-zinc-400" aria-hidden />;
    case 'available': return <Check className="size-4 text-emerald-400" aria-hidden />;
    case 'taken':     return <X className="size-4 text-destructive" aria-hidden />;
    case 'invalid':   return <AlertCircle className="size-4 text-destructive" aria-hidden />;
    case 'error':     return <AlertCircle className="size-4 text-amber-400" aria-hidden />;
    default:          return null;
  }
}

function classesForStatus(s: FieldStatus) {
  switch (s) {
    case 'checking':
      return 'border-zinc-600 focus-visible:border-zinc-600 focus-visible:ring-zinc-400/30 focus-visible:ring-[3px]';
    case 'available':
      return 'border-emerald-700 focus-visible:border-emerald-700 focus-visible:ring-emerald-500/30 focus-visible:ring-[3px]';
    case 'taken':
    case 'invalid':
      return 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30 focus-visible:ring-[3px]';
    case 'error':
      return 'border-amber-600 focus-visible:border-amber-600 focus-visible:ring-amber-500/30 focus-visible:ring-[3px]';
    case 'idle':
    default:
      return 'border-zinc-700 focus-visible:border-zinc-600 focus-visible:ring-zinc-500/30 focus-visible:ring-[3px]';
  }
}

export default function InputWithStatus({
  status,
  className,
  hideHint = false,
  describedById,
  hintChecking = 'Checking availability…',
  hintAvailable = 'Username available',
  hintTaken = 'That username is already taken',
  hintInvalid = 'Invalid username',
  hintError = "Couldn't check availability. Try again.",
  hintIdle = '',
  ...rest
}: Props) {
  const hintText =
    status === 'checking' ? hintChecking :
    status === 'available' ? hintAvailable :
    status === 'taken' ? hintTaken :
    status === 'invalid' ? hintInvalid :
    status === 'error' ? hintError :
    hintIdle;

  const ariaInvalid = status === 'invalid' || status === 'taken';


  return (
    <>
      <div className="relative">
        <Input
          aria-invalid={ariaInvalid}
          aria-describedby={describedById}
          className={cn(
            'text-white placeholder:text-zinc-500 pr-10',
            'aria-invalid:focus-visible:ring-[3px] aria-invalid:focus-visible:ring-destructive/30',
            'transition-[border-color,box-shadow] duration-300 ease-in',
            classesForStatus(status),
            className
          )}
          {...rest}
        />

        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center leading-none" aria-hidden>
          <StatusIcon status={status} />
        </span>
      </div>

      {/* Hint message its positioned in the same level as the "FormMessage" below this componente */}
      {!hideHint && hintText ? (
        <p
          id={describedById?.split(' ')[0] ?? undefined}
          data-testid="input-status-hint"
          aria-live="polite"
          className={cn('text-sm', hintColor[status])}
        >
          {hintText}
        </p>
      ) : describedById ? (
        <span id={describedById?.split(' ')[0]} className="sr-only" aria-live="polite" />
      ) : null}
    </>
  );
}
