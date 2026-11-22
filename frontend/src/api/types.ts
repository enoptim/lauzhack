// Shapes of the engine API (model/server.py). See model/README.md.
// Every number shown in the UI must come from one of these responses.
// Infinite or undefined numbers (e.g. a payback that never happens) arrive as null.

// ---------------------------------------------------------------- requests
export type Timing = 'now' | 'end_of_life';

/** One swap. Narrow it with floor, room_id or item_id; later swaps win. */
export interface Swap {
  group: string;
  option: string;
  floor?: number;
  room_id?: string;
  item_id?: string;
  timing?: Timing;
  /** Phase the swap in this year instead of now. */
  year?: number;
}

export type Scenario = Swap[];

export interface RunRequest {
  scenario?: Scenario;
  events?: string[];
  overrides?: Record<string, number>;
  /** Year the snapshots describe (1 = first year). */
  year?: number;
}

export interface PreviewRequest {
  scenario?: Scenario;
  swap: Swap;
  events?: string[];
  overrides?: Record<string, number>;
}

export interface FuturesRequest {
  scenarios: Record<string, Scenario>;
  n?: number;
  seed?: number;
  /** Events switched on in every future, on top of the random ones. */
  events?: string[];
  /** Assumptions fixed in every future. */
  overrides?: Record<string, number>;
  /** A played game (session id): its future becomes the first example future, marked pinned. */
  pinned_session?: string;
}

export interface BreakevenRequest {
  scenario?: Scenario;
  events?: string[];
  overrides?: Record<string, number>;
  /** Assumption key to solve for. Default: electricity_price_chf_kwh. */
  param?: string;
}

// ---------------------------------------------------------------- /api/catalog
export interface CatalogOption {
  option_id: string;
  name: string;
  tier: string;
  unit: string;
  price_chf_per_unit: number;
  lifetime_years: number | null;
  power_on_w: number | null;
  description: string;
  source: string;
}

export interface CatalogRoom {
  room_id: string;
  floor: number;
  type: string;
  area_m2: number;
  seats: number;
}

export interface CatalogItem {
  item_id: string;
  room_id: string;
  group: string;
  option_id: string;
  units: number;
  age_years: number | null;
  serves: string;
  /** Floor the item serves (ventilation and plant sit in BC_991.0 or BC_ROOF). */
  serves_floor: number;
}

export interface CatalogEvent {
  event_id: string;
  name: string;
  description: string;
  kind: 'annual' | 'stress_test';
  start_year: number | null;
  end_year: number | null;
}

export interface Catalog {
  groups: Record<string, CatalogOption[]>;
  rooms: CatalogRoom[];
  items: CatalogItem[];
  events: CatalogEvent[];
  horizon_years: number;
  limits: { capex_budget_chf: number; opening_reserve_chf: number; min_reserve_chf: number };
}

// ---------------------------------------------------------------- /api/simulate
/** How to style a number: from data and physics, depends on people effects, or a score (never money). */
export type NumberKind = 'calculated' | 'estimate' | 'index';

export interface NpvBreakdown {
  capex_and_residual: number;
  energy: number;
  pv_export: number;
  maintenance: number;
  consumables: number;
  rent: number;
  productivity: number;
  sick_days: number;
  time_saved: number;
}

export interface Flag {
  /** reserve_below_minimum_without_upgrades is context (doing nothing also runs the reserve low), not a warning about the plan. */
  type: 'ventilation_over_capacity' | 'desk_shortfall' | 'over_budget' | 'reserve_below_minimum'
    | 'reserve_below_minimum_without_upgrades' | string;
  year?: number;
  [detail: string]: unknown;
}

