/**
 * Runs supabase/schema.sql against a real Postgres (PGlite, in-process WASM)
 * and exercises the lock rules the app relies on.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PARTICIPANTS } from "../src/lib/config";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
let db: PGlite;

async function newGroup(): Promise<{ groupId: string; participantIds: string[] }> {
  const { rows } = await db.query<{ id: string }>(
    "select public.create_group($1, now() + interval '1 day', $2) as id",
    ["Test trip", [...DEFAULT_PARTICIPANTS]],
  );
  const groupId = rows[0].id;
  const people = await db.query<{ id: string }>(
    "select id from public.participants where group_id = $1 order by position",
    [groupId],
  );
  return { groupId, participantIds: people.rows.map((r) => r.id) };
}

function submit(groupId: string, participantId: string) {
  return db.query<{ r: { submitted: number; total: number; locked: boolean } }>(
    "select public.submit_preferences($1, $2, $3, $4, $5, $6, $7) as r",
    [groupId, participantId, "10k_15k", ["2026-11-13"], ["beach"], ["no_trekking"], "Mumbai"],
  );
}

async function status(groupId: string) {
  const { rows } = await db.query<{ status: string }>("select status from public.groups where id = $1", [
    groupId,
  ]);
  return rows[0].status;
}

beforeAll(async () => {
  db = new PGlite();
  // Roles that exist in every Supabase project.
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(schema);
  // Re-running the schema must be safe.
  await db.exec(schema);
});

describe("supabase/schema.sql", () => {
  it("creates a group with its participants in order", async () => {
    const { groupId, participantIds } = await newGroup();
    expect(participantIds).toHaveLength(5);
    const { rows } = await db.query<{ name: string }>(
      "select name from public.participants where group_id = $1 order by position",
      [groupId],
    );
    expect(rows.map((r) => r.name)).toEqual([...DEFAULT_PARTICIPANTS]);
    expect(await status(groupId)).toBe("open");
  });

  it("locks the group automatically on the fifth submission", async () => {
    const { groupId, participantIds } = await newGroup();
    for (let i = 0; i < 4; i++) {
      const { rows } = await submit(groupId, participantIds[i]);
      expect(rows[0].r).toEqual({ submitted: i + 1, total: 5, locked: false });
    }
    expect(await status(groupId)).toBe("open");
    const { rows } = await submit(groupId, participantIds[4]);
    expect(rows[0].r).toEqual({ submitted: 5, total: 5, locked: true });
    expect(await status(groupId)).toBe("locked");
  });

  it("rejects a duplicate submission (Scenario B)", async () => {
    const { groupId, participantIds } = await newGroup();
    await submit(groupId, participantIds[0]);
    await expect(submit(groupId, participantIds[0])).rejects.toThrow("already_submitted");
  });

  it("rejects submissions and edits after lock (Scenario C)", async () => {
    const { groupId, participantIds } = await newGroup();
    for (const id of participantIds) await submit(groupId, id);
    await expect(submit(groupId, participantIds[0])).rejects.toThrow("preferences_locked");
    await expect(
      db.query("update public.preference_submissions set budget_band = '20k_plus' where participant_id = $1", [
        participantIds[0],
      ]),
    ).rejects.toThrow("submission_immutable");
    await expect(db.query("update public.groups set status = 'open' where id = $1", [groupId])).rejects.toThrow(
      "preferences_locked",
    );
  });

  it("makes submissions write-once even before lock", async () => {
    const { groupId, participantIds } = await newGroup();
    await submit(groupId, participantIds[0]);
    await expect(
      db.query("update public.preference_submissions set dealbreakers = '{}' where participant_id = $1", [
        participantIds[0],
      ]),
    ).rejects.toThrow("submission_immutable");
  });

  it("closes submissions after the deadline and allows an explicit extension", async () => {
    const { groupId, participantIds } = await newGroup();
    await submit(groupId, participantIds[0]);
    await db.query("update public.groups set deadline = now() - interval '1 minute' where id = $1", [groupId]);
    await expect(submit(groupId, participantIds[1])).rejects.toThrow("deadline_passed");

    await db.query("select public.extend_deadline($1, 24)", [groupId]);
    const { rows } = await submit(groupId, participantIds[1]);
    expect(rows[0].r.submitted).toBe(2);
    await expect(db.query("select public.extend_deadline($1, 24)", [groupId])).rejects.toThrow("not_expired");
  });

  it("locks the decision once, and only after preferences lock (Scenario F)", async () => {
    const { groupId, participantIds } = await newGroup();
    await expect(
      db.query("select public.decide_trip($1, 'south-goa', '2026-11-13')", [groupId]),
    ).rejects.toThrow("not_locked");

    for (const id of participantIds) await submit(groupId, id);
    await db.query("select public.decide_trip($1, 'south-goa', '2026-11-13')", [groupId]);
    expect(await status(groupId)).toBe("decided");

    await expect(
      db.query("select public.decide_trip($1, 'coorg', '2026-11-13')", [groupId]),
    ).rejects.toThrow("already_decided");
    await expect(
      db.query("update public.groups set selected_trip_id = 'coorg' where id = $1", [groupId]),
    ).rejects.toThrow("decision_locked");
  });

  it("rejects unknown answer values at the database level", async () => {
    const { groupId, participantIds } = await newGroup();
    await expect(
      db.query("select public.submit_preferences($1, $2, 'free', $3, $4, $5, 'Pune')", [
        groupId,
        participantIds[0],
        ["2026-11-13"],
        ["beach"],
        [],
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.submit_preferences($1, $2, '10k_15k', $3, $4, $5, 'Pune')", [
        groupId,
        participantIds[0],
        ["2026-11-13"],
        ["space"],
        [],
      ]),
    ).rejects.toThrow();
  });

  it("returns a consistent snapshot in the shape the app expects", async () => {
    const { groupId, participantIds } = await newGroup();
    await submit(groupId, participantIds[2]);
    const { rows } = await db.query<{ s: Record<string, unknown> }>(
      "select public.get_group_snapshot($1) as s",
      [groupId],
    );
    const snap = rows[0].s as {
      group: Record<string, unknown>;
      participants: Record<string, unknown>[];
      submissions: Record<string, unknown>[];
    };
    expect(snap.group.id).toBe(groupId);
    expect(snap.group.status).toBe("open");
    expect(typeof snap.group.deadline).toBe("string");
    expect(Number.isNaN(Date.parse(snap.group.deadline as string))).toBe(false);
    expect(snap.participants.map((p) => p.name)).toEqual([...DEFAULT_PARTICIPANTS]);
    expect(snap.submissions).toHaveLength(1);
    expect(snap.submissions[0]).toMatchObject({
      participant_id: participantIds[2],
      group_id: groupId,
      budget_band: "10k_15k",
      free_weekends: ["2026-11-13"],
      destination_types: ["beach"],
      dealbreakers: ["no_trekking"],
    });

    const missing = await db.query<{ s: unknown }>("select public.get_group_snapshot($1) as s", [
      "00000000-0000-4000-8000-000000000000",
    ]);
    expect(missing.rows[0].s).toBeNull();
  });

  it("installs on plain Postgres without Supabase roles (e.g. Neon)", async () => {
    const plain = new PGlite();
    await plain.exec(schema);
    await plain.exec(schema); // idempotent there too
    const { rows } = await plain.query<{ id: string }>(
      "select public.create_group('Neon trip', now() + interval '1 day', $1) as id",
      [[...DEFAULT_PARTICIPANTS]],
    );
    const people = await plain.query<{ id: string }>(
      "select id from public.participants where group_id = $1 order by position",
      [rows[0].id],
    );
    for (const p of people.rows) {
      await plain.query("select public.submit_preferences($1, $2, '10k_15k', $3, $4, $5, 'Delhi')", [
        rows[0].id,
        p.id,
        ["2026-11-13"],
        ["beach"],
        [],
      ]);
    }
    const status = await plain.query<{ status: string }>("select status from public.groups where id = $1", [
      rows[0].id,
    ]);
    expect(status.rows[0].status).toBe("locked");
    await plain.close();
  });

  it("stores each person's home city", async () => {
    const { groupId, participantIds } = await newGroup();
    await submit(groupId, participantIds[0]);
    const { rows } = await db.query<{ origin_city: string }>(
      "select origin_city from public.preference_submissions where participant_id = $1",
      [participantIds[0]],
    );
    expect(rows[0].origin_city).toBe("Mumbai");
  });

  it("computes the match once: one claim at a time, first save wins", async () => {
    const { groupId, participantIds } = await newGroup();
    const claim = async () =>
      (await db.query<{ r: boolean }>("select public.claim_match($1) as r", [groupId])).rows[0].r;
    const save = async (label: string) =>
      (await db.query<{ r: boolean }>("select public.save_match($1, $2::jsonb) as r", [
        groupId,
        JSON.stringify({ label }),
      ])).rows[0].r;

    expect(await claim()).toBe(false); // not locked yet
    for (const id of participantIds) await submit(groupId, id);
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false); // someone is already working on it
    expect(await save("first")).toBe(true);
    expect(await save("second")).toBe(false);
    const snap = await db.query<{ s: { group: { match_result: { label: string } } } }>(
      "select public.get_group_snapshot($1) as s",
      [groupId],
    );
    expect(snap.rows[0].s.group.match_result.label).toBe("first");
    expect(await claim()).toBe(false); // already saved
  });

  it("rejects a participant from another group", async () => {
    const a = await newGroup();
    const b = await newGroup();
    await expect(submit(a.groupId, b.participantIds[0])).rejects.toThrow("participant_not_found");
  });
});
