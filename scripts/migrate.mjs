/**
 * Applies supabase/schema.sql before `next build`, so a new deployment always
 * has its tables, lock rules and functions in place. No manual SQL step.
 *
 * Runs only when a Postgres connection string is present (Vercel's Neon and
 * Supabase integrations provide one). Locally, without one, it does nothing and the app
 * uses its local file store. The schema is idempotent, so re-running is safe.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

// Prefer direct (unpooled) connections for schema changes.
const raw =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  "";

if (!raw) {
  console.log("[migrate] No Postgres URL set; skipping schema migration.");
  process.exit(0);
}

// pg lets `sslmode` in the URL override the ssl option below and treats
// `require` as full certificate verification, which rejects Supabase's own CA.
// Drop it and request an encrypted connection explicitly (plain TCP only for
// `sslmode=disable`, e.g. a local test server).
let connectionString = raw;
let sslmode = null;
try {
  const url = new URL(raw);
  sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  connectionString = url.toString();
} catch {
  // Not a WHATWG-parseable URL; use it as-is.
}

const sql = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const client = new pg.Client({
  connectionString,
  ssl: sslmode === "disable" ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

try {
  await client.connect();
  await client.query(sql);
  console.log("[migrate] Database schema is up to date.");
} catch (error) {
  // Never print the connection string: it contains the database password.
  console.error(`[migrate] Failed to apply supabase/schema.sql: ${error.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