export interface FinanceYear {
  year: number;
  cash_cf: number;
  economic_cf: number;
  cumulative_cash_cf: number;
  cumulative_economic_cf: number;
  cash_closing: number;
  cash_closing_baseline: number;
  capex: number;
  capex_baseline: number;
  /** Only in the last year: value left in the plan's equipment minus the do-nothing path's. */
  residual_value: number;
  operating_cost: number;
  operating_cost_baseline: number;
  kwh: number;
  kwh_baseline: number;
  price_chf_kwh: number;
  staff: number;
  desk_capacity: number;
  people_value: { perf_change: number; productivity_chf: number; sick_days_chf: number; time_saved_chf: number };
  savings: { energy: number; pv_export: number; maintenance: number; consumables: number; rent: number };
  comfort_score: number;
  comfort_score_baseline: number;
  meeting_co2_ppm: number;
  meeting_co2_ppm_baseline: number;
}

export interface Finance {
  npv_cash: number;
  npv_economic: number;
  payback_cash: number | null;
  payback_economic: number | null;
  capex_year0: number;
  npv_breakdown: NpvBreakdown;
  flags: Flag[];
  years: FinanceYear[];
  kind: Record<string, NumberKind>;
}

export interface SnapshotItem {
  room_id: string;
  group: string;
  option_id: string;
  units: number;
  kwh_year: number;
  kw_avg: number;
  kw_on: number;
}

export interface SnapshotRoom {
  kwh_year: number;
  /** 24 values, approximate typical workday load in kW. */
  kw_hourly: number[];
  items: string[];
  // Only for occupied heated rooms:
  co2_ppm?: number;
  people_peak?: number;
  lps_per_person?: number;
  overheat_degc?: number;
}

export interface SnapshotFloor {
  capacity_people: number;
  population_peak: number;
  over_capacity: boolean;
}

export interface Outcomes {
  perf_index: number;
  perf_losses: Record<string, number>;
  sick_days: number;
  coffee_minutes_per_day: number;
  comfort_score: number;
  office_co2_ppm: number;
  meeting_co2_ppm: number;
  classroom_co2_ppm: number;
  office_lps_per_person: number;
  summer_overheating_degc: number;
  lighting_quality: number;
  screen_quality: number;
  glare_control: number;
  eye_strain: number;
  [other: string]: number | Record<string, number>;
}

export interface SnapshotBuilding {
  kwh_year: number;
  grid_kwh_year: number;
  pv_kwh_year: number;
  kwh_by_group: Record<string, number>;
  costs_chf: { energy: number; pv_export: number; maintenance: number; consumables: number; rent: number };
  outcomes: Outcomes;
  desk_capacity: number;
  desk_shortfall: number;
  staff: number;
}

/** State of the building in one year, keyed by room_id / item_id (the mesh names). */
export interface Snapshot {
  year: number;
  items: Record<string, SnapshotItem>;
  rooms: Record<string, SnapshotRoom>;
  /** Keyed by floor number as a string ("-1" … "4"). */
  floors: Record<string, SnapshotFloor>;
  building: SnapshotBuilding;
}

export interface SimulateResult {
  finance: Finance;
  snapshot: Snapshot;
  snapshot_baseline: Snapshot;
}

// ---------------------------------------------------------------- /api/preview
export interface PreviewResult {
  swap: Swap;
  extra_capex_year0: number;
  delta_npv_cash: number;
  delta_npv_economic: number;
  delta_kwh_year1: number;
  delta_perf_change: number;
  delta_comfort: number;
  delta_meeting_co2_ppm: number;
  new_flags: Flag[];
}

// ---------------------------------------------------------------- /api/stress_test
export interface StressHour {
  hour: number;
  people: number;
  co2_ppm: number;
  over_capacity: boolean;
}

export interface StressTestResult {
  ventilation_running: boolean;
  capacity_people: number;
  peak_people: number;
  peak_co2_ppm: number;
  hours_over_capacity_per_day: number;
  hours: StressHour[];
}

// ---------------------------------------------------------------- /api/tornado, /api/bands
export interface TornadoRow {
  parameter: string;
  low: number;
  high: number;
  at_low: number;
  at_high: number;
  swing: number;
}

