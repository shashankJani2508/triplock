/**
 * Deterministic matching engine.
 *
 * Input: the group's anonymous preference submissions (no names).
 * Output: group-level consensus + 2–3 trip options. Same input → same output.
 *
 * Order of operations:
 *   1. Hard filters — a trip is removed if it triggers ANY submitted
 *      dealbreaker (a veto, never averaged away), is out of reach for someone's
 *      budget (2+ bands above their comfortable max), or has no weekend that
 *      at least all-but-one of the group can make.
 *   2. Overlap — each survivor gets a score from date overlap, budget comfort
 *      and destination-type alignment, minus a small travel-effort penalty.
 *   3. Rank — survivors are bucketed into plain-language tiers (no fake
 *      percentages), ranked, and 2–3 distinct options are picked.
 */

import {
  BUDGET_BANDS,
  DEALBREAKER_IDS,
  DESTINATION_TYPES,
  WEEKENDS,
  budgetBand,
  dealbreaker,
  destinationType,
  weekend,
  type BudgetBandId,
  type DealbreakerId,
  type DestinationTypeId,
  type WeekendId,
} from "./config";
import { TRAVEL_LABELS, TRIPS } from "./catalog";
import { joinWords } from "./format";
import type {
  ConsensusItem,
  FitTier,
  MatchResult,
  PreferenceInput,
  Trip,
  TripOption,
} from "./types";

export const WEIGHTS = { dates: 0.35, budget: 0.25, preference: 0.4 } as const;
const TRAVEL_PENALTY = { short: 0, medium: 0.02, long: 0.08 } as const;
/** How satisfied someone is when a trip's secondary (not main) type is theirs. */
const SECONDARY_TYPE_SATISFACTION = 0.6;
/** Options in the same tier this close in score are presented as even. */
export const EVEN_MATCH_EPSILON = 0.03;
const MAX_OPTIONS = 3;

export const TIER_LABELS: Record<FitTier, string> = {
  strong: "Strong group fit",
  good: "Good group fit",
  compromise: "Some compromise",
};

const TIER_ORDER: Record<FitTier, number> = { strong: 0, good: 1, compromise: 2 };
const TRAVEL_ORDER = { short: 0, medium: 1, long: 2 } as const;

export type Elimination = "dealbreaker" | "budget" | "dates";
export type CompromiseKind = "dates" | "budget" | "preference" | "travel";

// ---------------------------------------------------------------------------
// Group profile — the aggregate view the engine reasons over
// ---------------------------------------------------------------------------

export interface GroupProfile {
  size: number;
  weekendCounts: Map<WeekendId, number>;
  commonWeekends: WeekendId[];
  /** Rank of the lowest "most I'm comfortable spending" band in the group. */
  budgetCeilingRank: number;
  typeCounts: Map<DestinationTypeId, number>;
  /** Types with the highest count (the group's strongest preference). */
  topTypes: DestinationTypeId[];
  vetoes: Set<DealbreakerId>;
  /** How many people may miss a weekend before a trip stops being a group trip. */
  allowedDateMisses: number;
}

function rankOf(id: BudgetBandId): number {
  return budgetBand(id).rank;
}

