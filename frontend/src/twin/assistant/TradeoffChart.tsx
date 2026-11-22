// The cost-vs-saving curve the assistant sends when it compares packages: each dot is the best package
// for its price, and the balanced one is ringed. Pick a dot to read what it changes.
import { useId, useState } from 'react';
import type { ChatChart } from '@/api/types';
import { chfShort } from '../format';

const W = 320;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 12 };

export default function TradeoffChart({ chart }: { chart: ChatChart }) {
  const [picked, setPicked] = useState(chart.knee_index);
  const gradient = useId();
  const points = chart.points;
  if (points.length < 2) return null;
  const maxX = Math.max(...points.map(p => p.x), 1);
  const maxY = Math.max(...points.map(p => p.y), 1);
  const x = (v: number) => PAD.left + (v / maxX) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (Math.max(0, v) / maxY) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.at(-1)!.x).toFixed(1)},${H - PAD.bottom} L${x(points[0].x).toFixed(1)},${H - PAD.bottom} Z`;
  const point = points[picked] ?? points[0];
  const unit = chart.y_label.match(/\(([^)]+)\)$/)?.[1] ?? '';

  return (
    <figure className="flex w-full flex-col gap-2 rounded-xl border bg-card p-3">
      <figcaption className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium">Saving a year against what you pay</span>
        <span className="text-muted-foreground">{points.length} packages</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img"
        aria-label={`${chart.y_label} against ${chart.x_label}. The balanced package is ringed.`}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--border)" />
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            {i === chart.knee_index && <circle cx={x(p.x)} cy={y(p.y)} r={7} fill="none" stroke="var(--chart-1)" strokeWidth={1.25} />}
            <circle cx={x(p.x)} cy={y(p.y)} r={i === picked ? 4 : 2.75}
              fill={i === picked ? 'var(--chart-1)' : 'var(--card)'} stroke="var(--chart-1)" strokeWidth={1.5} />
            {/* A larger invisible target, so a dot is easy to pick on a projector. */}
            <circle cx={x(p.x)} cy={y(p.y)} r={11} fill="transparent" className="cursor-pointer"
              onMouseEnter={() => setPicked(i)} onClick={() => setPicked(i)} />
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-muted-foreground text-[11px]">CHF 0</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">{chfShort(maxX)} upfront</text>
      </svg>
      <p className="min-h-10 text-xs text-pretty" aria-live="polite">
        <span className="font-medium tabular-nums">{chfShort(point.x)} upfront, saves {unit.startsWith('CHF') ? chfShort(point.y) : `${Math.round(point.y).toLocaleString('en-US')} ${unit.replace('/year', '')}`} a year.</span>{' '}
        <span className="text-muted-foreground">{picked === chart.knee_index ? 'Balanced: past this, each extra franc buys less saving. ' : ''}{point.label}</span>
      </p>
    </figure>
  );
}
