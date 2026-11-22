import { useEffect, useRef, useState } from 'react';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that glides to its new value instead of jumping, so the viewer sees it change.
 * `format` turns the in-between values into text; the final text is always `format(value)`.
 */
export default function AnimatedNumber({ value, format, ms = 450, className }: {
  value: number; format: (value: number) => string; ms?: number; className?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const current = useRef(value);

  useEffect(() => {
    if (reducedMotion() || !Number.isFinite(value)) { current.current = value; setShown(value); return; }
    from.current = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      current.current = from.current + (value - from.current) * eased;
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);

  return <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(shown)}</span>;
}