export interface TornadoResult {
  central: number;
  rows: TornadoRow[];
}

export interface BandsResult {
  weak: number;
  central: number;
  strong: number;
}

// ---------------------------------------------------------------- /api/futures
export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface FanPoint extends Percentiles {
  year: number;
}

export interface FuturesSummary {
  npv_cash: Percentiles;
  npv_economic: Percentiles;
  prob_cash_positive: number;
  prob_economic_positive: number;
  payback_cash_p50: number | null;
  prob_no_cash_payback: number;
  flag_probability: Record<string, number>;
  /** Cumulative money vs doing nothing per year. `_running` leaves out the value of equipment left at the end. */
  fan: { cash: FanPoint[]; economic: FanPoint[]; cash_running: FanPoint[]; economic_running: FanPoint[] };
  /** Payback year in a good (p10), middle (p50) and bad (p90) future; null = not within the horizon. */
  payback_range: { p10: number | null; p50: number | null; p90: number | null };
  prob_paid_back_by_year: { year: number; share: number }[];
  /** Average over all futures of each part of the discounted 15-year value. */
  npv_breakdown_mean: NpvBreakdown;
  npv_cash_mean: number;
  /** Chance of at least one emergency breakdown of the equipment the plan touches, by year, with the plan and doing nothing. */
  risk: { emergency_by_year: { year: number; plan: number; nothing: number }[]; emergency_chf_mean: number; emergency_chf_mean_baseline: number };
  /** Money vs doing nothing today, before year 1: minus the purchase price. */
  start: number;
  npv_economic_mean: number;
}

export type FuturePathView = 'cash' | 'economic' | 'cash_running' | 'economic_running';

/** Old units that fail in one year of one future, for one equipment group. */
export interface FutureFailure {
  year: number;
  group: string;
  rows: number;
  units: number;
  cost: number;
  floors: number[];
}

/** One example future, replayable: what happened, and each plan's cumulative money per year. */
export interface FutureSample {
  /** "pinned" for the future the player played (see FuturesRequest.pinned_session). */
  id: number | 'pinned';
  pinned?: boolean;
  what_happened: string;
  failures: FutureFailure[];
  events: { id: string; start_year: number; end_year: number | null }[];
  paths: Record<string, Record<FuturePathView, number[]> & { start: number }>;
}

export interface FutureStory {
  run: number;
  what_happened: string;
  npv_economic: number;
}

export interface FuturesResult {
  n: number;
  seed: number;
  summary: Record<string, FuturesSummary>;
  /** Keyed "A vs B": share of futures where A beats B. */
  compare: Record<string, { prob_better_cash: number; prob_better_economic: number }>;
  stories: { bad: FutureStory; typical: FutureStory; good: FutureStory };
  /** About 20 futures from bad to good, in a fixed shuffled order. */
  samples: FutureSample[];
  method: string;
}

// ---------------------------------------------------------------- /api/assumptions
/** fact: EPFL plans. research: a cited study. guess: our estimate or design choice. result: derived from other numbers. */
export type AssumptionLabel = 'fact' | 'research' | 'guess' | 'result';

export interface Assumption {
  key: string;
  value: number;
  low: number;
  high: number;
  unit: string;
  category: string;
  source: string;
  description: string;
  label: AssumptionLabel;
}

// ---------------------------------------------------------------- /api/breakeven
export interface BreakevenPoint {
  /** Value of the assumption where NPV = 0; null if the plan always or never pays off in the search range. */
  value: number | null;
  pays_off: 'above' | 'below' | 'always' | 'never';
  npv_at_current?: number;
}

export interface BreakevenResult {
  param: string;
  current: number;
  search_range: [number, number];
  npv_cash: BreakevenPoint;
  npv_economic: BreakevenPoint;
}

