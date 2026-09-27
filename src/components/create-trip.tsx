"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, LoaderCircle, Timer } from "lucide-react";
import { DEADLINE_HOURS, DEMO_ROLLING_DEADLINE } from "@/lib/config";
import { api, ApiError } from "@/lib/client/api";
import { DemoNote } from "./trip-bits";
import { Button, Card } from "./ui";

export function CreateTrip() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <p className="mt-0.5 text-sm text-muted">When all five are in, answers lock automatically.</p>
          {DEMO_ROLLING_DEADLINE && <DemoNote />}
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

    </Card>
  );
}