export function profileGroup(prefs: PreferenceInput[]): GroupProfile {
  const size = prefs.length;
  if (size === 0) throw new Error("Matching needs at least one submission");

  const weekendCounts = new Map<WeekendId, number>();
  for (const w of WEEKENDS) weekendCounts.set(w.id, 0);
  const typeCounts = new Map<DestinationTypeId, number>();
  for (const t of DESTINATION_TYPES) typeCounts.set(t.id, 0);
  const vetoes = new Set<DealbreakerId>();
  let budgetCeilingRank = Infinity;

  for (const p of prefs) {
    for (const w of new Set(p.free_weekends)) {
      weekendCounts.set(w, (weekendCounts.get(w) ?? 0) + 1);
    }
    for (const t of new Set(p.destination_types)) {
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    for (const d of p.dealbreakers) vetoes.add(d);
    budgetCeilingRank = Math.min(budgetCeilingRank, rankOf(p.budget_band));
  }

  const maxTypeCount = Math.max(...typeCounts.values());
  const topTypes = DESTINATION_TYPES.map((t) => t.id).filter(
    (id) => maxTypeCount > 0 && typeCounts.get(id) === maxTypeCount,
  );

  return {
    size,
    weekendCounts,
    commonWeekends: WEEKENDS.map((w) => w.id).filter((id) => weekendCounts.get(id) === size),
    budgetCeilingRank,
    typeCounts,
    topTypes,
    vetoes,
    allowedDateMisses: size >= 4 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Per-trip evaluation
// ---------------------------------------------------------------------------

export interface TripEvaluation {
  trip: Trip;
  catalogIndex: number;
  eliminated: Elimination | null;
  triggeredDealbreakers: DealbreakerId[];
  weekendId: WeekendId | null;
  dateCount: number;
  budgetCount: number;
  preferenceCount: number;
  preferenceScore: number;
  score: number;
  compromises: CompromiseKind[];
  tier: FitTier | null;
}

function tierFor(score: number, compromises: CompromiseKind[]): FitTier {
  if (compromises.length === 0 && score >= 0.8) return "strong";
  if (!compromises.includes("dates") && compromises.length <= 1 && score >= 0.65) return "good";
  return "compromise";
}

export function evaluateTrip(
  trip: Trip,
  catalogIndex: number,
  prefs: PreferenceInput[],
  profile: GroupProfile,
): TripEvaluation {
  const N = profile.size;
  const base: TripEvaluation = {
    trip,
    catalogIndex,
    eliminated: null,
    triggeredDealbreakers: [],
    weekendId: null,
    dateCount: 0,
    budgetCount: 0,
    preferenceCount: 0,
    preferenceScore: 0,
    score: 0,
    compromises: [],
    tier: null,
  };

  // Rule 1 — dealbreakers are vetoes.
  const triggered = trip.dealbreaker_conflicts.filter((d) => profile.vetoes.has(d));
  if (triggered.length > 0) {
    return { ...base, eliminated: "dealbreaker", triggeredDealbreakers: triggered };
  }

  // Budget out of reach: two or more bands above someone's comfortable max.
  const costRank = rankOf(trip.estimated_cost_band);
  if (costRank > profile.budgetCeilingRank + 1) {
    return { ...base, eliminated: "budget" };
  }

  // Dates: the trip's best weekend is the one most of the group can make
  // (ties go to the earliest weekend, since WEEKENDS is in calendar order).
  let weekendId: WeekendId | null = null;
  let dateCount = -1;
  for (const w of WEEKENDS) {
    if (!trip.available_weekends.includes(w.id)) continue;
    const count = profile.weekendCounts.get(w.id) ?? 0;
    if (count > dateCount) {
      dateCount = count;
      weekendId = w.id;
    }
  }
  if (weekendId === null || dateCount < N - profile.allowedDateMisses) {
    return { ...base, eliminated: "dates", weekendId, dateCount: Math.max(dateCount, 0) };
  }

  // Rule 2 — overlap.
  const budgetCount = prefs.filter((p) => rankOf(p.budget_band) >= costRank).length;

  const [primary, ...secondary] = trip.types;
  let satisfactionSum = 0;
  let preferenceCount = 0;
  for (const p of prefs) {
    const wants = new Set(p.destination_types);
    const satisfaction = wants.has(primary)
      ? 1
      : secondary.some((t) => wants.has(t))
        ? SECONDARY_TYPE_SATISFACTION
        : 0;
    satisfactionSum += satisfaction;
    if (satisfaction > 0) preferenceCount += 1;
  }
  const preferenceScore = satisfactionSum / N;

  const raw =
    WEIGHTS.dates * (dateCount / N) +
    WEIGHTS.budget * (budgetCount / N) +
    WEIGHTS.preference * preferenceScore -
    TRAVEL_PENALTY[trip.travel];
  // Round away float noise so ordering is stable and explainable.
  const score = Math.round(raw * 10000) / 10000;

  const compromises: CompromiseKind[] = [];
  if (dateCount < N) compromises.push("dates");
  if (budgetCount < N) compromises.push("budget");
  if (preferenceCount < Math.ceil(N * 0.75)) compromises.push("preference");
  if (trip.travel === "long") compromises.push("travel");

  return {
    ...base,
    weekendId,
    dateCount,
    budgetCount,
    preferenceCount,
    preferenceScore,
    score,
    compromises,
    tier: tierFor(score, compromises),
  };
}

// ---------------------------------------------------------------------------
// Rule 3 — rank and pick 2–3 distinct options
// ---------------------------------------------------------------------------

export function rankViable(evaluations: TripEvaluation[]): TripEvaluation[] {
  return evaluations
    .filter((e) => e.eliminated === null)
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier!] - TIER_ORDER[b.tier!] ||
        b.score - a.score ||
        TRAVEL_ORDER[a.trip.travel] - TRAVEL_ORDER[b.trip.travel] ||
        rankOf(a.trip.estimated_cost_band) - rankOf(b.trip.estimated_cost_band) ||
        a.catalogIndex - b.catalogIndex,
    );
}

/**
 * Picks up to three options, best tier first. Within a tier it prefers
 * options with a different main character and region, so the group gets a
 * real choice instead of three versions of the same beach. A lower tier is
 * only used once the better tier is exhausted.
 */
export function selectOptions(ranked: TripEvaluation[]): TripEvaluation[] {
  const picks: TripEvaluation[] = [];
  const usedRegions = new Set<string>();
  const usedPrimary = new Set<DestinationTypeId>();
  const take = (e: TripEvaluation) => {
    picks.push(e);
    usedRegions.add(e.trip.region);
    usedPrimary.add(e.trip.types[0]);
  };

  for (const tier of ["strong", "good", "compromise"] as FitTier[]) {
    const inTier = ranked.filter((e) => e.tier === tier);
    for (const e of inTier) {
      if (picks.length >= MAX_OPTIONS) break;
      if (usedRegions.has(e.trip.region) || usedPrimary.has(e.trip.types[0])) continue;
      take(e);
    }
    for (const e of inTier) {
      if (picks.length >= MAX_OPTIONS) break;
      if (picks.includes(e) || usedRegions.has(e.trip.region)) continue;
      take(e);
    }
    if (picks.length >= MAX_OPTIONS) break;
  }

  return picks.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
}

// ---------------------------------------------------------------------------
// Plain-language output
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const BUDGET_STATEMENTS: Record<BudgetBandId, string> = {
  under_10k: "Everyone is comfortable under ₹10,000 per person",
  "10k_15k": "Everyone is comfortable up to ₹15,000 per person",
  "15k_20k": "Everyone is comfortable up to ₹20,000 per person",
  "20k_plus": "Everyone is comfortable with ₹20,000+ per person",
};

function buildConsensus(
  profile: GroupProfile,
  evaluations: TripEvaluation[],
  optionCount: number,
): ConsensusItem[] {
  const N = profile.size;
  const majority = Math.ceil(N / 2);
  const items: ConsensusItem[] = [];

  // Budget — the lowest comfortable ceiling protects everyone.
  const ceiling = BUDGET_BANDS[profile.budgetCeilingRank];
  items.push({
    key: "budget",
    label: "Budget",
    statement: BUDGET_STATEMENTS[ceiling.id],
    detail: "Set by the most careful budget in the group, so no one is stretched.",
    status: "agree",
  });

  // Dates
  if (profile.commonWeekends.length > 0) {
    const labels = profile.commonWeekends.map((id) => weekend(id).longLabel);
    items.push({
      key: "dates",
      label: "Dates",
      statement: `${joinWords(labels)} ${labels.length === 1 ? "works" : "work"} for everyone`,
      status: "agree",
    });
  } else {
    let best: WeekendId = WEEKENDS[0].id;
    for (const w of WEEKENDS) {
      if ((profile.weekendCounts.get(w.id) ?? 0) > (profile.weekendCounts.get(best) ?? 0)) best = w.id;
    }
    const bestCount = profile.weekendCounts.get(best) ?? 0;
    items.push({
      key: "dates",
      label: "Dates",
      statement: `No weekend works for all ${N} of you`,
      detail:
        bestCount === N - 1
          ? `${weekend(best).longLabel} works for all but one of you.`
          : `The closest is ${weekend(best).longLabel}.`,
      status: "partial",
    });
  }

  // Destination type
  const ranked = DESTINATION_TYPES.map((t) => ({ id: t.id, count: profile.typeCounts.get(t.id) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count); // stable: ties keep config order
  const max = ranked[0]?.count ?? 0;
  const everyone = ranked.filter((t) => t.count === N).map((t) => t.id);
  if (everyone.length > 0) {
    const words = everyone.map((id) => destinationType(id).adjective);
    items.push({
      key: "destination",
      label: "Destination",
      statement: `Everyone is up for ${joinWords(words)} destinations`,
      status: "agree",
    });
  } else {
    let top = ranked.filter((t) => t.count === max).slice(0, 3);
    if (top.length === 1 && ranked[1] && ranked[1].count >= majority) top = [ranked[0], ranked[1]];
    const words = joinWords(top.map((t) => destinationType(t.id).adjective));
    items.push(
      max >= majority
        ? {
            key: "destination",
            label: "Destination",
            statement: `${capitalize(words)} destinations have the strongest overlap`,
            status: "agree",
          }
        : {
            key: "destination",
            label: "Destination",
            statement: "Destination preferences are spread out",
            detail: `${capitalize(words)} destinations have the most overlap.`,
            status: "partial",
          },
    );
  }

  // Dealbreakers
  const ruledOut = evaluations.filter((e) => e.eliminated === "dealbreaker").length;
  if (profile.vetoes.size === 0) {
    items.push({
      key: "dealbreakers",
      label: "Dealbreakers",
      statement: "No dealbreakers were submitted",
      status: "agree",
    });
  } else {
    const what = joinWords(
      [...profile.vetoes]
        .sort((a, b) => DEALBREAKER_IDS.indexOf(a) - DEALBREAKER_IDS.indexOf(b))
        .map((id) => dealbreaker(id).ruledOut),
    );
    items.push({
      key: "dealbreakers",
      label: "Dealbreakers",
      statement:
        optionCount > 0
          ? "None of your options triggers a submitted dealbreaker"
          : "Every hard no was applied as a veto",
      detail: `Ruled out ${ruledOut} ${ruledOut === 1 ? "trip" : "trips"} involving ${what}.`,
      status: "agree",
    });
  }

  return items;
}

function describeOption(
  e: TripEvaluation,
  letter: string,
  profile: GroupProfile,
): TripOption {
  const N = profile.size;
  const trip = e.trip;
  const wk = weekend(e.weekendId!);
  const costRank = rankOf(trip.estimated_cost_band);
  const highlights: string[] = [];
  const compromises: string[] = [];

  if (e.dateCount === N) highlights.push(`Everyone is free ${wk.longLabel}`);
  if (e.budgetCount === N) {
    highlights.push(
      costRank < profile.budgetCeilingRank
        ? "Comfortably inside everyone's budget"
        : "Fits the group's budget range",
    );
  }
  if (profile.topTypes.includes(trip.types[0])) {
    highlights.push(
      `Matches the strongest destination preference (${destinationType(trip.types[0]).adjective})`,
    );
  } else if (e.preferenceCount === N) {
    highlights.push("A preferred trip type for everyone");
  } else if (!e.compromises.includes("preference")) {
    highlights.push("A preferred trip type for most of you");
  }
  highlights.push("No dealbreakers triggered");
  if (trip.travel === "short") highlights.push(`Easy to reach: ${trip.travel_note.toLowerCase()}`);

  for (const c of e.compromises) {
    if (c === "dates") compromises.push(`one of you would need to move plans for ${wk.label}`);
    if (c === "budget") compromises.push("a stretch on budget for some of you");
    if (c === "preference") compromises.push("not a preferred trip type for some of you");
    if (c === "travel") compromises.push(`higher travel time (${trip.travel_note.toLowerCase()})`);
  }

  return {
    letter,
    tripId: trip.id,
    destination: trip.destination,
    description: trip.description,
    tags: trip.tags,
    typeLabels: trip.types.map((t) => destinationType(t).label),
    costLabel: `${budgetBand(trip.estimated_cost_band).label} per person`,
    travelLabel: `${TRAVEL_LABELS[trip.travel]} · ${trip.travel_note}`,
    weekendId: wk.id,
    weekendLabel: wk.longLabel,
    tier: e.tier!,
    tierLabel: TIER_LABELS[e.tier!],
    highlights,
    compromises,
    evenWith: [],
  };
}

function headlineFor(options: TripOption[]): string {
  if (options.length === 0) return "No trip works for everyone yet";
  if (options.length === 1) return "Your group has one workable option";
  const adjective = options.every((o) => o.tier === "strong")
    ? "strong"
    : options.every((o) => o.tier !== "compromise")
      ? "good"
      : "workable";
  return `Your group has ${options.length} ${adjective} options`;
}

function noOptionsReason(profile: GroupProfile, evaluations: TripEvaluation[]): string {
  const needed = profile.size - profile.allowedDateMisses;
  const bestDateCount = Math.max(...profile.weekendCounts.values());
  if (bestDateCount < needed) {
    return `Your free weekends don't overlap enough: no weekend works for at least ${needed} of you.`;
  }
  const notVetoed = evaluations.filter((e) => e.eliminated !== "dealbreaker");
  if (notVetoed.length > 0 && notVetoed.every((e) => e.eliminated === "budget")) {
    return "The trips that clear everyone's dealbreakers are out of reach for the group's budget.";
  }
  if (notVetoed.length === 0) {
    return "Every trip in the catalog triggers at least one submitted dealbreaker.";
  }
  return "No trip clears everyone's dealbreakers, budget and dates at the same time.";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function evaluateAll(prefs: PreferenceInput[], catalog: Trip[] = TRIPS) {
  const profile = profileGroup(prefs);
  const evaluations = catalog.map((trip, i) => evaluateTrip(trip, i, prefs, profile));
  return { profile, evaluations };
}

export function runMatching(prefs: PreferenceInput[], catalog: Trip[] = TRIPS): MatchResult {
  const { profile, evaluations } = evaluateAll(prefs, catalog);
  const ranked = rankViable(evaluations);
  const picks = selectOptions(ranked);

  const letters = ["A", "B", "C"];
  const options = picks.map((e, i) => describeOption(e, letters[i], profile));
  for (let i = 0; i < picks.length; i++) {
    for (let j = 0; j < picks.length; j++) {
      if (
        i !== j &&
        picks[i].tier === picks[j].tier &&
        Math.abs(picks[i].score - picks[j].score) <= EVEN_MATCH_EPSILON
      ) {
        options[i].evenWith.push(options[j].letter);
      }
    }
  }

  const count = (reason: Elimination) => evaluations.filter((e) => e.eliminated === reason).length;

  return {
    headline: headlineFor(options),
    subhead:
      options.length > 0
        ? "We compared everyone's submitted preferences and found the strongest areas of overlap."
        : noOptionsReason(profile, evaluations),
    consensus: buildConsensus(profile, evaluations, options.length),
    options,
    funnel: {
      checked: catalog.length,
      ruledOutByDealbreakers: count("dealbreaker"),
      ruledOutByBudget: count("budget"),
      ruledOutByDates: count("dates"),
      viable: ranked.length,
    },
    ...(options.length === 0 ? { noOptionsReason: noOptionsReason(profile, evaluations) } : {}),
  };
}
