import "server-only";
import { TRAVEL_LABELS, findTrip } from "@/lib/catalog";
import {
  BUDGET_BANDS,
  DEADLINE_EXTENSION_HOURS,
  DEADLINE_HOURS,
  DEFAULT_PARTICIPANTS,
  DEMO_DEADLINE_DAYS,
  DEMO_ROLLING_DEADLINE,
  MAX_DEADLINE_DAYS,
  WEEKENDS,
} from "@/lib/config";
import { runMatching } from "@/lib/matching";
import { derivePhase } from "@/lib/phase";
import type { GroupRecord, PreferenceInput, SubmissionRecord, TripDecision, TripView } from "@/lib/types";
import { createTripSchema, decisionSchema, isUuid, submissionSchema } from "@/lib/validation";
import { getStore, StoreError, type Store } from "./store";
import type { GroupSnapshot, StoreErrorCode } from "./store/types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ServiceErrorCode = StoreErrorCode | "invalid_input" | "invalid_option";

const ERRORS: Record<ServiceErrorCode, [status: number, message: string]> = {
  invalid_input: [400, "Some answers are missing or invalid."],
  invalid_option: [400, "That trip isn't one of your group's options."],
  invalid_deadline: [400, `Pick a deadline between 1 minute and ${MAX_DEADLINE_DAYS} days from now.`],
  not_found: [404, "This trip doesn't exist."],
  participant_not_found: [404, "That person isn't part of this trip."],
  already_submitted: [409, "These preferences were already submitted. Submissions can't be changed."],
  preferences_locked: [423, "Preferences are locked. Nobody can change their answers now."],
  submission_immutable: [423, "Submissions can't be changed."],
  deadline_passed: [410, "The deadline has passed, so preferences are closed."],
  not_locked: [409, "Options unlock once everyone has submitted."],
  already_decided: [409, "Your group has already locked a decision."],
  decision_locked: [409, "Your group has already locked a decision."],
  not_expired: [409, "The deadline hasn't passed yet."],
  storage_not_configured: [503, "The database isn't connected yet. Connect Neon or Supabase in Vercel, then redeploy."],
};

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

function fail(code: ServiceErrorCode): never {
  const [status, message] = ERRORS[code];
  throw new ServiceError(code, status, message);
}

async function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  try {
    return await fn(getStore());
  } catch (error) {
    if (error instanceof StoreError) fail(error.code);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public view — the only shape that leaves the server. Raw answers stay here.
// ---------------------------------------------------------------------------

function toPreferences(s: SubmissionRecord): PreferenceInput {
  return {
    budget_band: s.budget_band,
    free_weekends: s.free_weekends,
    destination_types: s.destination_types,
    dealbreakers: s.dealbreakers,
  };
}

function buildDecision(group: GroupRecord): TripDecision | null {
  if (group.status !== "decided" || !group.selected_trip_id || !group.selected_weekend) return null;
  const trip = findTrip(group.selected_trip_id);
  const wk = WEEKENDS.find((w) => w.id === group.selected_weekend);
  const band = trip && BUDGET_BANDS.find((b) => b.id === trip.estimated_cost_band);
  return {
    tripId: group.selected_trip_id,
    destination: trip?.destination ?? group.selected_trip_id,
    description: trip?.description ?? "",
    tags: trip?.tags ?? [],
    weekendId: group.selected_weekend,
    weekendLabel: wk?.longLabel ?? group.selected_weekend,
    costLabel: band ? `${band.label} per person` : "",
    travelLabel: trip ? `${TRAVEL_LABELS[trip.travel]} · ${trip.travel_note}` : "",
    decidedAt: group.decided_at ?? "",
  };
}

/**
 * The deadline to show. In demo mode it's a rolling "24 hours from now", but
 * never later than the real one, so a trip that will truly close says so.
 */
function shownDeadline(stored: string, now: number): string {
  const real = Date.parse(stored);
  if (!DEMO_ROLLING_DEADLINE) return new Date(real).toISOString();
  return new Date(Math.min(real, now + DEADLINE_HOURS * 3_600_000)).toISOString();
}

export function buildView({ group, participants, submissions }: GroupSnapshot, now = Date.now()): TripView {
  const submitted = new Set(submissions.map((s) => s.participant_id));
  const matched = group.status !== "open" && submissions.length > 0;
  return {
    id: group.id,
    name: group.name,
    deadline: shownDeadline(group.deadline, now),
    demoDeadline: DEMO_ROLLING_DEADLINE && Date.parse(group.deadline) > now + DEADLINE_HOURS * 3_600_000,
    createdAt: group.created_at,
    lockedAt: group.locked_at,
    phase: derivePhase(group.status, group.deadline, now),
    participants: participants.map((p) => ({ id: p.id, name: p.name, submitted: submitted.has(p.id) })),
    submittedCount: participants.filter((p) => submitted.has(p.id)).length,
    total: participants.length,
    serverNow: new Date(now).toISOString(),
    results: matched ? runMatching(submissions.map(toPreferences)) : null,
    decision: buildDecision(group),
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function getTripView(id: string): Promise<TripView | null> {
  if (!isUuid(id)) return null;
  const snapshot = await withStore((s) => s.getSnapshot(id));
  return snapshot ? buildView(snapshot) : null;
}

async function requireView(id: string): Promise<TripView> {
  const view = await getTripView(id);
  if (!view) fail("not_found");
  return view;
}

export async function createTrip(body: unknown): Promise<string> {
  const parsed = createTripSchema.safeParse(body);
  if (!parsed.success) fail("invalid_input");

  const now = Date.now();
  const defaultDeadline = DEMO_ROLLING_DEADLINE
    ? now + DEMO_DEADLINE_DAYS * 86_400_000
    : now + DEADLINE_HOURS * 3_600_000;
  const deadline = parsed.data.deadline ? Date.parse(parsed.data.deadline) : defaultDeadline;
  if (parsed.data.deadline && (deadline < now + 60_000 || deadline > now + MAX_DEADLINE_DAYS * 86_400_000)) {
    fail("invalid_deadline");
  }

  return withStore((s) =>
    s.createGroup({
      name: parsed.data.name ?? "Our November trip",
      deadline: new Date(deadline).toISOString(),
      participantNames: [...DEFAULT_PARTICIPANTS],
    }),
  );
}

export async function submitPreferences(id: string, body: unknown): Promise<TripView> {
  if (!isUuid(id)) fail("not_found");
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) fail("invalid_input");

  const { participantId, budgetBand, freeWeekends, destinationTypes, dealbreakers } = parsed.data;
  await withStore((s) =>
    s.submit(id, participantId, {
      budget_band: budgetBand,
      free_weekends: freeWeekends,
      destination_types: destinationTypes,
      dealbreakers,
    }),
  );
  return requireView(id);
}

export async function decideTrip(id: string, body: unknown): Promise<TripView> {
  if (!isUuid(id)) fail("not_found");
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) fail("invalid_input");

  const view = await requireView(id);
  if (view.phase === "decided") fail("already_decided");
  if (view.phase !== "locked" || !view.results) fail("not_locked");

  // Only one of the options the engine offered can be chosen.
  const option = view.results.options.find((o) => o.tripId === parsed.data.tripId);
  if (!option) fail("invalid_option");

  await withStore((s) => s.decide(id, option.tripId, option.weekendId));
  return requireView(id);
}

export async function extendTripDeadline(id: string): Promise<TripView> {
  if (!isUuid(id)) fail("not_found");
  await withStore((s) => s.extendDeadline(id, DEADLINE_EXTENSION_HOURS));
  return requireView(id);
}
