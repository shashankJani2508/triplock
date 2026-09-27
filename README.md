# TripLock

**Plan the trip. End the debate.** Five preferences. One clear decision.

TripLock is a structured group-decision tool built for the *"Group Trip That Never Happens"* scenario (Mesa AI-Native Track, L2, Part B). Five friends (Riya, Siddharth, Karan, Aisha and Preethi) have 1,200+ WhatsApp messages and zero plans. TripLock replaces the endless thread with one short process:

> **Collect individually → synthesize collectively → decide together → lock the decision.**

It is not a travel marketplace, booking platform or AI planner. It turns five people's preferences into 2–3 mutually workable trips and one locked decision.

---

## The journey

| Step | What happens |
| --- | --- |
| **Submit** | Everyone answers four tap-only questions (budget, free weekends, destination type, dealbreakers) in under a minute. |
| **Track** | The group sees *who* has submitted (e.g. 4/5), never *what* they said, plus a live deadline countdown. |
| **Lock** | The 5th submission locks preferences automatically. Nobody can edit afterwards; the database rejects it. |
| **Match** | A deterministic engine vetoes trips that hit any dealbreaker, scores the survivors on overlap and picks 2–3 distinct options. |
| **Decide** | The results page shows group-level consensus ("Everyone is comfortable up to ₹15,000") and the options. One person confirms the choice. |
| **Lock** | The decision is locked for everyone ("Decision locked · South Goa · 13–15 November"). Preferences never reopen. |

### Product decisions

- **Everyone must submit.** No partial-results workflow, so nobody can later say "I never agreed to this."
- **No raw answers are ever shown.** The API only returns names plus a submitted/waiting flag. The matching engine receives anonymous preference arrays with no names, so its output *can't* attribute answers to people.
- **Dealbreakers are vetoes, not negative scores.** One "No trekking" removes every trek-based trip, however much the other four like it.
- **No fake precision.** Options are labelled *Strong group fit / Good group fit / Some compromise*, never "87.43%". Near-equal options are shown side by side and marked as an even match.
- **The deadline is real.** The server rejects submissions after it. If it passes before everyone submits, the group can explicitly reopen collection for 24 hours; existing submissions stay locked.

### Assumptions (easy to change in `src/lib/config.ts`)

- The four weekends are the Fri–Sun weekends of **November 2026** (6–8, 13–15, 20–22, 27–29 Nov). The brief's example dates (7–9 Nov and so on) fall in 2025.
- Trip estimates assume travel **from Bengaluru**. The 19-trip catalog uses illustrative cost bands and travel-effort tiers, not live prices.
- A budget answer means *"the most I'm comfortable spending"*, so the group's comfortable ceiling is the lowest answer.
- There is no login (as the brief asks). Anyone with the trip link can submit for a person who hasn't submitted yet. Fine for a friend group, but not tamper-proof.

---

## How matching works

The engine lives in `src/lib/matching.ts` and is a pure function: same input, same output, with no LLM involved.

1. **Hard filters.** A trip is removed if it:
   - triggers **any** submitted dealbreaker (veto);
   - costs two or more budget bands above someone's comfortable maximum (out of reach); or
   - has no weekend that at least all-but-one of the group can make.
2. **Overlap score** for survivors: `0.35 × date overlap + 0.25 × budget comfort + 0.40 × destination-type alignment − travel-effort penalty`. Type alignment gives full credit when a trip's main character is one you picked, and partial credit for a secondary match.
3. **Tiers.**
   - *Strong*: no compromises and a high score.
   - *Good*: at most one minor compromise and everyone can make the date.
   - *Some compromise*: anything else.
4. **Selection.** Up to three options, best tier first. Within a tier it prefers different destination characters and regions, so the group gets a real choice. Options in the same tier within 0.03 of each other are flagged as an even match.
5. **Consensus.** Budget = the lowest ceiling. Dates = weekends everyone is free. Destination = the types with the most overlap. Dealbreakers = how many trips were vetoed.

---

## Tech stack

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **Supabase** (Postgres) for persistence, accessed only from the server
- **Vercel** for hosting
- **Vitest** + **PGlite** (real Postgres in WASM) for tests

### Where the lock rules live

The rules are enforced in the database (`supabase/schema.sql`), not just the UI:

- `submit_preferences()` inserts a submission and locks the group on the last one, in one transaction holding a row lock (no double submits under concurrency).
- A trigger makes submissions **write-once**; another only lets a group move forward: `open → locked → decided`.
- `decide_trip()` accepts the first decision only. Later calls fail.
- Row Level Security is on with **no policies**: the public anon key can read nothing. Only the Next.js server, using the service-role key, can call the functions.

---

## Project structure

```
src/
  app/
    page.tsx                     Landing + start a trip (deadline picker)
    t/[id]/page.tsx              Trip overview (the link friends receive)
    t/[id]/submit/page.tsx       4-question preference form
    t/[id]/status/page.tsx       Submission tracker + deadline
    t/[id]/results/page.tsx      Matching → consensus → options → decision lock
    api/groups/...               Route handlers (create, view, submit, decide, extend)
  components/                    UI (preference form, status board, results view, …)
  lib/
    config.ts                    Participants, answer options, weekends, deadlines
    catalog.ts                   19 curated trips with structured attributes
    matching.ts                  Deterministic matching engine
    validation.ts                Request validation (zod)
    server/trips.ts              Service layer: builds the privacy-safe public view
    server/store/                Storage: Supabase (prod) and a JSON file (local dev)
    client/                      Polling hook, clock, API client, browser storage
supabase/schema.sql              Tables, lock triggers, functions, access control
scripts/migrate.mjs              Applies schema.sql during `npm run build`
scripts/e2e.ts                   End-to-end journey test against a running server
tests/                           Engine tests + SQL tests (PGlite)
```

---

## Run locally

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase variables set, the app uses a local file store at `.data/triplock.json`, so it works immediately. Delete that file to reset.

To run against Supabase locally, copy `.env.example` to `.env.local` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Tests

```bash
npm test              # 25 unit + database tests (matching engine, SQL lock rules on real Postgres)
npm run build && npm start
npm run test:e2e      # full journey against http://localhost:3000 (Scenarios A–F + deadline, ~90s)
```

Point the end-to-end test at a deployment with `BASE_URL=https://your-app.vercel.app npm run test:e2e`. It creates real trips there. Set `SKIP_DEADLINE=1` to skip the ~70-second deadline wait.

---

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Server | Supabase project URL (`NEXT_PUBLIC_SUPABASE_URL` is also accepted) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, secret | Server-only key (`SUPABASE_SECRET_KEY` is also accepted) |
| `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL` / `DATABASE_URL` | Build, secret | Optional. When present, the build applies `supabase/schema.sql` automatically |

No variable is exposed to the browser.

## Database setup

**Option A: automatic (recommended on Vercel).** In the Vercel project, open **Storage → Create/Connect → Supabase** and connect it to the project. Redeploy. The build applies the schema automatically using the connection string the integration provides.

**Option B: manual.** Create a project at supabase.com. Open **SQL Editor**, paste the contents of `supabase/schema.sql` and run it (it's safe to re-run). Then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from **Project Settings → API**.

## Deploy to Vercel

```bash
vercel link          # or import the GitHub repo at vercel.com/new
vercel deploy --prod
```

Then connect Supabase (above) and redeploy. Without a database, the deployed site shows a "Database not connected yet" notice instead of failing silently. Serverless functions have no durable disk, so the local file store is deliberately disabled on Vercel.
