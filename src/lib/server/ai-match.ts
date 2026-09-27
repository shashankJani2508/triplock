import "server-only";
import { z } from "zod";
import {
  DESTINATION_TYPE_IDS,
  WEEKENDS,
  WEEKEND_IDS,
  budgetBand,
  dealbreaker,
  destinationType,
  weekend,
} from "@/lib/config";
import { buildConsensus, headlineFor, profileGroup, TIER_LABELS } from "@/lib/matching";
import type { MatchResult, PreferenceInput, TripOption } from "@/lib/types";

/**
 * Gemini matching: the model reads every person's preferences (as "Person N",
 * never names) and picks 2–3 weekend trips anywhere in India, with where each
 * person stands. Returns null on any problem so the caller can fall back to
 * the rules engine; the demo never breaks because of the AI.
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 30_000;

// Gemini structured-output schema (OpenAPI subset used by generateContent).
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    options: {
      type: "ARRAY",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "OBJECT",
        properties: {
          destination: { type: "STRING", description: "Place name, e.g. 'Rishikesh'" },
          state: { type: "STRING", description: "Indian state or union territory" },
          weekendId: { type: "STRING", enum: [...WEEKEND_IDS] },
          fit: { type: "STRING", enum: ["strong", "good", "compromise"] },
          description: { type: "STRING", description: "One sentence, under 20 words" },
          estimatedCostPerPerson: { type: "STRING", description: "e.g. '₹10,000–₹14,000', travel + 2 nights" },
          travel: { type: "STRING", description: "Short, e.g. 'Flights of 1–2 hours from most home cities'" },
          tripTypes: { type: "ARRAY", items: { type: "STRING", enum: [...DESTINATION_TYPE_IDS] } },
          highlights: { type: "ARRAY", items: { type: "STRING" }, description: "2–4 reasons it suits the group" },
          compromise: { type: "STRING", description: "Main trade-off as a short lowercase phrase, or empty" },
          tags: { type: "ARRAY", items: { type: "STRING" }, description: "2–3 short activity tags" },
          dealbreakersTriggered: { type: "ARRAY", items: { type: "STRING" }, description: "Must be empty" },
          people: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                person: { type: "INTEGER", description: "Person number" },
                standing: { type: "STRING", enum: ["great", "okay", "stretch"] },
                note: { type: "STRING", description: "Under 12 words, no exact budget amounts" },
              },
              required: ["person", "standing", "note"],
            },
          },
        },
        required: [
          "destination",
          "state",
          "weekendId",
          "fit",
          "description",
          "estimatedCostPerPerson",
          "travel",
          "tripTypes",
          "highlights",
          "compromise",
          "tags",
          "dealbreakersTriggered",
          "people",
        ],
      },
    },
  },
  required: ["options"],
} as const;

const text = (max: number) => z.string().trim().min(1).max(max);

const aiOptionSchema = z.object({
  destination: text(60),
  state: z.string().trim().max(60).catch(""),
  weekendId: z.enum(WEEKEND_IDS),
  fit: z.enum(["strong", "good", "compromise"]),
  description: text(240),
  estimatedCostPerPerson: text(60),
  travel: text(120),
  tripTypes: z.array(z.string()).catch([]),
  highlights: z.array(text(160)).min(1),
  compromise: z.string().trim().max(200).catch(""),
  tags: z.array(z.string().trim().max(32)).catch([]),
  dealbreakersTriggered: z.array(z.string()).catch([]),
  people: z.array(
    z.object({
      person: z.number().int(),
      standing: z.enum(["great", "okay", "stretch"]),
      note: text(160),
    }),
  ),
});

const aiResponseSchema = z.object({ options: z.array(aiOptionSchema).min(1).max(3) });

function describePerson(p: PreferenceInput, i: number): string {
  const free = p.free_weekends.map((w) => weekend(w).label).join(", ");
  const likes = p.destination_types.map((t) => destinationType(t).label).join(", ");
  const noes = p.dealbreakers.length ? p.dealbreakers.map((d) => dealbreaker(d).label).join(", ") : "none";
  return (
    `Person ${i + 1}: travelling from ${p.origin_city || "an unspecified Indian city"}; ` +
    `budget per person (travel + stay): ${budgetBand(p.budget_band).label} (their maximum); ` +
    `free weekends: ${free}; likes: ${likes}; dealbreakers: ${noes}.`
  );
}

function buildPrompt(prefs: PreferenceInput[]): string {
  const weekends = WEEKENDS.map((w) => `${w.id} = ${w.longLabel} (Fri–Sun)`).join("; ");
  return [
    `You are the matching engine for TripLock, a tool that helps a group of ${prefs.length} friends in India agree on one weekend trip.`,
    "Choose the 2–3 best trip options for the group as a whole. Destinations can be anywhere in India, not only the south.",
    "",
    "Rules:",
    "1. Dealbreakers are hard vetoes: never suggest a trip that conflicts with ANY person's dealbreaker. Leave dealbreakersTriggered empty.",
    "2. Pick each trip's weekendId from the list below only. Prefer a weekend every person is free; otherwise the one most people can make, and name that as the compromise.",
    "3. Budgets are each person's maximum per person for travel from their own city plus a 2-night stay. Aim to fit everyone; a small stretch for some is a compromise.",
    "4. It is a Fri–Sun trip, so travel time from each person's home city matters.",
    "5. Options must be meaningfully different (different regions or kinds of trip).",
    "6. fit: 'strong' = works for everyone with no real compromise; 'good' = one small compromise; 'compromise' = a notable trade-off.",
    "7. For every option, list where EACH person stands (every person number, once): great, okay or stretch, with a short note about their dates, budget, trip type or travel. Never quote exact budget amounts.",
    "8. Plain, friendly language. No percentages or scores.",
    "",
    `Weekends: ${weekends}.`,
    "",
    "People:",
    ...prefs.map(describePerson),
  ].join("\n");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function tidyCompromise(value: string): string {
  const trimmed = value.trim().replace(/[.\s]+$/, "");
  if (!trimmed || /^(none|n\/a|no compromise)/i.test(trimmed)) return "";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** Asks Gemini for the group's options. Returns null if unavailable or invalid. */
