import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Check } from "lucide-react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,border-color,color,transform,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40 select-none";

const variants: Record<Variant, string> = {
  primary: "h-12 px-5 bg-ink text-white hover:bg-ink-soft",
  secondary: "h-12 px-5 border border-line bg-surface text-ink hover:border-line-strong hover:bg-canvas",
  ghost: "h-10 px-3 text-muted hover:text-ink",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={cx(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(base, variants[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)} {...props} />;
}

type Tone = "neutral" | "agree" | "wait" | "veto";

const tones: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-soft border-line",
  agree: "bg-agree-soft text-agree border-transparent",
  wait: "bg-wait-soft text-wait border-transparent",
  veto: "bg-veto-soft text-veto border-transparent",
};

export function Pill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("text-xs font-medium tracking-[0.08em] text-muted uppercase", className)}>{children}</p>
  );
}

export function Avatar({ name, submitted, size = "md" }: { name: string; submitted?: boolean; size?: "md" | "lg" }) {
  return (
    <span className="relative inline-flex">
      <span
        aria-hidden
        className={cx(
          "inline-flex items-center justify-center rounded-full border font-medium",
          size === "lg" ? "size-12 text-base" : "size-9 text-sm",
          submitted ? "border-agree/25 bg-agree-soft text-agree" : "border-line bg-surface text-ink-soft",
        )}
      >
        {name.charAt(0)}
      </span>
      {submitted && (
        <span className="absolute -right-0.5 -bottom-0.5 inline-flex size-4 animate-pop items-center justify-center rounded-full bg-agree text-white ring-2 ring-surface">
          <Check className="size-2.5" strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}

export function ProgressBar({ value, total, className }: { value: number; total: number; className?: string }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      className={cx("h-2 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          value >= total ? "bg-agree" : "bg-ink",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
