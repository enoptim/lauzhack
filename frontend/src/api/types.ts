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
  fan: { cash: FanPoint[]; economic: FanPoint[] };
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

export interface ChatResult {
  /** Markdown. */
  reply: string;
  /** Set when the assistant picked a scenario to show. */
  scenario: ChatScenario | null;
}
