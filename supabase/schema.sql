-- =============================================================================
-- TripLock — database schema (Postgres: Neon, Supabase, or any Postgres 14+)
--
-- Applied automatically by `npm run build` when a Postgres URL is set
-- (scripts/migrate.mjs). Can also be pasted into the Supabase SQL editor.
-- Safe to re-run: tables use IF NOT EXISTS and functions use CREATE OR REPLACE.
--
-- Security model: the browser never talks to the database. Only the Next.js
-- server does. Row Level Security is enabled with no policies; on Supabase the
-- public anon key can read or write nothing.
--
-- Lock rules live here, not just in the UI:
--   * a submission is write-once (updates are rejected by trigger)
--   * a group only moves forward: open → locked → decided
--   * submit / decide run as single transactions holding a row lock on the
--     group, so concurrent requests cannot double-submit or double-decide
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.groups (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  deadline         timestamptz not null,
  status           text not null default 'open' check (status in ('open', 'locked', 'decided')),
  selected_trip_id text,
  selected_weekend text,
  locked_at        timestamptz,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint groups_locked_has_time check (status = 'open' or locked_at is not null),
  constraint groups_decided_has_trip check (
    status <> 'decided'
    or (selected_trip_id is not null and selected_weekend is not null and decided_at is not null)
  )
);

create table if not exists public.participants (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name     text not null check (char_length(name) between 1 and 40),
  position int  not null,
  unique (group_id, name),
  unique (group_id, position),
  unique (id, group_id)
);

create index if not exists participants_group_id_idx on public.participants (group_id);

create table if not exists public.preference_submissions (
  participant_id    uuid primary key,
  group_id          uuid not null references public.groups (id) on delete cascade,
  budget_band       text not null
    check (budget_band in ('under_10k', '10k_15k', '15k_20k', '20k_plus')),
  free_weekends     text[] not null check (cardinality(free_weekends) >= 1),
  destination_types text[] not null check (
    cardinality(destination_types) >= 1
    and destination_types <@ array['beach', 'mountains', 'nature', 'culture', 'adventure', 'relaxed']
  ),
  dealbreakers      text[] not null default '{}' check (
    dealbreakers <@ array['no_trekking', 'no_nightlife', 'no_long_travel', 'no_extreme_adventure', 'no_expensive']
  ),
  submitted_at      timestamptz not null default now(),
  -- A participant's answers lock the moment they submit.
  locked_at         timestamptz not null default now(),
  -- The participant must belong to the same group.
  foreign key (participant_id, group_id)
    references public.participants (id, group_id) on delete cascade
);

create index if not exists preference_submissions_group_id_idx
  on public.preference_submissions (group_id);

-- -----------------------------------------------------------------------------
-- Guards (triggers)
-- -----------------------------------------------------------------------------

-- Submissions are write-once: nobody can silently edit their answers.
create or replace function public.reject_submission_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'submission_immutable' using errcode = 'P0001';
end;
$$;

drop trigger if exists preference_submissions_immutable on public.preference_submissions;
create trigger preference_submissions_immutable
  before update on public.preference_submissions
  for each row execute function public.reject_submission_update();

-- New submissions are only accepted while the group is open and before the deadline.
create or replace function public.guard_submission_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status   text;
  v_deadline timestamptz;
begin
  select status, deadline into v_status, v_deadline
  from public.groups where id = new.group_id;

  if v_status is distinct from 'open' then
    raise exception 'preferences_locked' using errcode = 'P0001';
  end if;
  if now() > v_deadline then
    raise exception 'deadline_passed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists preference_submissions_guard_insert on public.preference_submissions;
create trigger preference_submissions_guard_insert
  before insert on public.preference_submissions
  for each row execute function public.guard_submission_insert();

-- Group state only moves forward. Locked preferences never reopen; a decided
-- trip never changes.
create or replace function public.guard_group_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'decided' then
    raise exception 'decision_locked' using errcode = 'P0001';
  end if;
  if old.status = 'locked' then
    if new.status not in ('locked', 'decided') or new.deadline is distinct from old.deadline then
      raise exception 'preferences_locked' using errcode = 'P0001';
    end if;
  end if;
  if old.status = 'open' and new.status = 'decided' then
    raise exception 'not_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_guard_update on public.groups;
create trigger groups_guard_update
  before update on public.groups
  for each row execute function public.guard_group_update();

-- -----------------------------------------------------------------------------
-- Operations (called by the server via supabase.rpc)
-- -----------------------------------------------------------------------------

create or replace function public.create_group(
  p_name         text,
  p_deadline     timestamptz,
  p_participants text[]
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_deadline <= now() then
    raise exception 'invalid_deadline' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_participants), 0) < 2 then
    raise exception 'invalid_participants' using errcode = 'P0001';
  end if;

  insert into public.groups (name, deadline) values (p_name, p_deadline)
  returning id into v_id;

  insert into public.participants (group_id, name, position)
  select v_id, t.name, t.ord::int
  from unnest(p_participants) with ordinality as t (name, ord);

  return v_id;
end;
$$;

