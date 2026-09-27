import "server-only";
import path from "node:path";
import { FileStore } from "./file-store";
import { SupabaseStore } from "./supabase-store";
import { StoreError, type Store } from "./types";

let store: Store | undefined;

/**
 * Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set; otherwise a
 * local JSON file for development. On Vercel a missing Supabase config is an
 * error rather than a silent fallback, because serverless disks don't persist.
 */
export function getStore(): Store {
  if (store) return store;

  // Also accepts the NEXT_PUBLIC_ URL variant and Supabase's newer "secret key" name.
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim();

  if (url && key) {
    store = new SupabaseStore(url, key);
  } else if (process.env.VERCEL) {
    throw new StoreError(
      "storage_not_configured",
      "Connect Supabase to the Vercel project (or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).",
    );
  } else {
    store = new FileStore(path.join(process.cwd(), ".data", "triplock.json"));
  }
  return store;
}

export { StoreError } from "./types";
export type { Store } from "./types";
