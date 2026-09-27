import { CreateTrip } from "@/components/create-trip";
import { Shell, STEPS } from "@/components/shell";
import { Avatar, Eyebrow } from "@/components/ui";
import { DEFAULT_PARTICIPANTS } from "@/lib/config";

const STEP_COPY: Record<(typeof STEPS)[number], string> = {
  Submit: "Everyone answers five quick questions.",
  Track: "See who's in. Nobody sees anyone's answers.",
  Match: "Gemini finds the trips across India that fit everyone best.",
  Decide: "Pick from 2–3 trips that work for all.",
  Lock: "The decision is final. No reopening.",
};

export default function Home() {
  return (
    <Shell>
      <section className="animate-fade-up">
        <Eyebrow>Group trip decisions</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Plan the trip. End the debate.
        </h1>
        <p className="mt-3 text-lg text-muted">Five preferences. One clear decision.</p>

        <div className="mt-7 flex flex-wrap gap-x-4 gap-y-3">
          {DEFAULT_PARTICIPANTS.map((name) => (
            <span key={name} className="inline-flex items-center gap-2 text-sm font-medium text-ink-soft">
              <Avatar name={name} />
              {name}
            </span>
          ))}
        </div>
        <p className="mt-5 text-sm font-medium text-ink-soft">5 people · 5 questions · &lt;1 minute</p>
      </section>

      <section className="mt-8 animate-fade-up [animation-delay:80ms]">
        <CreateTrip />
      </section>

      <section className="mt-10 animate-fade-up [animation-delay:160ms]">
        <Eyebrow>How it works</Eyebrow>
        <ol className="mt-4 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-xs font-semibold text-ink-soft">
                {i + 1}
              </span>
              <p className="text-sm">
                <span className="font-medium">{step}</span>
                <span className="text-muted"> · {STEP_COPY[step]}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>
    </Shell>
  );
}
