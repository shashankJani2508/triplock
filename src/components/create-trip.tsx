"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useNow } from "@/lib/client/clock";
import { storageKeys, useStored } from "@/lib/client/storage";
import { formatCountdown, formatDeadline } from "@/lib/format";
import { Button, ButtonLink, Card, cx } from "./ui";

interface DeadlineOption {
  key: string;
  date: Date;
}

function at2359(now: number, daysAhead: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(23, 59, 0, 0);
  return d;
}

/** Tonight (if there's still time), tomorrow, and the coming Sunday. */
function deadlineOptions(now: number): DeadlineOption[] {
  const options: DeadlineOption[] = [];
  const tonight = at2359(now, 0);
  if (tonight.getTime() - now > 3_600_000) options.push({ key: "tonight", date: tonight });
  options.push({ key: "tomorrow", date: at2359(now, 1) });
  const daysToSunday = (7 - new Date(now).getDay()) % 7 || 7;
  if (daysToSunday > 1) options.push({ key: "sunday", date: at2359(now, daysToSunday) });
  return options;
}

export function CreateTrip() {
  const router = useRouter();
  const now = useNow();
  const lastTrip = useStored("local", storageKeys.lastTrip);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = now === 0 ? [] : deadlineOptions(now);
  const selected = options.find((o) => o.key === picked) ?? options[options.length - 1];

  async function start() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createTrip(selected.date.toISOString());
      router.push(`/t/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="font-medium">When should preferences close?</p>
      <p className="mt-1 text-sm text-muted">
        Everyone submits before this. When all five are in, answers lock automatically.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Deadline">
        {options.length === 0
          ? [0, 1, 2].map((i) => <div key={i} className="h-[62px] rounded-xl border border-line bg-canvas" />)
          : options.map((o) => {
              const active = o.key === selected?.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPicked(o.key)}
                  className={cx(
                    "relative rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                    active ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <span className="block text-sm font-medium">{formatDeadline(o.date.toISOString(), now)}</span>
                  <span className={cx("block text-xs", active ? "text-white/70" : "text-muted")}>
                    closes in {formatCountdown(o.date.getTime() - now)}
                  </span>
                  {active && <Check className="absolute top-3 right-3 size-4" aria-hidden />}
                </button>
              );
            })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-veto">
          {error}
        </p>
      )}

      <Button onClick={start} disabled={!selected || busy} className="mt-5 w-full">
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
