import { describe, expect, it } from "vitest";
import { TRIPS } from "../src/lib/catalog";
import {
  DEALBREAKER_IDS,
  DEFAULT_PARTICIPANTS,
  DESTINATION_TYPE_IDS,
  WEEKEND_IDS,
} from "../src/lib/config";
import { evaluateAll, runMatching } from "../src/lib/matching";
import type { PreferenceInput, Trip } from "../src/lib/types";
import { DEMO_LIST, DEMO_PREFERENCES } from "./fixtures";

const everyone = (p: PreferenceInput, n = 5): PreferenceInput[] => Array.from({ length: n }, () => p);

describe("trip catalog", () => {
  it("has 15–20 trips with unique ids", () => {
    expect(TRIPS.length).toBeGreaterThanOrEqual(15);
    expect(TRIPS.length).toBeLessThanOrEqual(20);
    expect(new Set(TRIPS.map((t) => t.id)).size).toBe(TRIPS.length);
  });

  it("only references known weekends, types and dealbreakers", () => {
    for (const t of TRIPS) {
      expect(t.available_weekends.length).toBeGreaterThan(0);
      for (const w of t.available_weekends) expect(WEEKEND_IDS).toContain(w);
      for (const ty of t.types) expect(DESTINATION_TYPE_IDS).toContain(ty);
      for (const d of t.dealbreaker_conflicts) expect(DEALBREAKER_IDS).toContain(d);
    }
  });

  it("flags expensive trips consistently", () => {
    for (const t of TRIPS) {
      expect(t.estimated_cost_band === "20k_plus").toBe(t.dealbreaker_conflicts.includes("no_expensive"));
    }
  });
});

describe("demo group (all five submit normally)", () => {
  const result = runMatching(DEMO_LIST);

  it("returns 2–3 options", () => {
    expect(result.options.length).toBeGreaterThanOrEqual(2);
    expect(result.options.length).toBeLessThanOrEqual(3);
    expect(result.options.map((o) => o.letter)).toEqual(["A", "B", "C"].slice(0, result.options.length));
  });

  it("synthesises group-level consensus from the submitted data", () => {
    const byKey = Object.fromEntries(result.consensus.map((c) => [c.key, c]));
    expect(byKey.budget.statement).toBe("Everyone is comfortable up to ₹15,000 per person");
    expect(byKey.dates.statement).toBe("13–15 November works for everyone");
    expect(byKey.destination.statement).toBe("Beach and relaxed destinations have the strongest overlap");
    expect(byKey.dealbreakers.statement).toBe("None of your options triggers a submitted dealbreaker");
    expect(byKey.dealbreakers.detail).toContain("trekking");
  });

  it("schedules every option on the weekend everyone is free", () => {
    for (const o of result.options) expect(o.weekendId).toBe("2026-11-13");
  });

  it("offers distinct options rather than three versions of one idea", () => {
    const trips = result.options.map((o) => TRIPS.find((t) => t.id === o.tripId)!);
    expect(new Set(trips.map((t) => t.region)).size).toBe(trips.length);
    expect(new Set(trips.map((t) => t.types[0])).size).toBe(trips.length);
  });

  it("never exposes individual names or raw per-person answers", () => {
    const json = JSON.stringify(result);
    for (const name of DEFAULT_PARTICIPANTS) expect(json).not.toContain(name);
    expect(json).not.toMatch(/\d+(\.\d+)?%/); // no fake precision
  });

  it("is deterministic and independent of submission order", () => {
    const withoutPeople = (r: typeof result) => ({ ...r, options: r.options.map((o) => ({ ...o, people: [] })) });
    expect(runMatching(DEMO_LIST)).toEqual(result);
    expect(withoutPeople(runMatching([...DEMO_LIST].reverse()))).toEqual(withoutPeople(result));
  });

  it("says where each person stands on each option", () => {
    const names = Object.keys(DEMO_PREFERENCES);
    const named = runMatching(DEMO_LIST, TRIPS, names);
    for (const o of named.options) {
      expect(o.people.map((p) => p.name)).toEqual(names);
      for (const p of o.people) expect(["great", "okay", "stretch"]).toContain(p.standing);
    }
    // Preethi is free only on 13–15 Nov, which every option uses.
    expect(named.options[0].people.find((p) => p.name === "Preethi")!.note).not.toContain("not free");
  });
});

describe("Scenario D — a dealbreaker is a veto, not a negative score", () => {
  it("removes a trip even when everyone else would love it", () => {
    const trekkers: PreferenceInput = {
      budget_band: "10k_15k",
      free_weekends: [...WEEKEND_IDS],
      destination_types: ["mountains", "adventure"],
      dealbreakers: [],
    };
    const prefs = [...everyone(trekkers, 4), { ...trekkers, dealbreakers: ["no_trekking" as const] }];

    const { evaluations } = evaluateAll(prefs);
    for (const id of ["chikmagalur", "kudremukh"]) {
      const e = evaluations.find((x) => x.trip.id === id)!;
      expect(e.eliminated).toBe("dealbreaker");
      expect(e.triggeredDealbreakers).toContain("no_trekking");
    }

    const result = runMatching(prefs);
    expect(result.options.map((o) => o.tripId)).not.toContain("chikmagalur");
    expect(result.options.map((o) => o.tripId)).not.toContain("kudremukh");

    // Without the veto, the trek is exactly what this group wants.
    const unvetoed = runMatching(everyone(trekkers));
    expect(unvetoed.options.map((o) => o.tripId)).toContain("chikmagalur");
  });

  it("never offers any trip that conflicts with any submitted dealbreaker", () => {
    const prefs = DEMO_LIST.map((p, i) => ({ ...p, dealbreakers: [DEALBREAKER_IDS[i % DEALBREAKER_IDS.length]] }));
    const vetoes = new Set(prefs.flatMap((p) => p.dealbreakers));
    const result = runMatching(prefs);
    for (const o of result.options) {
      const trip = TRIPS.find((t) => t.id === o.tripId)!;
      expect(trip.dealbreaker_conflicts.some((d) => vetoes.has(d))).toBe(false);
    }
  });
});