-- One consistent read of a group (single statement = single snapshot), so a
-- reader never sees "locked" with a partial set of submissions.
create or replace function public.get_group_snapshot(p_group_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'group', to_jsonb(g),
    'participants', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.position)
       from public.participants p where p.group_id = g.id),
      '[]'::jsonb),
    'submissions', coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.submitted_at)
       from public.preference_submissions s where s.group_id = g.id),
      '[]'::jsonb)
  )
  from public.groups g
  where g.id = p_group_id
$$;

-- Inserts one submission and, if it was the last one, locks the group — all in
-- one transaction. The FOR UPDATE row lock serialises concurrent submissions.
create or replace function public.submit_preferences(
  p_group_id          uuid,
  p_participant_id    uuid,
  p_budget_band       text,
  p_free_weekends     text[],
  p_destination_types text[],
  p_dealbreakers      text[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_group     public.groups%rowtype;
  v_total     int;
  v_submitted int;
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_group.status <> 'open' then
    raise exception 'preferences_locked' using errcode = 'P0001';
  end if;
  if now() > v_group.deadline then
    raise exception 'deadline_passed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.participants where id = p_participant_id and group_id = p_group_id
  ) then
    raise exception 'participant_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.preference_submissions where participant_id = p_participant_id) then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;

  insert into public.preference_submissions
    (participant_id, group_id, budget_band, free_weekends, destination_types, dealbreakers)
  values
    (p_participant_id, p_group_id, p_budget_band, p_free_weekends, p_destination_types,
     coalesce(p_dealbreakers, '{}'));

  select count(*) into v_total from public.participants where group_id = p_group_id;
  select count(*) into v_submitted from public.preference_submissions where group_id = p_group_id;

  if v_submitted >= v_total then
    update public.groups set status = 'locked', locked_at = now() where id = p_group_id;
  end if;

  return jsonb_build_object(
    'submitted', v_submitted,
    'total', v_total,
    'locked', v_submitted >= v_total
  );
end;
$$;

-- Locks the group's final choice. First decision wins; later calls fail.
create or replace function public.decide_trip(
  p_group_id uuid,
  p_trip_id  text,
  p_weekend  text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_status = 'decided' then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;
  if v_status <> 'locked' then
    raise exception 'not_locked' using errcode = 'P0001';
  end if;

  update public.groups
  set status = 'decided', selected_trip_id = p_trip_id, selected_weekend = p_weekend, decided_at = now()
  where id = p_group_id;
end;
$$;

-- Only allowed once the deadline has passed without everyone submitting.
-- Existing submissions stay locked; the missing people get more time.
create or replace function public.extend_deadline(
  p_group_id uuid,
  p_hours    int
)
returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
  v_new   timestamptz;
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_group.status <> 'open' then
    raise exception 'preferences_locked' using errcode = 'P0001';
  end if;
  if v_group.deadline > now() then
    raise exception 'not_expired' using errcode = 'P0001';
  end if;
  if p_hours < 1 or p_hours > 72 then
    raise exception 'invalid_extension' using errcode = 'P0001';
  end if;

  v_new := now() + make_interval(hours => p_hours);
  update public.groups set deadline = v_new where id = p_group_id;
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Access control
-- -----------------------------------------------------------------------------

alter table public.groups                 enable row level security;
alter table public.participants           enable row level security;
alter table public.preference_submissions enable row level security;
-- (No policies on purpose: only the owner / service role can touch the data.)

-- Nobody but the owner may call the operations directly.
revoke all on function public.create_group(text, timestamptz, text[]) from public;
revoke all on function public.get_group_snapshot(uuid) from public;
revoke all on function public.submit_preferences(uuid, uuid, text, text[], text[], text[]) from public;
revoke all on function public.decide_trip(uuid, text, text) from public;
revoke all on function public.extend_deadline(uuid, int) from public;

-- Supabase only: its public API roles get nothing; the server's service role
-- gets everything. Skipped on plain Postgres (e.g. Neon), where the app
-- connects as the owner and these roles don't exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated')
     and exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.groups, public.participants, public.preference_submissions
      from anon, authenticated;
    grant all on table public.groups, public.participants, public.preference_submissions
      to service_role;

    revoke all on function public.create_group(text, timestamptz, text[]) from anon, authenticated;
    revoke all on function public.get_group_snapshot(uuid) from anon, authenticated;
    revoke all on function public.submit_preferences(uuid, uuid, text, text[], text[], text[]) from anon, authenticated;
    revoke all on function public.decide_trip(uuid, text, text) from anon, authenticated;
    revoke all on function public.extend_deadline(uuid, int) from anon, authenticated;

    grant execute on function public.create_group(text, timestamptz, text[]) to service_role;
    grant execute on function public.get_group_snapshot(uuid) to service_role;
    grant execute on function public.submit_preferences(uuid, uuid, text, text[], text[], text[]) to service_role;
    grant execute on function public.decide_trip(uuid, text, text) to service_role;
    grant execute on function public.extend_deadline(uuid, int) to service_role;
  end if;
end
$$;

-- Ask Supabase's API layer to pick up the functions immediately (a no-op elsewhere).
notify pgrst, 'reload schema';
