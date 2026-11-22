import { cn } from '@/lib/utils';

/**
 * The twin's mark: building BC seen from above, its offices around the long green atrium.
 * The atrium breathes while the twin is live; while it works (the assistant thinks) a pulse runs around the building.
 */
export default function Mark({ busy = false, offline = false, className }: { busy?: boolean; offline?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cn('size-[22px] shrink-0', className)}>
      <rect x="3.5" y="1.75" width="13" height="16.5" rx="3.25" fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      {busy && (
        <rect x="3.5" y="1.75" width="13" height="16.5" rx="3.25" fill="none" stroke="var(--brand-light-green)"
          strokeWidth="2.5" strokeLinecap="round" pathLength={60} strokeDasharray="9 51" className="twin-orbit" />
      )}
      <rect x="8" y="5.5" width="4" height="9" rx="1.5" className={offline ? 'fill-muted-foreground/40' : 'twin-core fill-brand-mid-green'} />
    </svg>
  );
}
