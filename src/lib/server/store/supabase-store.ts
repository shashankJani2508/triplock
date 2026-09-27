import "server-only";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { WeekendId } from "@/lib/config";
import type { MatchResult, PreferenceInput } from "@/lib/types";
import {
  STORE_ERROR_CODES,
  StoreError,
  type GroupSnapshot,
  type Store,
  type SubmitResult,
} from "./types";

/** Maps SQL `raise exception '<code>'` back to a typed StoreError. */
function toError(error: PostgrestError): Error {
  const code = STORE_ERROR_CODES.find((c) => c === error.message);
  if (code) return new StoreError(code);
  return new Error(`Supabase error ${error.code}: ${error.message}`);
}

/**
 * Production store. All rules are enforced by the SQL functions in
 * supabase/schema.sql; this class only calls them. Server-side only: it uses
 * the service-role (secret) key.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // Trip state changes every few seconds; never let Next.js cache these calls.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }

  async createGroup(input: { name: string; deadline: string; participantNames: string[] }): Promise<string> {
    const { data, error } = await this.client.rpc("create_group", {
      p_name: input.name,
      p_deadline: input.deadline,
      p_participants: input.participantNames,
    });
    if (error) throw toError(error);
    return data as string;
  }

  async getSnapshot(groupId: string): Promise<GroupSnapshot | null> {
    const { data, error } = await this.client.rpc("get_group_snapshot", { p_group_id: groupId });
    if (error) throw toError(error);
    return (data as GroupSnapshot | null) ?? null;
  }

  async submit(groupId: string, participantId: string, prefs: PreferenceInput): Promise<SubmitResult> {
    const { data, error } = await this.client.rpc("submit_preferences", {
      p_group_id: groupId,
      p_participant_id: participantId,
      p_budget_band: prefs.budget_band,
      p_free_weekends: prefs.free_weekends,
      p_destination_types: prefs.destination_types,
      p_dealbreakers: prefs.dealbreakers,
      p_origin_city: prefs.origin_city ?? null,
    });
    if (error) throw toError(error);
    return data as SubmitResult;
  }

  async decide(groupId: string, tripId: string, weekendId: WeekendId): Promise<void> {
    const { error } = await this.client.rpc("decide_trip", {
      p_group_id: groupId,
      p_trip_id: tripId,
      p_weekend: weekendId,
    });
    if (error) throw toError(error);
  }

  async claimMatch(groupId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_match", { p_group_id: groupId });
    if (error) throw toError(error);
    return data === true;
  }

  async saveMatch(groupId: string, result: MatchResult): Promise<boolean> {
    const { data, error } = await this.client.rpc("save_match", { p_group_id: groupId, p_result: result });
    if (error) throw toError(error);
    return data === true;
  }

  async extendDeadline(groupId: string, hours: number): Promise<string> {
    const { data, error } = await this.client.rpc("extend_deadline", {
      p_group_id: groupId,
      p_hours: hours,
    });
    if (error) throw toError(error);
    return data as string;
  }
}
