import type { WeekendId } from "@/lib/config";
import type {
  GroupRecord,
  ParticipantRecord,
  PreferenceInput,
  SubmissionRecord,
} from "@/lib/types";

/** Error codes raised by the stores. Supabase raises the same strings from SQL. */
export type StoreErrorCode =
  | "not_found"
  | "participant_not_found"
  | "already_submitted"
  | "preferences_locked"
  | "deadline_passed"
  | "not_locked"
  | "already_decided"
  | "decision_locked"
  | "not_expired"
  | "invalid_deadline"
  | "submission_immutable"
  | "storage_not_configured";

export const STORE_ERROR_CODES: StoreErrorCode[] = [
  "not_found",
  "participant_not_found",
  "already_submitted",
  "preferences_locked",
  "deadline_passed",
  "not_locked",
  "already_decided",
  "decision_locked",
  "not_expired",
  "invalid_deadline",
  "submission_immutable",
  "storage_not_configured",
];

export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "StoreError";
  }
}

/** Everything stored about one group. Server-only: contains raw answers. */
export interface GroupSnapshot {
  group: GroupRecord;
  participants: ParticipantRecord[];
  submissions: SubmissionRecord[];
}

export interface SubmitResult {
  submitted: number;
  total: number;
  locked: boolean;
}

/**
 * Persistence contract. Every write is atomic and enforces the lock rules
 * itself, so the service layer cannot accidentally bypass them.
 */
export interface Store {
  readonly kind: "supabase" | "file";
  createGroup(input: { name: string; deadline: string; participantNames: string[] }): Promise<string>;
  getSnapshot(groupId: string): Promise<GroupSnapshot | null>;
  /** Write-once. Locks the group when the last participant submits. */
  submit(groupId: string, participantId: string, prefs: PreferenceInput): Promise<SubmitResult>;
  /** First decision wins; the group must be locked and undecided. */
  decide(groupId: string, tripId: string, weekendId: WeekendId): Promise<void>;
  /** Only after the deadline passed without everyone submitting. */
  extendDeadline(groupId: string, hours: number): Promise<string>;
}
