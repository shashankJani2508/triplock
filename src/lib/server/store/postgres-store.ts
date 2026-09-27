import "server-only";
import pg from "pg";
import type { WeekendId } from "@/lib/config";
import type { MatchResult, PreferenceInput } from "@/lib/types";
import {
  STORE_ERROR_CODES,
  StoreError,
  type GroupSnapshot,
  type Store,
  type SubmitResult,
} from "./types";

/**
 * pg lets `sslmode` in the URL override the `ssl` option, so drop it (and
 * libpq-only params) and set TLS explicitly: verified certificates by default
 * (Neon uses publicly trusted ones), plain TCP only for `sslmode=disable`.
 */
function poolConfig(url: string): pg.PoolConfig {
  let connectionString = url;
  let sslmode: string | null = null;
  try {
    const parsed = new URL(url);
    sslmode = parsed.searchParams.get("sslmode");
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("channel_binding");
    connectionString = parsed.toString();
  } catch {
    // Not a WHATWG-parseable URL; hand it to pg unchanged.
  }
  return {
    connectionString,
    ssl: sslmode === "disable" ? false : { rejectUnauthorized: true },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}

/** Maps SQL `raise exception '<code>'` back to a typed StoreError. */
function toError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = STORE_ERROR_CODES.find((c) => c === message);
  if (code) return new StoreError(code);
  return error instanceof Error ? error : new Error(message);
}

/**
 * Direct Postgres store (Neon or any Postgres). Calls the same SQL functions
 * as the Supabase store, so every lock rule is still enforced in the database.
 */
export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool(poolConfig(url));
  }

  private async one<T>(sql: string, params: unknown[]): Promise<T> {
    try {
      const { rows } = await this.pool.query<{ r: T }>(sql, params);
      return rows[0]?.r as T;
    } catch (error) {
      throw toError(error);
    }
  }

  createGroup(input: { name: string; deadline: string; participantNames: string[] }): Promise<string> {
    return this.one<string>("select public.create_group($1, $2, $3) as r", [
      input.name,
      input.deadline,
      input.participantNames,
    ]);
  }

  async getSnapshot(groupId: string): Promise<GroupSnapshot | null> {
    return (await this.one<GroupSnapshot | null>("select public.get_group_snapshot($1) as r", [groupId])) ?? null;
  }

  submit(groupId: string, participantId: string, prefs: PreferenceInput): Promise<SubmitResult> {
    return this.one<SubmitResult>("select public.submit_preferences($1, $2, $3, $4, $5, $6, $7) as r", [
      groupId,
      participantId,
      prefs.budget_band,
      prefs.free_weekends,
      prefs.destination_types,
      prefs.dealbreakers,
      prefs.origin_city ?? null,
    ]);
  }

  async decide(groupId: string, tripId: string, weekendId: WeekendId): Promise<void> {
    await this.one<null>("select public.decide_trip($1, $2, $3) as r", [groupId, tripId, weekendId]);
  }

  async claimMatch(groupId: string): Promise<boolean> {
    return (await this.one<boolean>("select public.claim_match($1) as r", [groupId])) === true;
  }

  async saveMatch(groupId: string, result: MatchResult): Promise<boolean> {
    return (
      (await this.one<boolean>("select public.save_match($1, $2::jsonb) as r", [groupId, JSON.stringify(result)])) ===
      true
    );
  }

  async extendDeadline(groupId: string, hours: number): Promise<string> {
    const deadline = await this.one<Date | string>("select public.extend_deadline($1, $2) as r", [groupId, hours]);
    return new Date(deadline).toISOString();
  }
}
