/**
 * Static product configuration: the fixed demo group and the answer options
 * for the four questions. Everything the form, the matching engine and the
 * database checks agree on lives here.
 */

/** The MVP group. Groups are created from this list, but the rest of the app
 *  reads participants from storage, so the list can become dynamic later. */
export const DEFAULT_PARTICIPANTS = [
  "Riya",
  "Siddharth",
  "Karan",
  "Aisha",
  "Preethi",
] as const;

/** The built-in catalog's estimates assume travel from here (rules fallback). */
export const ORIGIN_CITY = "Bengaluru";

/** Quick picks for "Where are you travelling from?" (any other city can be typed). */
export const HOME_CITIES = [
  "Bengaluru",
  "Mumbai",
  "Delhi",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Kochi",
  "Chandigarh",
  "Lucknow",
] as const;

// ---------------------------------------------------------------------------
// Question 1 — Budget (per person, travel + stay)
// ---------------------------------------------------------------------------

export const BUDGET_BANDS = [
  { id: "under_10k", label: "Under ₹10,000", rank: 0 },
  { id: "10k_15k", label: "₹10,000–₹15,000", rank: 1 },
  { id: "15k_20k", label: "₹15,000–₹20,000", rank: 2 },
  { id: "20k_plus", label: "₹20,000+", rank: 3 },
] as const;

export type BudgetBandId = (typeof BUDGET_BANDS)[number]["id"];
export const BUDGET_IDS = BUDGET_BANDS.map((b) => b.id) as [BudgetBandId, ...BudgetBandId[]];

// ---------------------------------------------------------------------------
// Question 2 — Free weekends (Fri–Sun, November 2026)
// ---------------------------------------------------------------------------

export const WEEKENDS = [
  { id: "2026-11-06", label: "6–8 Nov", longLabel: "6–8 November" },
  { id: "2026-11-13", label: "13–15 Nov", longLabel: "13–15 November" },
  { id: "2026-11-20", label: "20–22 Nov", longLabel: "20–22 November" },
  { id: "2026-11-27", label: "27–29 Nov", longLabel: "27–29 November" },
] as const;

export type WeekendId = (typeof WEEKENDS)[number]["id"];
export const WEEKEND_IDS = WEEKENDS.map((w) => w.id) as [WeekendId, ...WeekendId[]];

// ---------------------------------------------------------------------------
// Question 3 — Destination type
// ---------------------------------------------------------------------------

export const DESTINATION_TYPES = [
  { id: "beach", label: "Beach", adjective: "beach" },
  { id: "mountains", label: "Mountains", adjective: "mountain" },
  { id: "nature", label: "Nature", adjective: "nature" },
  { id: "culture", label: "Culture", adjective: "cultural" },
  { id: "adventure", label: "Adventure", adjective: "adventure" },
  { id: "relaxed", label: "Relaxed / Leisure", adjective: "relaxed" },
] as const;

export type DestinationTypeId = (typeof DESTINATION_TYPES)[number]["id"];
export const DESTINATION_TYPE_IDS = DESTINATION_TYPES.map((t) => t.id) as [
  DestinationTypeId,
  ...DestinationTypeId[],
];

// ---------------------------------------------------------------------------
// Question 4 — Dealbreakers (hard noes: any match removes the trip)
// ---------------------------------------------------------------------------

export const DEALBREAKERS = [
  {
    id: "no_trekking",
    label: "No trekking",
    detail: "Removes trips built around a trek",
    ruledOut: "trekking",
  },
  {
    id: "no_nightlife",
    label: "No nightlife-heavy trip",
    detail: "Removes party-focused trips",
    ruledOut: "nightlife-heavy plans",
  },
  {
    id: "no_expensive",
    label: "No very expensive trip",
    detail: "Removes trips at ₹20,000+ per person",
    ruledOut: "very expensive trips",
  },
] as const;

export type DealbreakerId = (typeof DEALBREAKERS)[number]["id"];
export const DEALBREAKER_IDS = DEALBREAKERS.map((d) => d.id) as [DealbreakerId, ...DealbreakerId[]];

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** Preferences close this long after a trip is started. */
export const DEADLINE_HOURS = 24;
/**
 * Demo mode: whenever someone opens a trip it shows "closes in 24 hours", but
 * trips don't actually close, so a reviewer can walk the whole flow at any
 * time. The deadline is still enforced; it's just DEMO_DEADLINE_DAYS away.
 * Set to false for real use: trips then close DEADLINE_HOURS after they start.
 */
export const DEMO_ROLLING_DEADLINE = true;
export const DEMO_DEADLINE_DAYS = 365;
/** How far ahead a custom deadline may be set through the API. */
export const MAX_DEADLINE_DAYS = 14;
/** Extension granted when a deadline passes before everyone submitted. */
export const DEADLINE_EXTENSION_HOURS = 24;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function budgetBand(id: BudgetBandId) {
  return BUDGET_BANDS.find((b) => b.id === id)!;
}

export function weekend(id: WeekendId) {
  return WEEKENDS.find((w) => w.id === id)!;
}

export function destinationType(id: DestinationTypeId) {
  return DESTINATION_TYPES.find((t) => t.id === id)!;
}

export function dealbreaker(id: DealbreakerId) {
  return DEALBREAKERS.find((d) => d.id === id)!;
}
