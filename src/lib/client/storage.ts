"use client";

import { useSyncExternalStore } from "react";

/*
 * Per-device conveniences only (which name this device submitted as, the last
 * trip opened, whether the matching animation was already shown). Nothing
 * that matters for the group decision is stored in the browser.
 */

type Area = "local" | "session";
const CHANGE_EVENT = "triplock:storage";

function area(which: Area): Storage | null {
  try {
    return which === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // blocked storage (private mode, disabled cookies)
  }
}

export function readStored(which: Area, key: string): string | null {
  try {
    return area(which)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(which: Area, key: string, value: string): void {
  try {
    area(which)?.setItem(key, value);
  } catch {
    // Storage full or blocked: the app still works, it just won't remember.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** Reads a stored string; null on the server, during hydration, or if unset. */
export function useStored(which: Area, key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readStored(which, key),
    () => null,
  );
}

export const storageKeys = {
  me: (tripId: string) => `triplock:me:${tripId}`,
  lastTrip: "triplock:last-trip",
  matchingSeen: (tripId: string) => `triplock:matching-seen:${tripId}`,
};
