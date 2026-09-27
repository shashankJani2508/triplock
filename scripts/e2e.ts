/**
 * End-to-end check of the full journey against a running server.
 *
 *   npm run test:e2e                          # http://localhost:3000
 *   BASE_URL=https://your-app.vercel.app npm run test:e2e
 *   SKIP_DEADLINE=1 npm run test:e2e          # skip the ~70s deadline test
 *
 * Creates real trips on the target (they're harmless, but they are real rows).
 */
import { TRIPS } from "../src/lib/catalog";
import { DEMO_ROLLING_DEADLINE } from "../src/lib/config";
import type { TripView } from "../src/lib/types";
import { DEMO_PREFERENCES } from "../tests/fixtures";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
let failures = 0;

function check(ok: boolean, label: string, extra?: unknown) {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}`, extra ?? "");
  }
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML page
  }
  return { status: res.status, json: json as Record<string, unknown> & TripView, text };
}

async function createTrip(secondsAhead = 86_400) {
  const res = await call("POST", "/api/groups", { deadline: new Date(Date.now() + secondsAhead * 1000).toISOString() });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
  return (res.json as unknown as { id: string }).id;
}

function body(participantId: string, name: keyof typeof DEMO_PREFERENCES) {
  const p = DEMO_PREFERENCES[name];
  return {
    participantId,
    budgetBand: p.budget_band,
    freeWeekends: p.free_weekends,
    destinationTypes: p.destination_types,
    dealbreakers: p.dealbreakers,
    originCity: p.origin_city ?? "Bengaluru",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Target: ${BASE}\n`);

  // ---------------------------------------------------------------- Default deadline
  console.log("Default deadline");
  const plain = await call("POST", "/api/groups", {});
  const plainView = (await call("GET", `/api/groups/${(plain.json as unknown as { id: string }).id}`)).json;
  const hoursLeft = (Date.parse(plainView.deadline) - Date.now()) / 3_600_000;
  // Within a minute of 24h: allows for clock differences between this machine and the server.
  check(plain.status === 201 && Math.abs(hoursLeft - 24) < 1 / 60, `new trip closes in 24 hours (${hoursLeft.toFixed(2)}h)`);
  if (DEMO_ROLLING_DEADLINE) {
    await new Promise((r) => setTimeout(r, 2500));
    const later = (await call("GET", `/api/groups/${plainView.id}`)).json;
    check(
      Date.parse(later.deadline) > Date.parse(plainView.deadline) && later.phase === "collecting",
      "demo mode: always shows 24 hours left and never closes",
    );
  }

  // ---------------------------------------------------------------- Scenario A
  console.log("\nScenario A — all five submit normally");
  const id = await createTrip();
  let view = (await call("GET", `/api/groups/${id}`)).json;
  check(view.phase === "collecting" && view.submittedCount === 0 && view.total === 5, "starts at 0/5, collecting");
  check(view.results === null, "no results before everyone submits");

  const names = view.participants.map((p) => p.name) as (keyof typeof DEMO_PREFERENCES)[];
  for (let i = 0; i < names.length; i++) {
    const res = await call("POST", `/api/groups/${id}/submissions`, body(view.participants[i].id, names[i]));
    check(res.status === 201, `${names[i]} submits (${i + 1}/5)`, res.text);
    const v = res.json;
    check(v.submittedCount === i + 1, `tracker shows ${i + 1}/5`);
    if (i < 4) check(v.phase === "collecting" && v.results === null, `still open at ${i + 1}/5`);
    view = v;
  }
  check(view.phase === "locked", "5/5 locks preferences automatically");
  // The match is computed once after locking (Gemini can take a few seconds).
  for (const until = Date.now() + 60_000; !view.results && Date.now() < until; ) {
    await sleep(2000);
    view = (await call("GET", `/api/groups/${id}`)).json;
  }
  const source = view.results?.source;
  check(Boolean(view.results), `match computed (${source === "ai" ? "by Gemini" : "by rules"})`);
  const options = view.results?.options ?? [];
  check(options.length >= 2 && options.length <= 3, `matching returns 2–3 options (${options.map((o) => o.destination).join(", ")})`);
  check(view.results?.consensus.length === 4, "consensus covers budget, dates, destination, dealbreakers");
  check(
    options.every((o) => o.people.length === 5 && o.people.every((p) => (names as string[]).includes(p.name))),
    "each option says where each person stands",
  );
  console.log(`    “${view.results?.headline}”`);
  for (const c of view.results?.consensus ?? []) console.log(`    • ${c.label}: ${c.statement}`);

  // Privacy: raw answers never leave the server.
  const fetched = await call("GET", `/api/groups/${id}`);
  check(
    !/budget_band|free_weekends|destination_types|"dealbreakers":\[|submissions/.test(fetched.text),
    "API view contains no raw per-person answers",
  );
  check(
    fetched.json.participants.every((p) => Object.keys(p).sort().join(",") === "id,name,submitted"),
    "participants expose only name + submitted status",
  );

  // ---------------------------------------------------------------- Scenario B
  console.log("\nScenario B — duplicate submission");
  const id2 = await createTrip();
  const v2 = (await call("GET", `/api/groups/${id2}`)).json;
  const first = await call("POST", `/api/groups/${id2}/submissions`, body(v2.participants[0].id, "Riya"));
  const [dupA, dupB] = await Promise.all([
    call("POST", `/api/groups/${id2}/submissions`, body(v2.participants[1].id, "Siddharth")),
    call("POST", `/api/groups/${id2}/submissions`, body(v2.participants[1].id, "Siddharth")),
  ]);
  const again = await call("POST", `/api/groups/${id2}/submissions`, {
    ...body(v2.participants[0].id, "Riya"),
    budgetBand: "20k_plus",
  });
  check(first.status === 201, "first submission accepted");
  check(again.status === 409 && again.json.error === "already_submitted", "second submission rejected (409)");
  check(
    [dupA.status, dupB.status].sort().join(",") === "201,409",
    "simultaneous double-click: exactly one accepted",
    [dupA.status, dupB.status],
  );
  const after = (await call("GET", `/api/groups/${id2}`)).json;
  check(after.submittedCount === 2, "count unaffected by duplicates (2/5)");

  // ---------------------------------------------------------------- Scenario C
  console.log("\nScenario C — editing after lock");
  const late = await call("POST", `/api/groups/${id}/submissions`, {
    ...body(view.participants[0].id, "Riya"),
    budgetBand: "under_10k",
  });
  check(late.status === 423 && late.json.error === "preferences_locked", "resubmitting after lock is blocked (423)");
  const unchanged = (await call("GET", `/api/groups/${id}`)).json;
  check(
    JSON.stringify(unchanged.results) === JSON.stringify(view.results),
    "results unchanged after the blocked edit",
  );

  // ---------------------------------------------------------------- Scenario D
  console.log("\nScenario D — dealbreakers veto trips");
  if (source === "rules") {
    const vetoes = new Set(Object.values(DEMO_PREFERENCES).flatMap((p) => p.dealbreakers));
    const offending = options.filter((o) =>
      TRIPS.find((t) => t.id === o.tripId)!.dealbreaker_conflicts.some((d) => vetoes.has(d)),
    );
    check(offending.length === 0, "no option triggers any submitted dealbreaker");
    const vetoed = TRIPS.filter((t) => t.dealbreaker_conflicts.some((d) => vetoes.has(d))).map((t) => t.id);
    check(
      options.every((o) => !vetoed.includes(o.tripId)) &&
        view.results!.funnel?.ruledOutByDealbreakers === vetoed.length,
      `${vetoed.length} vetoed trips removed entirely (${vetoed.join(", ")})`,
    );
  } else {
    console.log(`    Gemini picked: ${options.map((o) => `${o.destination} (${o.tierLabel})`).join(" | ")}`);
  }

  // ---------------------------------------------------------------- Scenario E
  console.log("\nScenario E — near-equal options both appear");
  if (source === "rules") {
    const even = options.filter((o) => o.evenWith.length > 0);
    check(even.length >= 2, `even match flagged (${even.map((o) => `${o.letter}↔${o.evenWith.join("")}`).join(", ")})`);
  }
  check(!/\d+(\.\d+)?%/.test(JSON.stringify(view.results)), "no fake precision percentages");

  // ---------------------------------------------------------------- Scenario F
  console.log("\nScenario F — final decision locks");
  const early = await call("POST", `/api/groups/${id2}/decision`, { tripId: "south-goa" });
  check(early.status === 409 && early.json.error === "not_locked", "cannot decide before everyone submits");
  const bogus = await call("POST", `/api/groups/${id}/decision`, { tripId: "north-goa" });
  check(bogus.status === 400 && bogus.json.error === "invalid_option", "cannot pick a trip outside the options");
  const [d1, d2] = await Promise.all([
    call("POST", `/api/groups/${id}/decision`, { tripId: options[0].tripId }),
    call("POST", `/api/groups/${id}/decision`, { tripId: options[1].tripId }),
  ]);
  check([d1.status, d2.status].sort().join(",") === "200,409", "two people deciding at once: first wins", [d1.status, d2.status]);
  const decided = (await call("GET", `/api/groups/${id}`)).json;
  check(decided.phase === "decided" && !!decided.decision, `decision locked: ${decided.decision?.destination} · ${decided.decision?.weekendLabel}`);
  const redo = await call("POST", `/api/groups/${id}/decision`, { tripId: options[2]?.tripId ?? options[0].tripId });
  check(redo.status === 409 && redo.json.error === "already_decided", "decision cannot be changed");
  const resubmit = await call("POST", `/api/groups/${id}/submissions`, body(view.participants[1].id, "Siddharth"));
  check(resubmit.status === 423, "preferences never reopen after decision");

  // ---------------------------------------------------------------- Validation & pages
  console.log("\nValidation and pages");
  const bad = await call("POST", `/api/groups/${id2}/submissions`, { participantId: v2.participants[2].id, budgetBand: "free" });
  check(bad.status === 400, "invalid answers rejected (400)");
  check((await call("GET", "/api/groups/not-a-uuid")).status === 404, "malformed trip id → 404");
  check((await call("GET", "/api/groups/00000000-0000-4000-8000-000000000000")).status === 404, "unknown trip → 404");
  const pages: [string, string][] = [
    [`/t/${id2}`, "Plan the trip. End the debate."],
    [`/t/${id2}/submit`, "Who&#x27;s submitting?"],
    [`/t/${id2}/status`, "Group progress"],
    [`/t/${id2}/results`, "Options unlock when everyone has submitted"],
    [`/t/${id}/results`, "Decision locked"],
    [`/t/${id}/submit`, "Preferences are locked"],
  ];
  for (const [path, text] of pages) {
    const res = await call("GET", path);
    check(res.status === 200 && res.text.includes(text), `${path.replace(/[0-9a-f-]{36}/, ":id")} renders “${text.replace("&#x27;", "'")}”`);
  }
  check((await call("GET", "/t/00000000-0000-4000-8000-000000000000")).status === 404, "unknown trip page → 404");

  // ---------------------------------------------------------------- Deadline
  if (!process.env.SKIP_DEADLINE) {
    console.log("\nDeadline — real server-side enforcement (waits ~70s)");
    const id3 = await createTrip(62);
    const v3 = (await call("GET", `/api/groups/${id3}`)).json;
    check((await call("POST", `/api/groups/${id3}/submissions`, body(v3.participants[0].id, "Riya"))).status === 201, "submission before deadline accepted");
    check((await call("POST", `/api/groups/${id3}/extend`)).json.error === "not_expired", "cannot extend before the deadline");
    await new Promise((r) => setTimeout(r, 66_000));
    const closed = await call("POST", `/api/groups/${id3}/submissions`, body(v3.participants[1].id, "Siddharth"));
    check(closed.status === 410 && closed.json.error === "deadline_passed", "submission after deadline rejected (410)");
    check((await call("GET", `/api/groups/${id3}`)).json.phase === "expired", "trip shows as expired");
    const ext = await call("POST", `/api/groups/${id3}/extend`);
    check(ext.status === 200 && ext.json.phase === "collecting", "explicit 24h reopen works");
    check(ext.json.submittedCount === 1, "earlier submission kept and locked");
    check((await call("POST", `/api/groups/${id3}/submissions`, body(v3.participants[1].id, "Siddharth"))).status === 201, "missing person can now submit");
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
