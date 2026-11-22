import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Small building blocks shared by every part of the Results page, so all parts look like one instrument:
 * hairlines instead of cards, one accent, numbers in mono with even-width digits.
 */

/** A quiet section label: 12px, muted, sentence case. No subtitles. */
export function SectionLabel({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <h2 id={id} className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</h2>;
}

/** Numbers: even-width digits, so columns line up and values don't jitter while they change. */
export const num = 'tabular-nums';

/** A quiet placeholder shown only before the first answer: the panel colour, softly pulsing. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-[var(--r-track)] motion-reduce:animate-none', className)} />;
}

/**
 * A segmented control: 2–4 choices in one track, the chosen one on a white thumb.
 * Keyboard: Tab to the group, arrows move the choice (radio group pattern).
 */
export function Segmented<T extends string | number>({ value, options, onChange, label, size = 'md', className }: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const index = options.findIndex(o => o.value === value);
  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=radio]');
    buttons[(index + step + options.length) % options.length]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      className={cn('inline-flex items-stretch rounded-md bg-[var(--r-track)] p-0.5', size === 'sm' ? 'h-7' : 'h-8', className)}>
      {options.map((option, k) => {
        const on = k === index;
        return (
          <button key={String(option.value)} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} title={option.title}
            onClick={() => onChange(option.value)}
            className={cn('flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-[13px] whitespace-nowrap',
              'transition-[background-color,color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              on ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--r-line),0_1px_2px_oklch(0_0_0/0.06)]'
                : 'text-muted-foreground hover:text-foreground')}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One assumption in the inspector: label on the left, control on the right (or below when `stacked`).
 * `changed` shows a small orange mark: this differs from today's assumptions.
 */
export function PropertyRow({ label, htmlFor, id, changed, hint, stacked, children }: {
  label: ReactNode; htmlFor?: string; id?: string; changed?: boolean; hint?: ReactNode; stacked?: boolean; children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className={cn('flex gap-3', stacked ? 'flex-col' : 'items-center justify-between')}>
        <Label id={id} htmlFor={htmlFor} className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          {label}
          <span aria-hidden="true" className={cn('size-1.5 rounded-full bg-primary transition-opacity duration-200', changed ? 'opacity-100' : 'opacity-0')} />
          {changed && <span className="sr-only">(changed from today)</span>}
        </Label>
        {children}
      </div>
      {hint && <p className="text-xs leading-5 text-pretty text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A plan's colour swatch: a small rounded square. */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-[3px]', className)} style={{ background: color }} />;
}
