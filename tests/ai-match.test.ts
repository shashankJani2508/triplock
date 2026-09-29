import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiMatch } from "../src/lib/server/ai-match";
import { DEMO_LIST, DEMO_PREFERENCES } from "./fixtures";

const NAMES = Object.keys(DEMO_PREFERENCES); // Riya, Siddharth, Karan, Aisha, Preethi

function option(overrides: Record<string, unknown>) {
  return {
    destination: "Goa",
    state: "Goa",
    weekendId: "2026-11-13",
    fit: "strong",
    description: "A relaxed beach weekend.",
    estimatedCostPerPerson: "₹11,000–₹15,000",
    travel: "Short flights",
    tripTypes: ["beach", "relaxed"],
    highlights: ["Everyone is free that weekend"],
    compromise: "",
    tags: ["Beaches"],
    dealbreakersTriggered: [],
    people: [1, 2, 3, 4, 5].map((person) => ({ person, standing: "great", note: `Person ${person} is happy` })),
    ...overrides,
  };
}

/** Makes fetch answer like Gemini's generateContent with the given options. */
function geminiReturns(options: unknown[]) {
  const body = { candidates: [{ content: { parts: [{ text: JSON.stringify({ options }) }] } }] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-placeholder");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Gemini matching fact-check", () => {
  it("drops an option most of the group can't make, whatever the model claims", async () => {
    // Only Riya and Aisha are free on 20–22 Nov in the demo answers.
    geminiReturns([
      option({}),
      option({ destination: "Udaipur", state: "Rajasthan", weekendId: "2026-11-20", fit: "good",
        highlights: ["Four out of five friends are free on this weekend"] }),
    ]);
    const result = await aiMatch(DEMO_LIST, NAMES);
    expect(result?.source).toBe("ai");
    expect(result!.options.map((o) => o.destination)).toEqual(["Goa"]);
  });

  it("marks anyone who isn't free and downgrades the fit", async () => {
    // 13–15 Nov: everyone free. 27–29 Nov: Karan and Aisha only, so use a
    // 5-person set where one person misses 13–15 instead.
    const prefs = DEMO_LIST.map((p, i) =>
      i === 1 ? { ...p, free_weekends: ["2026-11-06" as const] } : p,
    ); // Siddharth now misses 13–15 Nov
    geminiReturns([option({ compromise: "none" })]);
    const result = await aiMatch(prefs, NAMES);
    const goa = result!.options[0];
    expect(goa.tier).toBe("compromise");
    const sid = goa.people.find((p) => p.name === "Siddharth")!;
    expect(sid).toEqual({ name: "Siddharth", standing: "stretch", note: "Not free on 13–15 Nov" });
    expect(goa.compromises[0]).toContain("move plans for 13–15 Nov");
    expect(goa.highlights.join(" ")).not.toMatch(/everyone/i);
  });

  it("uses names instead of 'Person N' and avoids repeating the place", async () => {
    geminiReturns([option({ compromise: "Person 5 has a longer journey." })]);
    const goa = (await aiMatch(DEMO_LIST, NAMES))!.options[0];
    expect(goa.compromises).toEqual(["Preethi has a longer journey"]);
    expect(goa.people[0]).toMatchObject({ name: "Riya", note: "Riya is happy" });
    expect(goa.description).toBe("A relaxed beach weekend.");
  });

  it("drops options the model says trigger a dealbreaker", async () => {
    geminiReturns([option({}), option({ destination: "Kasol", dealbreakersTriggered: ["No trekking"] })]);
    expect((await aiMatch(DEMO_LIST, NAMES))!.options.map((o) => o.destination)).toEqual(["Goa"]);
  });

  it("returns null (rules take over) on errors, bad output or no key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 429 })));
    expect(await aiMatch(DEMO_LIST, NAMES)).toBeNull();

    const bad = { candidates: [{ content: { parts: [{ text: "not json" }] } }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(bad), { status: 200 })));
    expect(await aiMatch(DEMO_LIST, NAMES)).toBeNull();

    geminiReturns([option({ weekendId: "2026-11-20" })]); // nobody-can-make-it only
    expect(await aiMatch(DEMO_LIST, NAMES)).toBeNull();

    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await aiMatch(DEMO_LIST, NAMES)).toBeNull();
  });

  it("sends each person's facts, never their names", async () => {
    geminiReturns([option({})]);
    await aiMatch(DEMO_LIST, NAMES);
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    const prompt = JSON.parse(init.body as string).contents[0].parts[0].text as string;
    expect(prompt).toContain("2026-11-13 (13–15 November): 5 of 5 free");
    expect(prompt).toContain("travelling from Chennai");
    for (const name of NAMES) expect(prompt).not.toContain(name);
  });
});