// ---------------------------------------------------------------- /api/chat (chat/README.md)
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** The whole conversation so far; the server keeps no state. */
  messages: ChatMessage[];
  /** The scenario the app shows right now, so the assistant can build on it. */
  scenario?: Scenario;
  /** A proposal's problem the user confirmed: the server runs the optimizer on exactly this, then the assistant explains. */
  confirm?: OptimizationProblem;
  /** What the user is looking at in the app, in words, so the assistant can resolve "this" and "here". */
  context?: string;
  /** The plans in the app, so the assistant can remove them when asked. */
  plans?: { id: number; name: string; changes: number; source: 'you' | 'assistant' }[];
}

/** What the assistant said about its scenario. Money in CHF, today vs the scenario in year 1. */
export interface ChatScenarioSummary {
  energy_bill_chf_month: { today: number; scenario: number };
  energy_bill_saving_chf_year: number;
  energy_bill_saving_pct: number;
  electricity_kwh_year: { today: number; scenario: number };
  electricity_saving_pct: number;
  running_cost_saving_chf_year: number;
  upfront_cost_chf: number;
  extra_cost_vs_like_for_like_chf: number;
  payback_years: number | null;
  payback_years_with_people_effects: number | null;
  simple_roi_pct_per_year: number | null;
  horizon_years: number;
  npv_chf: number;
  people_effects_chf: number;
  people_and_air_year_1: Record<string, { today: number; scenario: number }>;
  flags: Flag[];
  changed_items: number;
  changed_floors: number[];
}

export interface ChatScenario {
  title: string;
  /** Ready for /api/simulate. */
  scenario: Scenario;
  events: string[];
  /** Mesh names of the items that change, to highlight in 3D. */
  item_ids: string[];
  summary: ChatScenarioSummary;
}

export interface ChatProposal {
  /** Already checked and filled in: relative limits are absolute (from_change_pct keeps the %), warnings <= 0 added. */
  problem: OptimizationProblem;
  /** Today's value (doing nothing) of the goal and of each limited metric. */
  today: Partial<Record<MetricName, number | null>>;
}

export interface ChatOptimization {
  problem: OptimizationProblem;
  all_limits_met: boolean;
  limits_missed: Evaluation['violations'];
}

export interface ChatResult {
  /** Markdown. */
  reply: string;
  /** Set when the assistant picked a scenario to show: the last one, if it showed several. */
  scenario: ChatScenario | null;
  /** Every plan the assistant showed in this reply, in order. The app draws a card for each. */
  scenarios?: ChatScenario[];
  /** Plans the assistant removed (ids from the request's plans). The app removes them and offers an undo. */
  removed_plan_ids?: number[];
  /** The goal and limits the assistant proposes, for the user to confirm or correct. Nothing has run yet. */
  proposal: ChatProposal | null;
  /** After a confirmed run: the problem and whether the plan meets every limit. */
  optimization: ChatOptimization | null;
  /** Set when the assistant compared packages (upgrade_tradeoffs): cost against saving, to plot. */
  chart?: ChatChart | null;
}

/** One line of /api/chat/stream: what the assistant is doing right now. */
export type ChatEvent =
  /** The next piece of the model's thinking. */
  | { type: 'thinking'; text: string }
  /** The next piece of the model's written reply. */
  | { type: 'text'; text: string }
  /** A job in the building model starts, e.g. rank_upgrades or optimize. */
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; seconds: number }
  /** Sent every 10 s while nothing else happens, so a silent line means the server is gone. */
  | { type: 'ping' }
  | { type: 'done'; result: ChatResult }
  | { type: 'error'; message: string };

export interface ChatChartPoint {
  x: number;
  y: number;
  /** The changes in words, e.g. "LED tube retrofit (floors 1, 2), Rooftop solar panels", or "Do nothing". */
  label: string;
  scenario: Scenario;
}

