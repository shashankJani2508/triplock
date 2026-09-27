"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, LoaderCircle, Timer } from "lucide-react";
import { DEADLINE_HOURS } from "@/lib/config";
import { api, ApiError } from "@/lib/client/api";
import { useNow } from "@/lib/client/clock";
import { storageKeys, useStored } from "@/lib/client/storage";
import { formatDeadline } from "@/lib/format";
import { Button, ButtonLink, Card } from "./ui";

export function CreateTrip() {
  const router = useRouter();
  const now = useNow();
  const lastTrip = useStored("local", storageKeys.lastTrip);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview only; the server sets the real deadline when the trip is created.
  const closesAt = now === 0 ? null : new Date(now + DEADLINE_HOURS * 3_600_000).toISOString();

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createTrip();
      router.push(`/t/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-ink">
          <Timer className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium">Preferences close in {DEADLINE_HOURS} hours</p>
          <p className="mt-0.5 text-sm text-muted">
            {closesAt ? `Deadline: ${formatDeadline(closesAt, now)}. ` : ""}
            When all five are in, answers lock automatically.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-veto">
          {error}
        </p>
      )}

      <Button onClick={start} disabled={busy} className="mt-5 w-full">
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {busy ? "Creating trip…" : "Start the trip"}
        {!busy && <ArrowRight className="size-4" aria-hidden />}
      </Button>

      {lastTrip && (
        <ButtonLink href={`/t/${lastTrip}`} variant="ghost" className="mt-2 w-full text-sm">
          Continue your last trip
        </ButtonLink>
      )}
    </Card>
  );
}