describe("retired dealbreakers in older stored answers", () => {
  it("are ignored instead of crashing or vetoing", () => {
    const legacy = DEMO_LIST.map((p) => ({ ...p, dealbreakers: [] as PreferenceInput["dealbreakers"] }));
    legacy[0] = { ...legacy[0], dealbreakers: ["no_extreme_adventure" as never] };
    const withLegacy = runMatching(legacy);
    const without = runMatching(legacy.map((p) => ({ ...p, dealbreakers: [] })));
    expect(withLegacy.options).toEqual(without.options);
    expect(withLegacy.consensus.find((c) => c.key === "dealbreakers")!.statement).toBe(
      "No dealbreakers were submitted",
    );
  });
});

describe("Scenario E — similar scores are not forced into a fake winner", () => {
  const twin = (id: string, region: string, type: Trip["types"][number]): Trip => ({
    id,
    destination: id,
    region,
    types: [type],
    estimated_cost_band: "10k_15k",
    travel: "medium",
    travel_note: "Overnight train",
    available_weekends: [...WEEKEND_IDS],
    tags: [],
    dealbreaker_conflicts: [],
    description: "",
  });

  it("shows both near-equal options and marks them as even", () => {
    const catalog = [twin("alpha", "r1", "beach"), twin("beta", "r2", "mountains")];
    const prefs: PreferenceInput[] = [
      { budget_band: "10k_15k", free_weekends: ["2026-11-13"], destination_types: ["beach", "mountains"], dealbreakers: [] },
      { budget_band: "10k_15k", free_weekends: ["2026-11-13"], destination_types: ["beach", "mountains"], dealbreakers: [] },
      { budget_band: "10k_15k", free_weekends: ["2026-11-13"], destination_types: ["beach"], dealbreakers: [] },
      { budget_band: "10k_15k", free_weekends: ["2026-11-13"], destination_types: ["mountains"], dealbreakers: [] },
      { budget_band: "10k_15k", free_weekends: ["2026-11-13"], destination_types: ["beach", "mountains"], dealbreakers: [] },
    ];
    const result = runMatching(prefs, catalog);
    expect(result.options.map((o) => o.tripId).sort()).toEqual(["alpha", "beta"]);
    expect(result.options[0].tier).toBe(result.options[1].tier);
    expect(result.options[0].tierLabel).toBe(result.options[1].tierLabel);
    expect(result.options[0].evenWith).toEqual(["B"]);
    expect(result.options[1].evenWith).toEqual(["A"]);
  });
});

describe("budget and date overlap", () => {
  it("uses the lowest comfortable budget and removes trips out of reach", () => {
    const prefs = [...everyone({ ...DEMO_PREFERENCES.Aisha, dealbreakers: [] }, 4), {
      ...DEMO_PREFERENCES.Aisha,
      budget_band: "under_10k" as const,
      dealbreakers: [],
    }];
    const { evaluations } = evaluateAll(prefs);
    const result = runMatching(prefs);
    expect(result.consensus[0].statement).toBe("Everyone is comfortable under ₹10,000 per person");
    // 15–20k is two bands above under-10k: out of reach.
    expect(evaluations.find((e) => e.trip.id === "udaipur")!.eliminated).toBe("budget");
    // 10–15k is a stretch, never a silent pass.
    const coorg = evaluations.find((e) => e.trip.id === "coorg")!;
    expect(coorg.eliminated).toBeNull();
    expect(coorg.compromises).toContain("budget");
  });

  it("flags a date compromise when no weekend works for all five", () => {
    const base = { budget_band: "10k_15k" as const, destination_types: ["beach" as const], dealbreakers: [] };
    const prefs: PreferenceInput[] = [
      { ...base, free_weekends: ["2026-11-20"] },
      { ...base, free_weekends: ["2026-11-20"] },
      { ...base, free_weekends: ["2026-11-20"] },
      { ...base, free_weekends: ["2026-11-20"] },
      { ...base, free_weekends: ["2026-11-06"] },
    ];
    const result = runMatching(prefs);
    const dates = result.consensus.find((c) => c.key === "dates")!;
    expect(dates.status).toBe("partial");
    expect(dates.detail).toBe("20–22 November works for all but one of you.");
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) {
      expect(o.tier).toBe("compromise");
      expect(o.compromises.join(" ")).toContain("move plans");
    }
  });

  it("returns no options, with a reason, when dates barely overlap", () => {
    const base = { budget_band: "10k_15k" as const, destination_types: ["beach" as const], dealbreakers: [] };
    const prefs: PreferenceInput[] = WEEKEND_IDS.map((w) => ({ ...base, free_weekends: [w] }));
    prefs.push({ ...base, free_weekends: ["2026-11-06"] });
    const result = runMatching(prefs);
    expect(result.options).toEqual([]);
    expect(result.headline).toBe("No trip works for everyone yet");
    expect(result.noOptionsReason).toContain("free weekends");
  });
});
