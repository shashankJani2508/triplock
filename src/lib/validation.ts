import { z } from "zod";
import {
  BUDGET_IDS,
  DEALBREAKER_IDS,
  DESTINATION_TYPE_IDS,
  WEEKEND_IDS,
} from "./config";

const unique = <T>(values: T[]) => [...new Set(values)];

export const createTripSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  /** Optional override (used by tests); defaults to DEADLINE_HOURS from now. */
  deadline: z.iso.datetime().optional(),
});

export const submissionSchema = z.strictObject({
  participantId: z.uuid(),
  budgetBand: z.enum(BUDGET_IDS),
  freeWeekends: z.array(z.enum(WEEKEND_IDS)).min(1, "Pick at least one weekend").transform(unique),
  destinationTypes: z
    .array(z.enum(DESTINATION_TYPE_IDS))
    .min(1, "Pick at least one destination type")
    .transform(unique),
  dealbreakers: z.array(z.enum(DEALBREAKER_IDS)).transform(unique),
  originCity: z.string().trim().min(2, "Tell us your city").max(60),
});

export const decisionSchema = z.strictObject({
  tripId: z.string().min(1).max(64),
});

export type SubmissionBody = z.input<typeof submissionSchema>;

export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}