/** Up-front cost (x) against yearly saving (y). Every point is a package no other package beats on both. */
export interface ChatChart {
  type: 'pareto';
  x_metric: string;
  y_metric: string;
  x_label: string;
  y_label: string;
  /** Sorted by x. */
  points: ChatChartPoint[];
  /** The balanced choice: past it, each extra franc buys less saving. */
  knee_index: number;
}

// ---------------------------------------------------------------- /api/metrics, /api/optimize, /api/evaluate
// The problem format and the solver interface are documented in model/optimize.py.
export type MetricName =
  | 'upfront_cost_chf' | 'extra_cost_vs_like_for_like_chf' | 'running_cost_chf_year' | 'energy_bill_chf_year'
  | 'electricity_kwh_year' | 'npv_cash_chf' | 'npv_economic_chf' | 'payback_years' | 'lowest_reserve_chf'
  | 'office_co2_ppm' | 'meeting_co2_ppm' | 'classroom_co2_ppm' | 'summer_overheating_degc' | 'sick_days'
  | 'comfort_score' | 'warnings' | 'new_warnings';

export interface Metric {
  metric: MetricName;
  unit: string;
  /** The natural direction: 'min' means lower is better. */
  sense: 'min' | 'max';
  kind: NumberKind;
  description: string;
}

export interface ProblemConstraint {
  metric: MetricName;
  max?: number;
  min?: number;
  /** Relative to doing nothing, e.g. -20 = at least 20% lower. Turned into max/min by the server. */
  max_change_pct?: number;
  min_change_pct?: number;
  /** Set by the server when it turned a *_change_pct into max/min, so the % can still be shown. */
  from_change_pct?: number;
}

export interface OptimizationProblem {
  objective: { metric: MetricName; sense?: 'min' | 'max' };
  constraints?: ProblemConstraint[];
  /** Keep as today. Leave out floor to lock the whole group. */
  locked?: { group: string; floor?: number }[];
  /** Per group, the only options the plan may use. */
  allowed?: Record<string, string[]>;
  per_floor?: boolean;
  /** By default a plan may not cause warnings. */
  allow_warnings?: boolean;
  events?: string[];
}

export interface Evaluation {
  scenario: Scenario;
  /** Money and energy are yearly averages over the horizon; air and comfort are year 1. payback_years is null if never. */
  metrics: Record<MetricName, number | null>;
  violations: ({ metric: MetricName; value: number | null; max?: number; min?: number })[];
  feasible: boolean;
  /** Lower is better (max metrics are negated). */
  objective: number;
  /** objective plus a large penalty for missed limits. */
  score: number;
  flags: Flag[];
}

export interface OptimizeResult {
  /** The problem after defaults and relative limits were filled in. */
  problem: OptimizationProblem;
  best: Evaluation;
  /** Doing nothing, for comparison. */
  today: Evaluation;
  solver: string;
  evaluations: number;
  decisions: number;
  seconds: number;
}

// ---------------------------------------------------------------- /api/search, /api/pareto: the search behind optimize.py (model/README.md)
/** Picks zones (one group in one place). floor and option narrow it; a list means any of them. */
export interface ZoneSelector {
  group: string;
  floor?: number | number[];
  option?: string | string[];
}

/** Hard limits on what may change. */
export interface SearchScope {
  /** If given, only these may change. */
  allowed?: ZoneSelector[];
  /** These stay as they are. */
  locked?: ZoneSelector[];
  /** These must change. */
  required?: ZoneSelector[];
  /** Never install these option ids. */
  excluded_options?: string[];
}

/** A metric name from GET /api/search/options, with a lower and/or upper limit. */
export interface MetricConstraint {
  metric: string;
  min?: number;
  max?: number;
}

export interface SearchObjective {
  metric: string;
  /** Default: the metric's "better" direction. */
  sense?: 'min' | 'max';
}

export type Granularity = 'floor' | 'building';

