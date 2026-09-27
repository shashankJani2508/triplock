import type { BudgetBandId, DealbreakerId, DestinationTypeId, WeekendId } from "./config";

// ---------------------------------------------------------------------------
// Stored records (mirror supabase/schema.sql)
// ---------------------------------------------------------------------------

/** open → collecting preferences; locked → everyone submitted; decided → trip locked. */
export type GroupStatus = "open" | "locked" | "decided";

export interface GroupRecord {
  id: string;
  name: string;
  deadline: string; // ISO timestamp
  status: GroupStatus;
  selected_trip_id: string | null;
  selected_weekend: WeekendId | null;
  locked_at: string | null;
  decided_at: string | null;
  created_at: string;
  /** Saved once when the group locks (absent on rows created before AI matching). */
  match_result?: MatchResult | null;
  match_claimed_at?: string | null;
}

export interface ParticipantRecord {
  id: string;
  group_id: string;
  name: string;
  position: number;
}

export interface PreferenceInput {
  budget_band: BudgetBandId;
  free_weekends: WeekendId[];
  destination_types: DestinationTypeId[];
  dealbreakers: DealbreakerId[];
  /** Home city; null on submissions made before the question existed. */
  origin_city?: string | null;
}

export interface SubmissionRecord extends PreferenceInput {
  participant_id: string;
  group_id: string;
  submitted_at: string;
  /** Set on insert: a participant's answers are locked the moment they submit. */
  locked_at: string;
}

// ---------------------------------------------------------------------------
// Trip catalog
// ---------------------------------------------------------------------------

export type TravelEffort = "short" | "medium" | "long";

export interface Trip {
  id: string;
  destination: string;
  /** Used to avoid offering two near-identical options (e.g. North + South Goa). */
  region: string;
  /** First entry is the trip's main character. */
  types: DestinationTypeId[];
  estimated_cost_band: BudgetBandId;
  travel: TravelEffort;
  travel_note: string;
  available_weekends: WeekendId[];
  tags: string[];
  dealbreaker_conflicts: DealbreakerId[];
  description: string;
}

// ---------------------------------------------------------------------------
// Matching output — group-level only, never per-person answers
// ---------------------------------------------------------------------------

export type FitTier = "strong" | "good" | "compromise";

export type Standing = "great" | "okay" | "stretch";

/** How one option works for one person (the brief asks for this per option). */
export interface PersonStanding {
  name: string;
  standing: Standing;
  note: string;
}

export interface ConsensusItem {
  key: "budget" | "dates" | "destination" | "dealbreakers";
  label: string;
  statement: string;
  detail?: string;
  /** agree = the whole group lines up; partial = the closest overlap, flagged. */
  status: "agree" | "partial";
}

export interface TripOption {
  letter: string;
  tripId: string;
  destination: string;
  description: string;
  tags: string[];
  typeLabels: string[];
  costLabel: string;
  travelLabel: string;
  weekendId: WeekendId;
  weekendLabel: string;
  tier: FitTier;
  tierLabel: string;
  highlights: string[];
  compromises: string[];
  /** Letters of options this one is too close to call against. */
  evenWith: string[];
  people: PersonStanding[];
}

export interface MatchFunnel {
  checked: number;
  ruledOutByDealbreakers: number;
  ruledOutByBudget: number;
  ruledOutByDates: number;
  viable: number;
}

export interface MatchResult {
  /** "ai" = chosen by Gemini; "rules" = the built-in deterministic engine. */
  source: "ai" | "rules";
  headline: string;
  subhead: string;
  consensus: ConsensusItem[];
  options: TripOption[];
  /** Only for the rules engine, which filters a fixed catalog. */
  funnel?: MatchFunnel;
  /** Present only when no trip survives. */
  noOptionsReason?: string;
}

// ---------------------------------------------------------------------------
// Public view of a trip session (what the API and pages share)
// ---------------------------------------------------------------------------

/** collecting/expired are derived from status + deadline; expired = deadline
 *  passed before everyone submitted, so submissions are closed. */
export type TripPhase = "collecting" | "expired" | "locked" | "decided";

export interface TripDecision {
  tripId: string;
  destination: string;
  description: string;
  tags: string[];
  weekendId: WeekendId;
  weekendLabel: string;
  costLabel: string;
  travelLabel: string;
  decidedAt: string;
}

export interface TripView {
  id: string;
  name: string;
  /** Deadline to display (rolling 24h in demo mode; see DEMO_ROLLING_DEADLINE). */
  deadline: string;
  /** True when the shown countdown is the demo's rolling one (the trip won't really close). */
  demoDeadline: boolean;
  createdAt: string;
  lockedAt: string | null;
  phase: TripPhase;
  participants: { id: string; name: string; submitted: boolean }[];
  submittedCount: number;
  total: number;
  /** Server clock at response time, so countdowns can correct for skew. */
  serverNow: string;
  results: MatchResult | null;
  decision: TripDecision | null;
}
