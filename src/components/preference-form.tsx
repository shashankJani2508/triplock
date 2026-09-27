"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  CircleCheck,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  Mountain,
  Sun,
  Timer,
  Trees,
  Wallet,
  Waves,
  Zap,
} from "lucide-react";
import {
  BUDGET_BANDS,
  DEALBREAKERS,
  DESTINATION_TYPES,
  WEEKENDS,
  budgetBand,
  destinationType,
  type BudgetBandId,
  type DealbreakerId,
  type DestinationTypeId,
  type WeekendId,
} from "@/lib/config";
import { api, ApiError } from "@/lib/client/api";
import { storageKeys, useStored, writeStored } from "@/lib/client/storage";
import { useTrip } from "@/lib/client/use-trip";
import { plural } from "@/lib/format";
import type { TripView } from "@/lib/types";
import { Notice } from "./notices";
import { Shell } from "./shell";
import { stepFor } from "./trip-overview";
import { Avatar, Button, ButtonLink, Eyebrow, ProgressBar, cx } from "./ui";

const TYPE_ICONS: Record<DestinationTypeId, ReactNode> = {
  beach: <Waves className="size-5" aria-hidden />,
  mountains: <Mountain className="size-5" aria-hidden />,
  nature: <Trees className="size-5" aria-hidden />,
  culture: <Landmark className="size-5" aria-hidden />,
  adventure: <Zap className="size-5" aria-hidden />,
  relaxed: <Sun className="size-5" aria-hidden />,
};

