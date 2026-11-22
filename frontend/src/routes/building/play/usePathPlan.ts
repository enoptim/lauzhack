// The path you play in Explore is a plan like any other: keep it once, and it follows every move you make.
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTwin } from '@/twin/TwinProvider';
import { MAX_PLANS, PLAN_COLORS } from '@/twin/plans';
import type { Play } from './usePlay';

export function usePathPlan(play: Play, which: string | null) {
  const twin = useTwin();
  const navigate = useNavigate();
  const { state } = play;
  const plan = play.planId != null ? twin.plans.find(p => p.id === play.planId) ?? null : null;
  const decisions = state?.decisions ?? [];
  const name = `Explore · ${which ?? 'my path'}`;
  const onlyEmpty = twin.plans.length === 1 && twin.plans[0].scenario.length === 0 && twin.plans[0].source === 'you';
  const full = !plan && !onlyEmpty && twin.plans.length >= MAX_PLANS;
  const key = JSON.stringify(decisions);

  // Once kept, the plan changes with every decision.
  useEffect(() => {
    if (plan && state) twin.savePath(plan.name, decisions, plan.id);
  }, [key, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(): number | null {
    if (!state || !decisions.length) return null;
    if (plan) return plan.id;
    const id = twin.savePath(name, decisions, null);
    if (id != null) play.linkPlan(id, name);
    return id;
  }

  /** Results, with your path kept as a plan and the future you played shown first. */
  function seeResults() {
    if (!state) return;
    save();
    const config = { plans: [{ name: plan?.name ?? name, scenario: decisions, color: plan?.color ?? PLAN_COLORS[0] }], selected: 0,
                     events: [], game: state.session_id, horizon: state.horizon };
    navigate(`/results?config=${encodeURIComponent(JSON.stringify(config))}`, { state: { intro: true } });
  }

  return { plan, full, save, seeResults, canSave: decisions.length > 0 };
}

export type PathPlan = ReturnType<typeof usePathPlan>;