export interface SearchRequest {
  goal: 'min_cost_for_target' | 'max_savings' | 'min_total_cost' | 'custom';
  /** min_cost_for_target (the metric to reach) and max_savings (the metric to maximize). */
  metric?: string;
  /** min_cost_for_target. */
  target?: number;
  /** The most the plan may cost, in cost_metric (min_total_cost: up-front cost). */
  budget?: number;
  cost_metric?: string;
  /** min_total_cost: the timeframe. */
  years?: number;
  /** min_total_cost: lowest CHF or lowest kWh. */
  basis?: 'chf' | 'kwh';
  /** custom. */
  objective?: SearchObjective;
  constraints?: MetricConstraint[];
  scope?: SearchScope;
  events?: string[];
  overrides?: Record<string, number>;
  granularity?: Granularity;
  horizon_years?: number;
  discounted?: boolean;
  include_residual?: boolean;
  /** Default true: also return the regular /api/simulate output for the plan. */
  include_engine_output?: boolean;
}

export interface ParetoRequest {
  /** Minimized. Default upfront_cost_chf. */
  x_metric?: string;
  /** Maximized. Default operating_cost_saving_chf_year. */
  y_metric?: string;
  constraints?: MetricConstraint[];
  scope?: SearchScope;
  events?: string[];
  overrides?: Record<string, number>;
  granularity?: Granularity;
  horizon_years?: number;
  discounted?: boolean;
  include_residual?: boolean;
  /** Default 15; null keeps every point. */
  max_points?: number | null;
}

export interface MetricInfo {
  unit: string;
  better: 'lower' | 'higher';
  description: string;
}

/** One decision: which option one group has in one place. */
export interface SearchZone {
  /** e.g. "lighting@2", or the group name for one-place groups. */
  zone: string;
  group: string;
  floor: number | null;
  current_option: string;
  /** The alternatives. */
  options: string[];
  units: number;
  item_ids: string[];
}

export interface SearchOptions {
  metrics: Record<string, MetricInfo>;
  zones: SearchZone[];
}

export interface SearchChange {
  zone: string;
  group: string;
  floor: number | null;
  from_option: string;
  to_option: string;
  from_name: string;
  to_name: string;
  units: number;
  upfront_cost_chf: number;
  /** Mesh names, to highlight in 3D. */
  item_ids: string[];
}

export interface SearchSettings {
  granularity: Granularity;
  horizon_years: number;
  discounted: boolean;
  include_residual: boolean;
  events: string[];
  overrides: Record<string, number>;
}

export interface SearchInfo {
  evaluations: number;
  seconds: number;
  zones: number;
  method: string;
}

export interface SearchResult {
  /** best_effort: no plan meets every constraint; this is the closest one. */
  status: 'ok' | 'best_effort';
  /** One plain sentence, e.g. why a target is out of reach. */
  message: string;
  objective: { metric: string; sense: 'min' | 'max'; value: number | null };
  /** value is what the plan achieves. */
  constraints: (MetricConstraint & { value: number | null; met: boolean })[];
  /** Ready for /api/simulate; [] = do nothing. */
  scenario: Scenario;
  changes: SearchChange[];
  /** Every zone's option after the plan. */
  configuration: Record<string, string>;
  /** Every metric for the plan; null where it doesn't apply (e.g. a payback that never happens). */
  metrics: Record<string, number | null>;
  /** Doing nothing. */
  baseline: Record<string, number | null>;
  flags: Flag[];
  settings: SearchSettings;
  /** The /api/simulate output for the plan; null when include_engine_output is false. */
  engine: SimulateResult | null;
  search: SearchInfo;
}

export interface ParetoPoint {
  x: number;
  y: number;
  scenario: Scenario;
  changes: SearchChange[];
  metrics: Record<string, number | null>;
}

