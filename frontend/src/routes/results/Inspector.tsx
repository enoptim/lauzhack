import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import AnimatedNumber from './AnimatedNumber';
import { chfShort, pricePerKwh } from './format';
import { whatIfDetails, whatIfLabels } from './labels';
import { num, Segmented, SectionLabel } from './parts';
import { WHAT_IFS, type WhatIf } from './useEngine';
import { PRICE_MAX, PRICE_MIN, TIMINGS, TODAY_PRICE, type ResultsModel, type Timing } from './useResultsModel';

/**
 * The right column: the assumptions behind every plan, like a design tool's properties panel.
 * Most used first, so the whole column fits on a laptop screen. An orange dot marks what differs from today.
 */

const round2 = (value: number) => Math.round(value * 100) / 100;
/** Where the slider thumb's centre sits for a value: radix keeps the 16px thumb inside the track. */
const thumbLeft = (value: number) => `calc(8px + ${(value - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)} * (100% - 16px))`;

function timingHint(timing: Timing, onPlan: boolean) {
  if (timing === 'now') return 'You pay the full price today.';
  if (timing === 'end_of_life') return onPlan ? 'Buy it when the old units wear out or break.' : 'Buy it when the old units break.';
  return `Keep the old units until year ${timing}, then buy it.`;
}

function Divider() {
  return <div aria-hidden="true" className="h-px shrink-0 bg-[var(--r-divider)]" />;
}

function ChangedDot({ changed }: { changed: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full bg-primary transition-opacity duration-200 motion-reduce:transition-none', changed ? 'opacity-100' : 'opacity-0')} />
      {changed && <span className="sr-only">(changed from today)</span>}
    </>
  );
}

