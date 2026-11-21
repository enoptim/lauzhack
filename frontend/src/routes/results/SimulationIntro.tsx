import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const STEP_MS = 520;

type Props = {
  /** One plain line per change, e.g. "Ventilation → New AHUs with heat recovery". */
  changes: string[];
  /** True once the engine has answered; the screen waits for it after the last step. */
  ready: boolean;
  onDone: () => void;
};

/** A short full-screen moment between the building and the results: what the twin is doing, step by step. */
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

  const year = Math.min(15, Math.round((step / steps.length) * 15));

  return (
    <div role="status" aria-live="polite"
      className={cn('fixed inset-0 z-50 grid place-items-center bg-background px-6 transition-[opacity,filter] duration-500 ease-out',
        leaving && 'pointer-events-none opacity-0 blur-sm')}>
      <div className="flex w-full max-w-lg flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Simulating</p>
          <p className="text-5xl font-semibold tracking-tight tabular-nums">{year === 0 ? 'Today' : `Year ${year}`}</p>
        </div>

        <svg viewBox="0 0 400 90" className="w-full overflow-visible" aria-hidden="true">
          <line x1="0" y1="80" x2="400" y2="80" stroke="var(--border)" />
          <path d="M0 10 C 90 12, 120 14, 160 16 S 260 18, 400 18" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round"
            pathLength={1} strokeDasharray="1" strokeDashoffset={1 - step / steps.length}
            className="transition-[stroke-dashoffset] duration-500 ease-out" />
          <path d="M0 80 C 60 76, 80 74, 100 70 L 120 40 C 200 32, 250 28, 280 26 L 300 4 C 340 2, 370 0, 400 -4" fill="none"
            stroke="var(--muted-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"
            pathLength={1} strokeDasharray="1" strokeDashoffset={1 - step / steps.length}
            className="transition-[stroke-dashoffset] duration-500 ease-out" />
        </svg>

        <ol className="flex flex-col gap-3">
          {steps.map((label, index) => {
            const done = index < step;
            const active = index === step || (index === steps.length - 1 && step === steps.length && !ready);
            return (
              <li key={label} className={cn('flex items-start gap-3 text-base transition-[opacity,translate] duration-300 ease-out',
                index > step && 'translate-y-1 opacity-30')}>
                <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                  done && !active ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                  {done && !active ? <Check className="size-3" strokeWidth={3} /> : active ? <Spinner className="size-3" /> : null}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className={cn(done || active ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
                  {index === 1 && done && changes.slice(0, 3).map(change => (
                    <span key={change} className="text-sm text-muted-foreground">{change}</span>
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
