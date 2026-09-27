"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Compass,
  Hourglass,
  LoaderCircle,
  LockKeyhole,
  Route,
  Scale,
  Wallet,
} from "lucide-react";
import { ORIGIN_CITY } from "@/lib/config";
import { api, ApiError } from "@/lib/client/api";
import { storageKeys, useStored, writeStored } from "@/lib/client/storage";
import { useTrip } from "@/lib/client/use-trip";
import type { ConsensusItem, MatchResult, TripOption, TripView } from "@/lib/types";
import { Notice } from "./notices";
import { Shell } from "./shell";
import { Button, ButtonLink, Card, Eyebrow, Pill, cx } from "./ui";

// ---------------------------------------------------------------------------
// Matching transition
// ---------------------------------------------------------------------------

const STAGES = [
  "Checking dates",
  "Checking budget overlap",
  "Checking destination preferences",
  "Checking dealbreakers",
  "Finding strongest options",
];
const STAGE_MS = 520;

function MatchingTransition({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = STAGES.map((_, i) => setTimeout(() => setStage(i + 1), STAGE_MS * (i + 1)));
    const end = setTimeout(onDone, STAGE_MS * STAGES.length + 450);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(end);
    };
  }, [onDone]);

  return (
    <Shell step={2}>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center" aria-live="polite">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-ink text-white">
          <LoaderCircle className="size-6 animate-spin" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Finding where your group agrees…</h1>
        <ul className="mt-8 w-full max-w-xs space-y-3 text-left">
          {STAGES.map((label, i) => {
            const done = i < stage;
            const active = i === stage;
            return (
              <li
                key={label}
                className={cx(
                  "flex items-center gap-3 text-sm transition-colors duration-300",
                  done ? "text-ink" : active ? "text-ink" : "text-muted/60",
                )}
              >
                {done ? (
                  <span className="inline-flex size-5 animate-pop items-center justify-center rounded-full bg-agree text-white">
                    <Check className="size-3" strokeWidth={3.5} aria-hidden />
                  </span>
                ) : active ? (
                  <LoaderCircle className="size-5 animate-spin text-ink-soft" aria-hidden />
                ) : (
                  <CircleDashed className="size-5" aria-hidden />
                )}
                {label}
              </li>
            );
          })}
        </ul>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const CONSENSUS_ICONS: Record<ConsensusItem["key"], ReactNode> = {
  budget: <Wallet className="size-3.5" aria-hidden />,
  dates: <CalendarDays className="size-3.5" aria-hidden />,
  destination: <Compass className="size-3.5" aria-hidden />,
  dealbreakers: <Ban className="size-3.5" aria-hidden />,
};

function Consensus({ items }: { items: ConsensusItem[] }) {
  return (
    <Card className="divide-y divide-line">
      {items.map((item, i) => (
        <div
          key={item.key}
          className="flex animate-fade-up gap-3 p-4 sm:p-5"
          style={{ animationDelay: `${120 + i * 70}ms` }}
        >
          {item.status === "agree" ? (
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-agree" aria-label="Agreed" />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-wait" aria-label="Partial overlap" />
          )}
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium tracking-[0.06em] text-muted uppercase">
              {CONSENSUS_ICONS[item.key]} {item.label}
            </p>
            <p className="mt-1 font-medium">{item.statement}</p>
            {item.detail && <p className="mt-0.5 text-sm text-muted">{item.detail}</p>}
          </div>
        </div>
      ))}
    </Card>
  );
}

const TIER_TONE = { strong: "agree", good: "neutral", compromise: "wait" } as const;

function Facts({ weekend, cost, travel }: { weekend: string; cost: string; travel: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm text-ink-soft sm:flex-row sm:flex-wrap sm:gap-x-5">
      <span className="inline-flex items-center gap-2">
        <CalendarDays className="size-4 text-muted" aria-hidden /> {weekend}
      </span>
      <span className="inline-flex items-center gap-2">
        <Wallet className="size-4 text-muted" aria-hidden /> {cost}
      </span>
      <span className="inline-flex items-center gap-2">
        <Route className="size-4 text-muted" aria-hidden /> {travel}
      </span>
    </div>
  );
}

function Compromise({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const text = items.join("; ");
  return (
    <p className="rounded-xl bg-wait-soft px-3.5 py-2.5 text-sm text-wait">
      <strong className="font-semibold">{items.length === 1 ? "One compromise:" : "Compromises:"}</strong>{" "}
      {text}.
    </p>
  );
}

function Reasons({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((h) => (
        <li key={h} className="flex gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-agree" strokeWidth={2.5} aria-hidden />
          {h}
        </li>
      ))}
    </ul>
  );
}

function OptionCard({ option, index }: { option: TripOption; index: number }) {
  return (
    <Card className="animate-fade-up p-5 sm:p-6" style={{ animationDelay: `${300 + index * 90}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.06em] text-muted uppercase">Option {option.letter}</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight">{option.destination}</h3>
        </div>
        <Pill tone={TIER_TONE[option.tier]} className="mt-0.5">
          {option.tierLabel}
        </Pill>
      </div>
      <p className="mt-2 text-muted">{option.description}</p>
      <div className="mt-4">
        <Facts weekend={option.weekendLabel} cost={option.costLabel} travel={option.travelLabel} />
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-sm font-medium">Why it made the list</p>
        <Reasons items={option.highlights} />
      </div>
      {option.compromises.length > 0 && (
        <div className="mt-4">
          <Compromise items={option.compromises} />
        </div>
      )}
      {option.evenWith.length > 0 && (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <Scale className="size-4" aria-hidden />
          Even match with Option {option.evenWith.join(" and ")}. Go with your gut.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {option.tags.map((t) => (
          <Pill key={t}>{t}</Pill>
        ))}
      </div>
    </Card>
  );
}

function funnelText(r: MatchResult): string {
  const f = r.funnel;
  const parts = [`${f.checked} trips checked`];
  if (f.ruledOutByDealbreakers) parts.push(`${f.ruledOutByDealbreakers} vetoed by dealbreakers`);
  if (f.ruledOutByBudget) parts.push(`${f.ruledOutByBudget} out of budget reach`);
  if (f.ruledOutByDates) parts.push(`${f.ruledOutByDates} with no shared weekend`);
  parts.push(`${f.viable} viable`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function DecisionPanel({
  view,
  options,
  onDecided,
}: {
  view: TripView;
  options: TripOption[];
  onDecided: (next: TripView, note?: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = options.find((o) => o.tripId === choice);

  async function lock() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDecided(await api.decide(view.id, picked.tripId));
    } catch (e) {
      if (e instanceof ApiError && (e.code === "already_decided" || e.code === "decision_locked")) {
        try {
          onDecided(await api.getTrip(view.id), "Someone in your group locked the decision first.");
          return;
        } catch {
          // Fall through to the error message; polling will still pick up the decision.
        }
      }
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">Ready to decide?</h2>
      <p className="mt-1 text-sm text-muted">
        Pick the trip your group is going on. Once locked, it&apos;s final for all {view.total} of you.
      </p>
      <div className="mt-5 space-y-2" role="radiogroup" aria-label="Choose a trip">
        {options.map((o) => {
          const active = o.tripId === choice;
          return (
            <button
              key={o.tripId}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => {
                setChoice(o.tripId);
                setConfirming(false);
              }}
              className={cx(
                "flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                active ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line hover:border-line-strong",
              )}
            >
              <span
                className={cx(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
                  active ? "bg-ink text-white" : "bg-canvas text-ink-soft",
                )}
              >
                {o.letter}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{o.destination}</span>
                <span className="block text-sm text-muted">
                  {o.weekendLabel} · {o.tierLabel}
                </span>
              </span>
              <span
                aria-hidden
                className={cx(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                  active ? "border-ink bg-ink text-white" : "border-line-strong",
                )}
              >
                {active && <Check className="size-3" strokeWidth={3.5} />}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-veto">
          {error}
        </p>
      )}

      {confirming && picked ? (
        <div className="mt-5 animate-fade-up rounded-2xl border border-ink/15 bg-canvas p-4">
          <p className="font-medium">
            Lock {picked.destination} <span className="whitespace-nowrap">· {picked.weekendLabel}</span> for
            everyone?
          </p>
          <p className="mt-1 text-sm text-muted">This can&apos;t be undone, and preferences won&apos;t reopen.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button onClick={lock} disabled={busy} className="w-full sm:flex-1">
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <LockKeyhole className="size-4" aria-hidden />
              )}
              {busy ? "Locking…" : "Lock decision"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy} className="w-full sm:flex-1">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} disabled={!picked} className="mt-5 w-full">
          Choose this trip <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
    </Card>
  );
}

function DecisionLocked({ view, note }: { view: TripView; note: string | null }) {
  const d = view.decision!;
  const option = view.results?.options.find((o) => o.tripId === d.tripId);

  return (
    <Shell step={5}>
      <div className="text-center">
        <span className="mx-auto inline-flex size-16 animate-pop items-center justify-center rounded-full bg-agree text-white shadow-[0_0_0_8px_var(--color-agree-soft)]">
          <LockKeyhole className="size-7" aria-hidden />
        </span>
        <p className="mt-6 animate-fade-up text-sm font-semibold tracking-[0.08em] text-agree uppercase">
          Decision locked
        </p>
        <h1 className="mt-2 animate-fade-up text-3xl font-semibold tracking-tight text-balance [animation-delay:80ms] sm:text-4xl">
          {d.destination} <span className="whitespace-nowrap">· {d.weekendLabel}</span>
        </h1>
        <p className="mt-3 animate-fade-up text-muted [animation-delay:140ms]">
          Your group has made its decision. Preferences will not reopen.
        </p>
        {note && <p className="mt-3 text-sm text-wait">{note}</p>}
      </div>

      <Card className="mt-8 animate-fade-up p-5 [animation-delay:200ms] sm:p-6">
        {d.description && <p className="text-ink-soft">{d.description}</p>}
        <div className="mt-4">
          <Facts weekend={d.weekendLabel} cost={d.costLabel} travel={d.travelLabel} />
        </div>
        {option && (
          <div className="mt-5 space-y-4 border-t border-line pt-4">
            <div>
              <p className="mb-2 text-sm font-medium">Why this trip works for your group</p>
              <Reasons items={option.highlights} />
            </div>
            <Compromise items={option.compromises} />
          </div>
        )}
        {d.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {d.tags.map((t) => (
              <Pill key={t}>{t}</Pill>
            ))}
          </div>
        )}
      </Card>

      {view.results && (
        <section className="mt-8 animate-fade-up [animation-delay:260ms]">
          <Eyebrow className="mb-3">What your group agreed on</Eyebrow>
          <Consensus items={view.results.consensus} />
        </section>
      )}

      <div className="mt-8 flex justify-center">
        <ButtonLink href="/" variant="ghost" className="text-sm">
          Plan another trip
        </ButtonLink>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ResultsView({ initial }: { initial: TripView }) {
  const { view, phase, accept } = useTrip(initial);
  const seenKey = storageKeys.matchingSeen(view.id);
  const seen = useStored("session", seenKey);
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onMatched = useCallback(() => {
    writeStored("session", seenKey, "1");
    setFinished(true);
    window.scrollTo({ top: 0 });
  }, [seenKey]);

  const onDecided = useCallback(
    (next: TripView, message?: string) => {
      accept(next);
      if (message) setNote(message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [accept],
  );

  const base = `/t/${view.id}`;

  if (phase === "decided" && view.decision) return <DecisionLocked view={view} note={note} />;

  if (phase !== "locked" || !view.results) {
    return (
      <Shell step={1}>
        <Notice
          icon={<Hourglass className="size-5" aria-hidden />}
          title="Options unlock when everyone has submitted"
          action={
            <ButtonLink href={`${base}/status`}>
              View group status <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          }
        >
          <p>
            {view.submittedCount} of {view.total} submitted so far. Matching runs once all preferences are locked.
          </p>
        </Notice>
      </Shell>
    );
  }

  if (!seen && !finished) return <MatchingTransition onDone={onMatched} />;

  const r = view.results;

  return (
    <Shell step={3}>
      <section className="animate-fade-up">
        <Eyebrow className="inline-flex items-center gap-1.5">
          <LockKeyhole className="size-3" aria-hidden /> Preferences locked
        </Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{r.headline}</h1>
        <p className="mt-3 text-muted">{r.subhead}</p>
        <p className="mt-3 text-xs text-muted">{funnelText(r)}</p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Your group&apos;s overlap</h2>
        <Consensus items={r.consensus} />
      </section>

      {r.options.length > 0 ? (
        <>
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Top options</h2>
            <div className="space-y-3">
              {r.options.map((o, i) => (
                <OptionCard key={o.tripId} option={o} index={i} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Estimates are per person from {ORIGIN_CITY}, travel + stay. Illustrative, not live prices.
            </p>
          </section>

          <section className="mt-10">
            <DecisionPanel view={view} options={r.options} onDecided={onDecided} />
          </section>
        </>
      ) : (
        <Card className="mt-10 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight">What now?</h2>
          <p className="mt-1 text-muted">
            These preferences are locked, so this round can&apos;t be edited. Start a new round and adjust the
            answer that&apos;s blocking the group.
          </p>
          <ButtonLink href="/" className="mt-5 w-full">
            Start a new round
          </ButtonLink>
        </Card>
      )}
    </Shell>
  );
}
