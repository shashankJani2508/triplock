"use client";

import { useState } from "react";
import { Check, Hourglass, Link2, Timer } from "lucide-react";
import { formatCountdown } from "@/lib/format";
import type { TripPhase, TripView } from "@/lib/types";
import { Avatar, Button, Pill, cx } from "./ui";

/** Prominent deadline block. `now` is the skew-corrected clock (0 before hydration). */
export function DeadlineCard({
  deadline,
  now,
  phase,
  demo = false,
}: {
  deadline: string;
  now: number;
  phase: TripPhase;
  demo?: boolean;
}) {
  const remaining = Date.parse(deadline) - now;
  const closed = phase === "expired";
  const soon = !closed && now > 0 && remaining < 3_600_000;

  return (
    <div
      className={cx(
        "flex items-center gap-4 rounded-2xl border p-4 sm:p-5",
        closed ? "border-veto/20 bg-veto-soft" : soon ? "border-wait/20 bg-wait-soft" : "border-line bg-surface",
      )}
    >
      <span
        className={cx(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-xl",
          closed ? "bg-veto/10 text-veto" : soon ? "bg-wait/10 text-wait" : "bg-canvas text-ink",
        )}
      >
        <Timer className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">{closed ? "Preferences are" : "Preferences close in"}</p>
        <p
          className={cx(
            "text-2xl font-semibold tracking-tight tabular-nums",
            closed ? "text-veto" : soon ? "text-wait" : "text-ink",
          )}
          aria-live="polite"
        >
          {closed ? "Closed" : now === 0 ? " " : formatCountdown(remaining)}
        </p>
        {demo && !closed && <DemoNote />}
      </div>
    </div>
  );
}

/** Tiny disclaimer shown while the demo's rolling deadline is active. */
export function DemoNote() {
  return <p className="mt-1 text-[11px] leading-tight text-muted">(It&apos;s a demo, so it won&apos;t actually close after 24 hours. Intentionally kept for demo purposes.)</p>;
}

export function CopyInviteLink({ tripId }: { tripId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/t/${tripId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link and share it with the group:", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="ghost" onClick={copy} className="text-sm">
      {copied ? <Check className="size-4 text-agree" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
      {copied ? "Link copied" : "Copy invite link"}
    </Button>
  );
}

export function ParticipantList({ view, meId }: { view: TripView; meId: string | null }) {
  return (
    <ul className="divide-y divide-line">
      {view.participants.map((p, i) => (
        <li
          key={p.id}
          className="flex animate-fade-up items-center gap-3 py-3"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <Avatar name={p.name} submitted={p.submitted} />
          <span className="flex-1 font-medium">
            {p.name}
            {p.id === meId && <span className="ml-1.5 text-sm font-normal text-muted">(you)</span>}
          </span>
          {p.submitted ? (
            <Pill tone="agree">
              <Check className="size-3" strokeWidth={3} aria-hidden /> Submitted
            </Pill>
          ) : (
            <Pill tone="wait">
              <Hourglass className="size-3" aria-hidden /> Waiting
            </Pill>
          )}
        </li>
      ))}
    </ul>
  );
}

export function NameRow({ view }: { view: TripView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {view.participants.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-2 text-sm font-medium text-ink-soft">
          <Avatar name={p.name} submitted={p.submitted} />
          {p.name}
        </span>
      ))}
    </div>
  );
}
