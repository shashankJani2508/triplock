"use client";

import { useCallback, useEffect, useState } from "react";
import { derivePhase } from "@/lib/phase";
import type { TripPhase, TripView } from "@/lib/types";
import { api } from "./api";
import { useNow } from "./clock";

const POLL_MS = 4000;
const PHASE_RANK: Record<TripPhase, number> = { collecting: 0, expired: 0, locked: 1, decided: 2 };

/** State only moves forward, so a slow response can never undo a newer one. */
function isNotOlder(next: TripView, current: TripView): boolean {
  const a = PHASE_RANK[next.phase];
  const b = PHASE_RANK[current.phase];
  if (a !== b) return a > b;
  return next.submittedCount >= current.submittedCount;
}

/**
 * Live trip state: starts from the server-rendered view, polls while the
 * group is still moving, and exposes `accept` for mutation responses.
 */
export function useTrip(initial: TripView) {
  const [state, setState] = useState({ view: initial, offset: 0 });

  const accept = useCallback((next: TripView) => {
    const offset = Date.parse(next.serverNow) - Date.now();
    setState((current) => (isNotOlder(next, current.view) ? { view: next, offset } : current));
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await api.getTrip(initial.id));
    } catch {
      // Keep the last known state; the next poll retries.
    }
  }, [accept, initial.id]);

  const done = state.view.phase === "decided";
  useEffect(() => {
    if (done) return;
    const timer = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [done, refresh]);

  // The countdown can cross the deadline between polls: flip locally; the next
  // poll confirms with the server, which enforces the deadline itself.
  const now = useNow();
  const serverNow = now === 0 ? 0 : now + state.offset;
  const phase =
    serverNow === 0 ? state.view.phase : derivePhase(statusOf(state.view), state.view.deadline, serverNow);

  return { view: state.view, phase, serverNow, accept, refresh };
}

function statusOf(view: TripView) {
  return view.phase === "decided" ? "decided" : view.phase === "locked" ? "locked" : "open";
}
