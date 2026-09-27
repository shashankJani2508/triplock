"use client";

import type { TripView } from "@/lib/types";
import type { SubmissionBody } from "@/lib/validation";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new ApiError("network", "Couldn't reach the server. Check your connection and try again.", 0);
  }
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!response.ok) {
    throw new ApiError(
      body?.error ?? "internal",
      body?.message ?? "Something went wrong. Please try again.",
      response.status,
    );
  }
  return body as T;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  getTrip: (id: string) => request<TripView>(`/api/groups/${id}`),
  createTrip: (deadline: string) => request<{ id: string }>("/api/groups", post({ deadline })),
  submit: (id: string, body: SubmissionBody) =>
    request<TripView>(`/api/groups/${id}/submissions`, post(body)),
  decide: (id: string, tripId: string) => request<TripView>(`/api/groups/${id}/decision`, post({ tripId })),
  extend: (id: string) => request<TripView>(`/api/groups/${id}/extend`, post()),
};