export interface ParetoResult {
  x_metric: string;
  y_metric: string;
  /** Sorted by x. The first is doing nothing unless the scope forbids it. */
  points: ParetoPoint[];
  /** The balanced choice. */
  knee_index: number;
  /** Points before thinning to max_points. */
  total_non_dominated: number;
  baseline: Record<string, number | null>;
  settings: SearchSettings;
  search: SearchInfo;
}

// ---------------------------------------------------------------- /api/session (play through one future)
// See model/README.md, "Play through one future". Time t is the end of year t; a change for year k is
// bought at the end of year k and works from year k + 1.

/** A change in play mode. "now" means the current pause; the server stores it as a number with firm: true. */
export type PlaySwap = Omit<Swap, 'year' | 'timing'> & { year: number | 'now'; firm?: boolean };
/** A change as the server stores it. */
export type SessionSwap = Omit<Swap, 'year' | 'timing'> & { year: number; firm: true };

export interface PauseReason {
  type: 'failure' | 'event_announced' | 'event_started' | 'new_flag' | 'price_jump';
  time: number;
  /** Plain words, e.g. "Ventilation on the ground floor reached end of life (9 modules)". */
  title: string;
  group: string | null;
  floors: number[];
  item_ids: string[];
  details: Record<string, unknown>;
}

/** What adding swaps would change, in this future with the plan so far. */
export interface SessionPreview {
  swaps: SessionSwap[];
  year: number;
  extra_capex_chf: number;
  delta_npv_cash: number;
  delta_npv_economic: number;
  new_flags: Flag[];
  /** From here on: the first year the change works (missing if it would come after the last year). */
  first_active_year?: number;
  delta_kwh?: number;
  delta_operating_cost?: number;
  delta_comfort?: number;
  delta_meeting_co2_ppm?: number;
  delta_perf_change?: number;
}

export interface ReplacementOption {
  option_id: string;
  name: string;
  tier: string;
  /** The same model again: what happens if the player just continues. */
  like_for_like: boolean;
  swaps: SessionSwap[];
  preview: SessionPreview;
}

/** Something broke: every option for the broken items, at this moment. */
export interface FailureReaction {
  reason: number;
  type: 'failure';
  group: string;
  options: ReplacementOption[];
  /** Changes still planned for these items later; choosing now replaces them. */
  planned_later: SessionSwap[];
}

/** News, a warning or a price jump: equipment groups worth a look. */
export interface GroupReaction {
  reason: number;
  type: Exclude<PauseReason['type'], 'failure'>;
  groups: { group: string; floor: number | null; options: string[] }[];
}

export interface SessionResult {
  npv_cash: number;
  npv_economic: number;
  payback_cash: number | null;
  payback_economic: number | null;
  npv_breakdown: NpvBreakdown;
  flags: Flag[];
  reserve_at_end: number;
  reserve_at_end_doing_nothing: number;
  decisions: number;
}

export interface SessionState {
  session_id: string;
  t: number;
  horizon: number;
  ended: boolean;
  future: string | null;
  reasons: PauseReason[];
  decisions: SessionSwap[];
  /** done: before now, locked. planned: now or later, can still change. */
  plan: { done: SessionSwap[]; planned: SessionSwap[] };
  /** Years 1 to t only: the future is never sent. */
  history: FinanceYear[];
  snapshot: Snapshot;
  reactions: (FailureReaction | GroupReaction)[];
  /** Structured facts for an LLM to narrate. */
  situation: Record<string, unknown>;
  /** Only when ended. */
  result?: SessionResult;
}

export interface ScriptedFuture {
  name: string;
  description: string;
}

export interface SessionOutlook {
  t: number;
  n: number;
  seed: number;
  fan: { cash: FanPoint[]; economic: FanPoint[] };
  npv_cash: Percentiles;
  npv_economic: Percentiles;
  prob_beats_doing_nothing_cash: number;
  prob_beats_doing_nothing_economic: number;
  method: string;
}
