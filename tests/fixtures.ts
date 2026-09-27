import type { PreferenceInput } from "../src/lib/types";

/** A realistic set of answers for the five friends, used by tests and the e2e script. */
export const DEMO_PREFERENCES: Record<string, PreferenceInput> = {
  Riya: {
    origin_city: "Mumbai",
    budget_band: "10k_15k",
    free_weekends: ["2026-11-13", "2026-11-20"],
    destination_types: ["beach", "relaxed"],
    dealbreakers: ["no_trekking"],
  },
  Siddharth: {
    origin_city: "Delhi",
    budget_band: "15k_20k",
    free_weekends: ["2026-11-06", "2026-11-13"],
    destination_types: ["beach", "culture", "adventure"],
    dealbreakers: [],
  },
  Karan: {
    origin_city: "Bengaluru",
    budget_band: "10k_15k",
    free_weekends: ["2026-11-13", "2026-11-27"],
    destination_types: ["mountains", "nature", "beach"],
    dealbreakers: ["no_nightlife"],
  },
  Aisha: {
    origin_city: "Hyderabad",
    budget_band: "20k_plus",
    free_weekends: ["2026-11-13", "2026-11-20", "2026-11-27"],
    destination_types: ["culture", "relaxed"],
    dealbreakers: [],
  },
  Preethi: {
    origin_city: "Chennai",
    budget_band: "10k_15k",
    free_weekends: ["2026-11-13"],
    destination_types: ["beach", "nature", "relaxed"],
    dealbreakers: ["no_trekking"],
  },
};

export const DEMO_LIST: PreferenceInput[] = Object.values(DEMO_PREFERENCES);
