import type { GroupStatus, TripPhase } from "./types";

/**
 * The single rule for which state a trip is in. Shared by server and client
 * so a countdown hitting zero flips the UI the same way the server would.
 */
export function derivePhase(status: GroupStatus, deadline: string, nowMs: number): TripPhase {
  if (status === "decided") return "decided";
  if (status === "locked") return "locked";
  return nowMs > Date.parse(deadline) ? "expired" : "collecting";
}
