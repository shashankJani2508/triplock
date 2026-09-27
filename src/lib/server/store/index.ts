import "server-only";
import path from "node:path";
import { FileStore } from "./file-store";
import { PostgresStore } from "./postgres-store";
import { SupabaseStore } from "./supabase-store";
import { StoreError, type Store } from "./types";

let store: Store | undefined;

/**
 * Picks storage from the environment:
 *   1. Supabase — SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   2. Postgres (Neon or any) — DATABASE_URL or POSTGRES_URL
 *   3. Local JSON file — development only
 * On Vercel, missing database config is an error rather than a silent
 * fallback, because serverless disks don't persist.
 */
export function getStore(): Store {
  if (store) return store;

  // Also accepts the NEXT_PUBLIC_ URL variant and Supabase's newer "secret key" name.
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim();
  const postgresUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL)?.trim();

  if (supabaseUrl && supabaseKey) {
    store = new SupabaseStore(supabaseUrl, supabaseKey);
  } else if (postgresUrl) {
    store = new PostgresStore(postgresUrl);
  } else if (process.env.VERCEL) {
    throw new StoreError(
      "storage_not_configured",
      "Connect a database (Neon or Supabase) to the Vercel project, then redeploy.",
    );
  } else {
    store = new FileStore(path.join(process.cwd(), ".data", "triplock.json"));
  }
  return store;
}

export { StoreError } from "./types";
export type { Store } from "./types";
