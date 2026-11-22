import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Long explanations stay folded so the page shows numbers, not paragraphs. A small link opens them in place.
 * Native <details>, so it works with the keyboard and screen readers without extra state.
 */
export function Fold({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <details className={cn('group text-[13px] leading-5 text-muted-foreground', className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        {label}
      </summary>
      <div className="mt-1.5 flex max-w-[70ch] flex-col gap-1 text-pretty">{children}</div>
    </details>
  );
}
