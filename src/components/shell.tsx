import Link from "next/link";
import type { ReactNode } from "react";
import { Check, LockKeyhole } from "lucide-react";
import { cx } from "./ui";

export const STEPS = ["Submit", "Track", "Match", "Decide", "Lock"] as const;

/** The whole process at a glance. `current` = index of the active step; STEPS.length = all done. */
export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1.5 text-[11px] font-medium sm:gap-2 sm:text-xs" aria-label="Progress">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex items-center gap-1.5 sm:gap-2">
            {i > 0 && <span aria-hidden className={cx("h-px w-2.5 sm:w-4", done || active ? "bg-ink/40" : "bg-line-strong")} />}
            <span
              aria-current={active ? "step" : undefined}
              className={cx(
                "inline-flex items-center gap-1",
                active ? "text-ink" : done ? "text-agree" : "text-muted/70",
              )}
            >
              {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
              {active && <span aria-hidden className="size-1.5 rounded-full bg-ink" />}
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
      <span className="inline-flex size-7 items-center justify-center rounded-lg bg-ink text-white">
        <LockKeyhole className="size-3.5" strokeWidth={2.5} aria-hidden />
      </span>
      TripLock
    </Link>
  );
}

export function Shell({
  step,
  children,
  narrow = true,
}: {
  step?: number;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Logo />
          {step !== undefined && <Stepper current={step} />}
        </div>
      </header>
      <main className={cx("mx-auto w-full flex-1 px-4 pt-8 pb-16 sm:px-6 sm:pt-12", narrow ? "max-w-xl" : "max-w-3xl")}>
        {children}
      </main>
    </div>
  );
}