export async function aiMatch(prefs: PreferenceInput[], labels: string[]): Promise<MatchResult | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || prefs.length === 0) return null;

  const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  let raw: unknown;
  try {
    const response = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(prefs) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      // Log status and Google's message only; never the key or the prompt.
      const detail = await response.text().catch(() => "");
      console.error(`[ai-match] Gemini ${response.status}: ${detail.slice(0, 300)}`);
      return null;
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const textOut = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    raw = JSON.parse(textOut);
  } catch (error) {
    console.error(`[ai-match] Gemini request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const parsed = aiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`[ai-match] Unexpected Gemini output: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return null;
  }

  // Safety net: drop anything the model itself flags as hitting a dealbreaker.
  const picks = parsed.data.options.filter((o) => o.dealbreakersTriggered.length === 0);
  if (picks.length === 0) return null;

  const usedIds = new Set<string>();
  const letters = ["A", "B", "C"];
  const options: TripOption[] = picks.slice(0, 3).map((o, i) => {
    let tripId = `ai-${slug(o.destination) || i}`;
    while (usedIds.has(tripId)) tripId += "-x";
    usedIds.add(tripId);
    const wk = weekend(o.weekendId);
    const byPerson = new Map(o.people.map((p) => [p.person, p]));
    const compromise = tidyCompromise(o.compromise);
    const types = o.tripTypes.filter((t): t is (typeof DESTINATION_TYPE_IDS)[number] =>
      (DESTINATION_TYPE_IDS as readonly string[]).includes(t),
    );
    return {
      letter: letters[i],
      tripId,
      destination: o.destination,
      description: o.state ? `${o.description} (${o.state})` : o.description,
      tags: o.tags.filter(Boolean).slice(0, 4),
      typeLabels: types.map((t) => destinationType(t).label),
      costLabel: `${o.estimatedCostPerPerson} per person`,
      travelLabel: o.travel,
      weekendId: wk.id,
      weekendLabel: wk.longLabel,
      tier: o.fit,
      tierLabel: TIER_LABELS[o.fit],
      highlights: o.highlights.slice(0, 4),
      compromises: compromise ? [compromise] : [],
      evenWith: [],
      people: labels.map((name, idx) => {
        const p = byPerson.get(idx + 1);
        return p
          ? { name, standing: p.standing, note: p.note }
          : { name, standing: "okay" as const, note: "No specific note from the matcher" };
      }),
    };
  });

  // Group-level agreement is computed from the answers directly (facts, not model output).
  const profile = profileGroup(prefs);
  return {
    source: "ai",
    headline: headlineFor(options),
    subhead:
      "Gemini compared everyone's preferences, including where each of you is travelling from, and picked trips across India that fit the group best.",
    consensus: buildConsensus(profile, null, options.length),
    options,
  };
}
