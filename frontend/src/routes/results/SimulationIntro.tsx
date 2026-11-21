import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import PixelBuddy from './PixelBuddy';

const STEP_MS = 520;

type Props = {
  /** One plain line per change, e.g. "Ventilation → New AHUs with heat recovery". */
  changes: string[];
  /** True once the engine has answered; the screen waits for it after the last step. */
  ready: boolean;
  onDone: () => void;
};

/** A short full-screen moment between the building and the results: Tom says what the twin is doing, step by step. */
export default function SimulationIntro({ changes, ready, onDone }: Props) {
  const steps = [
    'Loading building BC: 377 rooms, 5 floors',
    changes.length ? `Swapping in your ${changes.length === 1 ? 'change' : `${changes.length} changes`}` : 'Keeping today’s setup',
    'Running 15 years of energy, comfort and money',
    'Comparing with doing nothing',
  ];
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (step < steps.length) {
      const next = setTimeout(() => setStep(step + 1), reduced ? 120 : STEP_MS);
      return () => clearTimeout(next);
    }
    if (!ready) return;
    setLeaving(true);
    const done = setTimeout(onDone, reduced ? 0 : 450);
    return () => clearTimeout(done);
  }, [step, ready, steps.length, reduced, onDone]);

  const saying = step < steps.length ? `${steps[step]}…` : ready ? 'Done. Here is what changes.' : 'Almost there…';

  return (
    <div role="status" aria-live="polite"
      className={cn('fixed inset-0 z-50 grid place-items-center bg-background px-6 transition-[opacity,filter] duration-500 ease-out',
        leaving && 'pointer-events-none opacity-0 blur-sm')}>
      <div className="flex w-full max-w-lg flex-col gap-8">
        <div className="flex items-center gap-6">
          <PixelBuddy className="w-32 shrink-0 sm:w-36" />
          {/* Fixed size, so the text can change without moving anything around it. */}
          <p className="flex h-20 flex-1 items-center gap-2.5 rounded-2xl rounded-bl-sm border bg-card px-4 text-base shadow-[0_8px_24px_-12px_oklch(0.3_0.02_60/0.25)]">
            <Spinner className={cn('size-4 shrink-0 text-primary', leaving && 'invisible')} />
            <span className="line-clamp-2">{saying}</span>
          </p>
        </div>

        <ol className="flex flex-col gap-3 pl-1">
          {steps.map((label, index) => {
            const done = index < step;
            return (
              <li key={label} className={cn('flex items-start gap-3 text-sm transition-[opacity,translate] duration-300 ease-out',
                index > step && 'translate-y-1 opacity-30')}>
                <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                  done ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                  {done && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className={cn(done || index === step ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
                  {index === 1 && changes.slice(0, 3).map(change => (
                    <span key={change} className="text-muted-foreground">{change}</span>
                  ))}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-sm text-muted-foreground">The building is real. The numbers are our assumptions.</p>
      </div>
    </div>
  );
}
