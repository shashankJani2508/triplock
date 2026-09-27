"use client";

import { ArrowRight, CircleCheck, LockKeyhole } from "lucide-react";
import { storageKeys, useStored } from "@/lib/client/storage";
import { useTrip } from "@/lib/client/use-trip";
import type { TripView } from "@/lib/types";
import { Shell } from "./shell";
import { CopyInviteLink, DeadlineCard, NameRow } from "./trip-bits";
import { ButtonLink, Card, Eyebrow } from "./ui";

export function stepFor(phase: TripView["phase"], page: "overview" | "submit" | "status" | "results"): number {
  if (phase === "decided") return 5;
  if (phase === "locked") return page === "status" ? 2 : 3;
  return page === "status" ? 1 : 0;
}

export function TripOverview({ initial }: { initial: TripView }) {
  const { view, phase, serverNow } = useTrip(initial);
  const meId = useStored("local", storageKeys.me(view.id));
  const me = view.participants.find((p) => p.id === meId);

  const base = `/t/${view.id}`;

  return (
    <Shell step={stepFor(phase, "overview")}>
      <section className="animate-fade-up">
        <Eyebrow>{view.name}</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Plan the trip. End the debate.
        </h1>
        <p className="mt-3 text-lg text-muted">Five preferences. One clear decision.</p>
        <div className="mt-7">
          <NameRow view={view} />
        </div>
        <p className="mt-5 text-sm font-medium text-ink-soft">
          {view.total} people · 5 questions · &lt;1 minute
        </p>
      </section>

      <section className="mt-8 space-y-3 animate-fade-up [animation-delay:80ms]">
        {phase === "decided" && view.decision ? (
          <Card className="border-agree/25 p-5 sm:p-6">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-agree">
              <LockKeyhole className="size-4" aria-hidden /> Decision locked
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {view.decision.destination}{" "}
              <span className="whitespace-nowrap">· {view.decision.weekendLabel}</span>
            </p>
            <ButtonLink href={`${base}/results`} className="mt-5 w-full">
              View decision <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
        ) : phase === "locked" ? (
          <Card className="border-agree/25 p-5 sm:p-6">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-agree">
              <LockKeyhole className="size-4" aria-hidden /> Preferences are locked
            </p>
            <p className="mt-2 text-xl font-semibold tracking-tight">Everyone&apos;s in.</p>
            <p className="mt-1 text-muted">Your group&apos;s options are ready.</p>
            <ButtonLink href={`${base}/results`} className="mt-5 w-full">
              See your options <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
        ) : (
          <>
            <DeadlineCard deadline={view.deadline} now={serverNow} phase={phase} demo={view.demoDeadline} />
            {phase === "expired" ? (
              <Card className="p-5 sm:p-6">
                <p className="font-medium">
                  The deadline passed with {view.submittedCount} of {view.total} submitted.
                </p>
                <p className="mt-1 text-sm text-muted">Everyone needs to submit before the group sees options.</p>
                <ButtonLink href={`${base}/status`} className="mt-5 w-full">
                  View group status <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
              </Card>
            ) : me?.submitted ? (
              <Card className="p-5 sm:p-6">
                <p className="inline-flex items-center gap-2 font-medium text-agree">
                  <CircleCheck className="size-4" aria-hidden /> You&apos;ve submitted as {me.name}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {view.submittedCount} of {view.total} are in. Options appear once everyone submits.
                </p>
                <ButtonLink href={`${base}/status`} className="mt-5 w-full">
                  View group status <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
                {view.submittedCount < view.total && (
                  <ButtonLink href={`${base}/submit`} variant="secondary" className="mt-2 w-full">
                    Submit as someone else
                  </ButtonLink>
                )}
              </Card>
            ) : (
              <div className="space-y-2 pt-2">
                <ButtonLink href={`${base}/submit`} className="w-full">
                  Submit my preferences <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href={`${base}/status`} variant="secondary" className="w-full">
                  View group status · {view.submittedCount}/{view.total} submitted
                </ButtonLink>
              </div>
            )}
          </>
        )}
        <div className="flex justify-center pt-1">
          <CopyInviteLink tripId={view.id} />
        </div>
      </section>
    </Shell>
  );
}
