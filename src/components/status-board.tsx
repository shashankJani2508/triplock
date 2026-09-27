"use client";

import { useState } from "react";
import { ArrowRight, EyeOff, LoaderCircle, LockKeyhole, RotateCcw } from "lucide-react";
import { DEADLINE_EXTENSION_HOURS } from "@/lib/config";
import { api, ApiError } from "@/lib/client/api";
import { storageKeys, useStored } from "@/lib/client/storage";
import { useTrip } from "@/lib/client/use-trip";
import { joinWords } from "@/lib/format";
import type { TripView } from "@/lib/types";
import { Shell } from "./shell";
import { CopyInviteLink, DeadlineCard, ParticipantList } from "./trip-bits";
import { stepFor } from "./trip-overview";
import { Button, ButtonLink, Card, Eyebrow, ProgressBar } from "./ui";

export function StatusBoard({ initial }: { initial: TripView }) {
  const { view, phase, serverNow, accept } = useTrip(initial);
  const meId = useStored("local", storageKeys.me(view.id));
  const me = view.participants.find((p) => p.id === meId);
  const waiting = view.participants.filter((p) => !p.submitted).map((p) => p.name);
  const base = `/t/${view.id}`;
  const locked = phase === "locked" || phase === "decided";

  const [extending, setExtending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extend() {
    setExtending(true);
    setError(null);
    try {
      accept(await api.extend(view.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setExtending(false);
    }
  }

  return (
    <Shell step={stepFor(phase, "status")}>
      <section className="animate-fade-up">
        <Eyebrow>{view.name}</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Group progress</h1>
        <div className="mt-6 flex items-end justify-between gap-4">
          <p className="text-5xl font-semibold tracking-tight tabular-nums">
            {view.submittedCount}
            <span className="text-muted"> / {view.total}</span>
          </p>
          <p className="pb-1.5 text-sm font-medium text-muted">submitted</p>
        </div>
        <ProgressBar value={view.submittedCount} total={view.total} className="mt-4 h-2.5" />
      </section>

      {locked && (
        <Card className="mt-6 animate-fade-up border-agree/25 bg-agree-soft/60 p-5 sm:p-6">
          <p className="inline-flex items-center gap-2 font-semibold text-agree">
            <span className="inline-flex size-8 animate-pop items-center justify-center rounded-full bg-agree text-white">
              <LockKeyhole className="size-4" aria-hidden />
            </span>
            Everyone&apos;s in. Preferences are now locked.
          </p>
          <p className="mt-3 text-ink-soft">
            {phase === "decided" && view.decision
              ? `Your group chose ${view.decision.destination} · ${view.decision.weekendLabel}.`
              : "Your group's preferences have been locked. The matching engine is now finding the strongest overlaps."}
          </p>
          <ButtonLink href={`${base}/results`} className="mt-5 w-full">
            {phase === "decided" ? "View decision" : "See where you agree"} <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      )}

      {!locked && (
        <div className="mt-6 animate-fade-up [animation-delay:60ms]">
          <DeadlineCard deadline={view.deadline} now={serverNow} phase={phase} demo={view.demoDeadline} />
        </div>
      )}

      {phase === "expired" && (
        <Card className="mt-3 animate-fade-up p-5 sm:p-6">
          <p className="font-medium">
            The deadline passed with {view.submittedCount} of {view.total} submitted.
          </p>
          <p className="mt-1 text-sm text-muted">
            Still waiting on {joinWords(waiting)}. Everyone has to be in before the group sees options. Reopening
            gives them {DEADLINE_EXTENSION_HOURS} more hours; answers already submitted stay locked.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-veto">
              {error}
            </p>
          )}
          <Button onClick={extend} disabled={extending} variant="secondary" className="mt-5 w-full">
            {extending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="size-4" aria-hidden />
            )}
            Reopen for {DEADLINE_EXTENSION_HOURS} hours
          </Button>
        </Card>
      )}

      <Card className="mt-6 px-5 py-2 animate-fade-up [animation-delay:120ms] sm:px-6">
        <ParticipantList
          view={view}
          meId={meId}
          submitHref={phase === "collecting" ? (pid) => `${base}/submit?p=${pid}` : undefined}
        />
      </Card>

      <p className="mt-4 flex items-center gap-2 text-sm text-muted">
        <EyeOff className="size-4 shrink-0" aria-hidden />
        Answers stay private. The group only sees who has submitted.
      </p>

      {phase === "collecting" && (
        <div className="mt-6 space-y-1">
          {waiting.length > 0 && (
            <ButtonLink href={`${base}/submit`} className="w-full">
              {me?.submitted ? "Submit as someone else" : "Submit my preferences"}{" "}
              <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          )}
          <div className="flex justify-center">
            <CopyInviteLink tripId={view.id} />
          </div>
        </div>
      )}
    </Shell>
  );
}
