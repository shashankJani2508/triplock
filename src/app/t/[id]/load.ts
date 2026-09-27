import "server-only";
import { notFound } from "next/navigation";
import { ServiceError, getTripView } from "@/lib/server/trips";
import type { TripView } from "@/lib/types";

export type LoadedTrip = { view: TripView } | { setupError: true };

/** Loads a trip for a page: 404 when missing, a setup notice when storage isn't configured. */
export async function loadTrip(id: string): Promise<LoadedTrip> {
  try {
    const view = await getTripView(id);
    if (!view) notFound();
    return { view };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "storage_not_configured") return { setupError: true };
    throw error;
  }
}