const QUESTIONS = 4;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Choice({
  selected,
  onClick,
  title,
  detail,
  icon,
  tone = "default",
  multi,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
  icon?: ReactNode;
  tone?: "default" | "veto";
  multi: boolean;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      aria-label={detail ? `${title}: ${detail}` : title}
      onClick={onClick}
      className={cx(
        "group relative flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        selected
          ? tone === "veto"
            ? "border-veto bg-veto-soft shadow-[0_0_0_1px_var(--color-veto)]"
            : "border-ink shadow-[0_0_0_1px_var(--color-ink)]"
          : "border-line hover:border-line-strong",
      )}
    >
      {icon && (
        <span
          className={cx(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
            selected ? (tone === "veto" ? "bg-veto text-white" : "bg-ink text-white") : "bg-canvas text-ink-soft",
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        {detail && <span className="mt-0.5 block text-sm text-muted">{detail}</span>}
      </span>
      <span
        aria-hidden
        className={cx(
          "inline-flex size-6 shrink-0 items-center justify-center border transition-colors",
          multi ? "rounded-md" : "rounded-full",
          selected
            ? tone === "veto"
              ? "border-veto bg-veto text-white"
              : "border-ink bg-ink text-white"
            : "border-line-strong bg-surface text-transparent",
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

export function PreferenceForm({ initial }: { initial: TripView }) {
  const { view, phase, accept, refresh } = useTrip(initial);
  const meId = useStored("local", storageKeys.me(view.id));

  const [participantId, setParticipantId] = useState<string | null>(null);
  const [step, setStep] = useState(-1); // -1 = who's submitting
  const [budget, setBudget] = useState<BudgetBandId | null>(null);
  const [weekends, setWeekends] = useState<WeekendId[]>([]);
  const [types, setTypes] = useState<DestinationTypeId[]>([]);
  const [dealbreakers, setDealbreakers] = useState<DealbreakerId[]>([]);
  const [noDealbreakers, setNoDealbreakers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TripView | null>(null);
  const inFlight = useRef(false);

  const person = view.participants.find((p) => p.id === participantId);
  const base = `/t/${view.id}`;

  /** Each question starts at the top, so its title and warnings are never scrolled away. */
  function go(next: number) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  function reset() {
    setParticipantId(null);
    setStep(-1);
    setBudget(null);
    setWeekends([]);
    setTypes([]);
    setDealbreakers([]);
    setNoDealbreakers(false);
    setError(null);
    setDone(null);
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (!participantId || !budget || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const next = await api.submit(view.id, {
        participantId,
        budgetBand: budget,
        freeWeekends: weekends,
        destinationTypes: types,
        dealbreakers: noDealbreakers ? [] : dealbreakers,
      });
      writeStored("local", storageKeys.me(view.id), participantId);
      accept(next);
      setDone(next);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "already_submitted") {
        setError(`${person?.name ?? "This person"} has already submitted. Submitted answers can't be changed.`);
      } else {
        setError(err?.message ?? "Something went wrong. Please try again.");
      }
      void refresh(); // pick up a lock or a closed deadline
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  // ----- Terminal states -----------------------------------------------------

  if (done) {
    const locked = done.phase === "locked";
    return (
      <Shell step={locked ? 3 : 1}>
        <div className="animate-fade-up text-center">
          <span className="mx-auto inline-flex size-16 animate-pop items-center justify-center rounded-full bg-agree text-white">
            <Check className="size-8" strokeWidth={3} aria-hidden />
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Preferences submitted</h1>
          <p className="mt-2 text-lg text-muted">You are done.</p>
        </div>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-5 animate-fade-up [animation-delay:120ms]">
          {locked ? (
            <>
              <p className="inline-flex items-center gap-2 font-medium text-agree">
                <LockKeyhole className="size-4" aria-hidden /> Everyone&apos;s in. Preferences are now locked.
              </p>
              <p className="mt-1 text-sm text-muted">You were the last one. Your group&apos;s options are ready.</p>
              <ButtonLink href={`${base}/results`} className="mt-5 w-full">
                See your options <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className="font-medium">Group progress</p>
                <p className="text-sm tabular-nums text-muted">
                  {done.submittedCount} / {done.total} submitted
                </p>
              </div>
              <ProgressBar value={done.submittedCount} total={done.total} className="mt-3" />
              <p className="mt-3 text-sm text-muted">
                Answers lock automatically once all {done.total} are in. Nobody sees what you picked.
              </p>
              <ButtonLink href={`${base}/status`} className="mt-5 w-full">
                View group status <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <Button variant="ghost" onClick={reset} className="mt-1 w-full text-sm">
                Submitting for someone else on this device?
              </Button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  if (phase === "locked" || phase === "decided") {
    return (
      <Shell step={stepFor(phase, "submit")}>
        <Notice
          icon={<LockKeyhole className="size-5" aria-hidden />}
          title="Preferences are locked"
          action={
            <ButtonLink href={`${base}/results`}>
              {phase === "decided" ? "View decision" : "See your options"} <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          }
        >
          <p>Your group&apos;s preferences have been locked. Nobody can edit their answers now.</p>
        </Notice>
      </Shell>
    );
  }

  if (phase === "expired") {
    return (
      <Shell step={1}>
        <Notice
          icon={<Timer className="size-5" aria-hidden />}
          title="Preferences are closed"
          action={
            <ButtonLink href={`${base}/status`}>
              View group status <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          }
        >
          <p>
            The deadline passed with {view.submittedCount} of {view.total} submitted. The group can reopen it
            from the status page.
          </p>
        </Notice>
      </Shell>
    );
  }

  // ----- Who's submitting ----------------------------------------------------

  if (step === -1 || !person) {
    return (
      <Shell step={0}>
        <div className="animate-fade-up">
          <Eyebrow>{view.name}</Eyebrow>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Who&apos;s submitting?</h1>
          <p className="mt-2 text-muted">Pick your name. Each person submits once, and answers stay private.</p>
        </div>
        <div className="mt-6 space-y-2">
          {view.participants.map((p, i) => (
            <button
              key={p.id}
              type="button"
              disabled={p.submitted}
              aria-label={p.submitted ? `${p.name}, already submitted` : `Submit as ${p.name}`}
              onClick={() => {
                setParticipantId(p.id);
                go(0);
              }}
              className="flex w-full animate-fade-up items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:bg-canvas"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <Avatar name={p.name} submitted={p.submitted} />
              <span className={cx("flex-1 font-medium", p.submitted && "text-muted")}>
                {p.name}
                {p.id === meId && <span className="ml-1.5 text-sm font-normal text-muted">(this device)</span>}
              </span>
              {p.submitted ? (
                <span className="inline-flex items-center gap-1 text-sm text-agree">
                  <CircleCheck className="size-4" aria-hidden /> Submitted
                </span>
              ) : (
                <ArrowRight className="size-4 text-muted" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  // ----- The four questions ---------------------------------------------------

  const canContinue = [
    budget !== null,
    weekends.length > 0,
    types.length > 0,
    dealbreakers.length > 0 || noDealbreakers,
  ][step];

  let body: ReactNode;
  if (step === 0) {
    body = (
      <Question
        icon={<Wallet className="size-4" aria-hidden />}
        title="What's your budget?"
        hint="Per person, travel + stay. Pick the most you'd be comfortable spending."
      >
        {BUDGET_BANDS.map((b) => (
          <Choice
            key={b.id}
            multi={false}
            selected={budget === b.id}
            title={b.label}
            onClick={() => {
              setBudget(b.id);
              setTimeout(() => go(1), 220);
            }}
          />
        ))}
      </Question>
    );
  } else if (step === 1) {
    body = (
      <Question
        icon={<CalendarDays className="size-4" aria-hidden />}
        title="Which weekends are you free?"
        hint="Pick every weekend you could make. All are Friday to Sunday."
      >
        <div className="grid grid-cols-2 gap-2">
          {WEEKENDS.map((w) => (
            <Choice
              key={w.id}
              multi
              selected={weekends.includes(w.id)}
              title={w.label}
              detail="Fri–Sun"
              onClick={() => setWeekends((list) => toggle(list, w.id))}
            />
          ))}
        </div>
      </Question>
    );
  } else if (step === 2) {
    body = (
      <Question
        icon={<Waves className="size-4" aria-hidden />}
        title="What kind of trip?"
        hint="Pick everything that appeals to you."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {DESTINATION_TYPES.map((t) => (
            <Choice
              key={t.id}
              multi
              icon={TYPE_ICONS[t.id]}
              selected={types.includes(t.id)}
              title={t.label}
              onClick={() => setTypes((list) => toggle(list, t.id))}
            />
          ))}
        </div>
      </Question>
    );
  } else {
    body = (
      <Question
        icon={<Ban className="size-4" aria-hidden />}
        title="Any dealbreakers?"
        hint="Only pick what you'd refuse to go on."
      >
        <div className="flex gap-3 rounded-2xl border border-veto/20 bg-veto-soft p-4 text-sm text-veto">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">Dealbreaker = hard no.</strong> Any trip with it is removed for the
            whole group, however much everyone else likes it.
          </p>
        </div>
        {DEALBREAKERS.map((d) => (
          <Choice
            key={d.id}
            multi
            tone="veto"
            selected={dealbreakers.includes(d.id)}
            title={d.label}
            detail={d.detail}
            onClick={() => {
              setNoDealbreakers(false);
              setDealbreakers((list) => toggle(list, d.id));
            }}
          />
        ))}
        <div className="flex items-center gap-3 py-1 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>
        <Choice
          multi={false}
          selected={noDealbreakers}
          title="No dealbreakers, I'm flexible"
          onClick={() => {
            setDealbreakers([]);
            setNoDealbreakers(true);
          }}
        />
      </Question>
    );
  }

  const isLast = step === QUESTIONS - 1;

  return (
    <Shell step={0}>
      <div className="pb-28 sm:pb-0">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            className="-ml-3"
            onClick={() => go(step - 1)}
            aria-label={step === 0 ? "Change name" : "Previous question"}
          >
            <ArrowLeft className="size-4" aria-hidden /> {step === 0 ? person.name : "Back"}
          </Button>
          <p className="text-sm font-medium tabular-nums text-muted">
            {step + 1} of {QUESTIONS}
          </p>
        </div>
        <ProgressBar value={step + 1} total={QUESTIONS} className="mt-2" />

        <div key={step} className="mt-8 animate-fade-up">
          {body}
        </div>

        {isLast && canContinue && budget && (
          <p className="mt-6 text-sm text-muted">
            <span className="font-medium text-ink">Your answers:</span> {budgetBand(budget).label} budget ·{" "}
            {weekends.length} {plural(weekends.length, "weekend")} · {types.map((t) => destinationType(t).label).join(", ")}{" "}
            · {noDealbreakers ? "no dealbreakers" : `${dealbreakers.length} ${plural(dealbreakers.length, "hard no", "hard noes")}`}
            . Submitting locks them; they can&apos;t be edited later.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-veto-soft p-3 text-sm text-veto">
            {error}
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="mx-auto max-w-xl">
          {isLast ? (
            <Button onClick={submit} disabled={!canContinue || submitting} className="w-full">
              {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              {submitting ? "Submitting…" : "Submit preferences"}
            </Button>
          ) : (
            <Button onClick={() => go(step + 1)} disabled={!canContinue} className="w-full">
              Next <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Question({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section role="group" aria-labelledby="question-title">
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-surface text-ink-soft ring-1 ring-line">
        {icon}
      </span>
      <h1 id="question-title" className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-muted">{hint}</p>
      <div className="mt-6 space-y-2">{children}</div>
    </section>
  );
}