/** One assumption: a label with the "changed" dot, the control, and a one-line hint. */
function Row({ label, labelId, htmlFor, changed, hint, inline, aside, children }: {
  label: string; labelId?: string; htmlFor?: string; changed: boolean; hint?: ReactNode; inline?: boolean; aside?: ReactNode; children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex shrink-0 flex-col gap-1.5 py-2.5">
      <div className={cn('flex items-center justify-between gap-3', !inline && 'h-5')}>
        <Label id={labelId} htmlFor={htmlFor} className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          {label}
          <ChangedDot changed={changed} />
        </Label>
        {inline ? children : aside}
      </div>
      {!inline && children}
      {hint && <p className="text-xs leading-5 text-pretty text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "What if" choices: toggle buttons, at most one on. Click the one that is on to remove it. */
function WhatIfList({ value, onChange }: { value: WhatIf | null; onChange: (next: WhatIf | null) => void }) {
  return (
    <div role="group" aria-labelledby="inspector-whatif" className="-mx-2 flex flex-col"
      title="Pick one to add it to every future. Click it again to remove it.">
      {WHAT_IFS.map(id => {
        const on = value === id;
        return (
          <button key={id} type="button" aria-pressed={on} aria-describedby={on ? 'whatif-detail' : undefined}
            onClick={() => onChange(on ? null : id)}
            className={cn('group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none',
              'transition-colors duration-150 ease-out hover:bg-[var(--r-track)] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none')}>
            <span aria-hidden="true"
              className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                on ? 'border-primary' : 'border-muted-foreground/60 group-hover:border-muted-foreground')}>
              <span className={cn('size-1.5 rounded-full bg-primary transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
                on ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
            </span>
            <span className={cn(on ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>
              {whatIfLabels[id]}
            </span>
          </button>
        );
      })}
      {/* One fixed two-line slot for the chosen event, so the rows below never move. */}
      <p id="whatif-detail" className="mt-1 line-clamp-2 h-9 px-2 text-xs leading-[18px] text-pretty text-muted-foreground">
        {value ? whatIfDetails[value] : ''}
      </p>
    </div>
  );
}

/** The price slider, built from radix parts so the thumb itself carries the name and the spoken value. */
function PriceSlider({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: () => void }) {
  // Radix compares the release value against a stale copy and can skip the commit, so a pointer release always commits too.
  return (
    <SliderPrimitive.Root min={PRICE_MIN} max={PRICE_MAX} step={0.01} value={[value]}
      onValueChange={([v]) => onChange(round2(v))} onValueCommit={onCommit}
      onPointerUp={onCommit} onLostPointerCapture={onCommit}
      className="relative flex w-full touch-none items-center select-none">
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--r-track)]">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label="Electricity price" aria-valuetext={pricePerKwh(value)}
        className="block size-4 shrink-0 rounded-full border border-primary bg-white shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden motion-reduce:transition-none" />
    </SliderPrimitive.Root>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className={cn(num, 'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-[var(--r-line)] bg-card px-1 font-sans text-xs text-foreground')}>
      {children}
    </kbd>
  );
}

function billsText(saving: number | null, subject: string, noUpgrade = false) {
  if (noUpgrade) return 'Year 1 costs: no change (no upgrade in this plan)';
  if (saving === null) return '';
  if (Math.abs(saving) < 500) return `Year 1 costs: about the same with ${subject}`;
  return `Year 1 costs: ${chfShort(Math.abs(saving))} ${saving >= 0 ? 'lower' : 'higher'} with ${subject}`;
}

export default function Inspector({ m }: { m: ResultsModel }) {
  const saving = m.yearlySaving;
  const priceChanged = m.changed.price;
  const billsLoading = m.engine.runs.loading;

  // The newest slider value, so a release always commits what the slider shows (not a value from an older render).
  const latestPrice = useRef(m.price);
  const dragging = useRef(false);
  function onPriceChange(value: number) {
    latestPrice.current = value;
    dragging.current = true;
    m.setPrice(value);
  }
  function onPriceCommit() {
    if (!dragging.current) return;
    dragging.current = false;
    m.commitPrice(latestPrice.current);
    setReleased(n => n + 1);
  }
  useEffect(() => { if (!dragging.current) latestPrice.current = m.price; }, [m.price]);

  // Screen readers hear the bills once the new numbers are in, not on every step of a drag.
  const [spoken, setSpoken] = useState('');
  const [released, setReleased] = useState(0);
  useEffect(() => {
    if (!billsLoading && !dragging.current) setSpoken(billsText(saving, m.subject, m.chosen.length === 0));
  }, [billsLoading, saving, m.subject, m.chosen.length, released]);

  return (
    <div className="flex h-full min-h-full flex-col px-4">
      {/* Header */}
      <div className="flex shrink-0 flex-col pt-2.5 pb-2">
        <div className="flex h-7 items-center justify-between gap-2">
          <SectionLabel>Assumptions</SectionLabel>
          {m.anyChanged && (
            <Button variant="ghost" size="sm" onClick={m.resetAssumptions}
              className="-mr-2 h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Reset all assumptions to today">
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Reset
            </Button>
          )}
        </div>
        <p className="text-xs leading-4 text-muted-foreground">Change one. Every plan reruns in {m.futuresN} futures.</p>
      </div>

      {/* Electricity price: updates live while dragging */}
      <Divider />
      <Row label="Electricity price" labelId="inspector-price" changed={priceChanged}
        aside={
          <span className="flex items-center gap-1.5">
            <span className={cn(num, 'text-[13px] font-medium text-foreground')} aria-hidden="true">{pricePerKwh(m.price)}</span>
            {priceChanged && (
              <>
                <span aria-hidden="true" className="text-xs text-muted-foreground">·</span>
                <Button variant="link" size="sm" onClick={m.resetPrice} aria-label="Electricity price back to today"
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground">
                  Reset
                </Button>
              </>
            )}
          </span>
        }>
        <div className="relative pt-1 pb-5">
          <PriceSlider value={m.price} onChange={onPriceChange} onCommit={onPriceCommit} />
          <div aria-hidden="true" className="pointer-events-none absolute top-[21px] flex -translate-x-1/2 flex-col items-center"
            style={{ left: thumbLeft(TODAY_PRICE) }}>
            <span className="h-1 w-px bg-muted-foreground/60" />
            <span className="text-xs leading-3 text-muted-foreground">today</span>
          </div>
        </div>
        <p title={billsText(saving, m.subject, m.chosen.length === 0)}
          className={cn('truncate text-xs leading-5 text-muted-foreground transition-opacity duration-150 motion-reduce:transition-none',
            billsLoading && saving !== null ? 'opacity-70' : 'opacity-100')}>
          {m.chosen.length === 0 ? billsText(null, m.subject, true) : saving === null ? 'Working out the costs…' : Math.abs(saving) < 500 ? (
            <>Year 1 costs: about the same with {m.subject}</>
          ) : (
            <>
              Year 1 costs: <AnimatedNumber value={Math.abs(saving)} format={chfShort} ms={250} className={cn(num, 'font-medium text-foreground')} />{' '}
              {saving >= 0 ? 'lower' : 'higher'} with {m.subject}
            </>
          )}
        </p>
        <span className="sr-only" aria-live="polite" aria-atomic="true">{spoken}</span>
      </Row>

      <Divider />
      <Row label="What if the world changes" labelId="inspector-whatif" changed={m.changed.whatIf}>
        <WhatIfList value={m.whatIf} onChange={m.changeWhatIf} />
      </Row>

      <Divider />
      <Row label="Count staff effects" htmlFor="inspector-staff" inline changed={m.changed.staffEffects}
        hint="Better work and fewer sick days: a guess.">
        <Switch id="inspector-staff" checked={m.staffEffects} onCheckedChange={m.changeStaffEffects} />
      </Row>

      {m.chosen.length > 0 && (
        <>
          <Divider />
          <Row label="When to buy" changed={m.changed.timing} hint={timingHint(m.timing, m.onPlan)}>
            <Segmented<Timing> label="When to buy" value={m.timing} onChange={m.changeTiming} className="w-full [&>button]:px-1.5"
              options={TIMINGS.map(t => ({ value: t.value, label: t.short, title: t.label }))} />
          </Row>
        </>
      )}

      <Divider />
      <Row label="Replace old equipment" changed={m.changed.onPlan}
        hint={m.onPlan ? 'Replaced when their normal life ends.' : 'Runs until it breaks. Rush jobs cost 15% more.'}>
        <Segmented label="Replace old equipment" value={m.onPlan ? 'plan' : 'break'} className="w-full"
          onChange={value => m.changeOnPlan(value === 'plan')}
          options={[{ value: 'plan', label: 'On a plan' }, { value: 'break', label: 'When it breaks' }]} />
      </Row>

      <div className="mt-auto flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--r-divider)] py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Kbd>Space</Kbd> Play</span>
        {m.multi && (
          <>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1.5"><Kbd>1</Kbd>–<Kbd>{m.plans.length}</Kbd> Choose a plan</span>
          </>
        )}
      </div>
    </div>
  );
}
