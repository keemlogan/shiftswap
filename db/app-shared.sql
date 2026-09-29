-- ShiftSwap app: the shared store of the shared mode (spec §8, §9, NFR-14; iteration 8). Supabase PostgreSQL, public schema.
-- The API roles (publishable key) may only read. Every write goes through two SECURITY DEFINER functions:
--   app_commit(store, base_rev, changes)  applies the change set of one command in one transaction under a row lock
--                                          on the store, refuses a stale base revision and increments the revision;
--   app_reset(store)                      replaces the store's rows with the seed template moved to the current date.
-- Row triggers re-check what the server can decide without knowing the user: the state transitions of spec §7,
-- acceptance and approval only before the deadline and the shift start, expiry only when overdue (server time),
-- one open request per shift, read-only confirmed payroll and creation times close to the server time.
-- There are no accounts (demo accounts without passwords), so writes are limited per store (NFR-14).
-- Stores are created and deleted only by the database owner: insert into public.app_store (slug) values ('…'), then
-- select public.app_reset_store(id); to delete one, in one transaction: select set_config('app.seeding', 'on', true);
-- delete from public.app_store where slug = '…' (the row triggers would refuse the cascaded deletes otherwise).
-- Apply with: node run.mjs -f db/app-shared.sql (the file is idempotent).
-- Client settings of the shared mode (public by design; app/config.js): URL https://dbahxuegxnqsthntpuqy.supabase.co,
-- publishable key sb_publishable_Efbr07Evn3lAJUKUqmZWmg_EvWp5DkY, demo store 'dalbit'.

create table if not exists public.app_store (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  rev bigint not null default 0,
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Rate-limit counters (fixed one-minute windows and Korean calendar days). Not readable through the API.
create table if not exists public.app_store_gate (
  store_id bigint primary key references public.app_store (id) on delete cascade,
  minute_start timestamptz not null default now(),
  minute_count integer not null default 0,
  day date not null default (now() at time zone 'Asia/Seoul')::date,
  day_count integer not null default 0,
  reset_last timestamptz,
  reset_day date,
  reset_day_count integer not null default 0
);

-- The 11 tables of spec §8 in snake_case, one set per store. Foreign keys are checked at commit, so the rows of a
-- change set may arrive in any order.
create table if not exists public.app_workplace (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  name text not null check (char_length(name) between 1 and 100),
  regular_employees integer not null default 4 check (regular_employees >= 0),
  sub_attendance_policy text not null default 'EXCUSED' check (sub_attendance_policy in ('EXCUSED', 'ABSENT')),
  primary key (store_id, id)
);

create table if not exists public.app_worker (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  workplace_id bigint not null,
  role text not null check (role in ('OWNER', 'WORKER')),
  name text not null check (char_length(name) between 1 and 100),
  phone text check (char_length(phone) <= 40),
  hourly_wage integer check (hourly_wage > 0),
  contract_start date,
  contract_end date,
  probation_end date,
  simple_labor smallint not null default 0 check (simple_labor in (0, 1)),
  active smallint not null default 1 check (active in (0, 1)),
  primary key (store_id, id),
  foreign key (store_id, workplace_id) references public.app_workplace (store_id, id) deferrable initially deferred
);

create table if not exists public.app_fixed_schedule (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  worker_id bigint not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  primary key (store_id, id),
  foreign key (store_id, worker_id) references public.app_worker (store_id, id) deferrable initially deferred
);

create table if not exists public.app_shift (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  work_date date not null,
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  worker_id bigint not null,
  original_worker_id bigint,
  fixed_schedule_id bigint,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'WORKED', 'ABSENT')),
  primary key (store_id, id),
  foreign key (store_id, worker_id) references public.app_worker (store_id, id) deferrable initially deferred,
  foreign key (store_id, original_worker_id) references public.app_worker (store_id, id) deferrable initially deferred,
  foreign key (store_id, fixed_schedule_id) references public.app_fixed_schedule (store_id, id) deferrable initially deferred
);

create table if not exists public.app_sub_request (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  shift_id bigint not null,
  requester_id bigint not null,
  acceptor_id bigint,
  reason text check (char_length(reason) <= 200),
  deadline text not null check (deadline ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  status text not null check (status in ('REQUESTED', 'ACCEPTED', 'APPROVED', 'REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  created_at text not null check (created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  decided_at text check (decided_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  primary key (store_id, id),
  foreign key (store_id, shift_id) references public.app_shift (store_id, id) deferrable initially deferred,
  foreign key (store_id, requester_id) references public.app_worker (store_id, id) deferrable initially deferred,
  foreign key (store_id, acceptor_id) references public.app_worker (store_id, id) deferrable initially deferred
);
-- BR-03: at most one open request per shift.
create unique index if not exists app_sub_request_open_idx on public.app_sub_request (store_id, shift_id)
  where status in ('REQUESTED', 'ACCEPTED');

create table if not exists public.app_sub_request_target (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  sub_request_id bigint not null,
  worker_id bigint not null,
  response text not null default 'PENDING' check (response in ('PENDING', 'ACCEPTED', 'DECLINED', 'CLOSED')),
  responded_at text check (responded_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  primary key (store_id, id),
  foreign key (store_id, sub_request_id) references public.app_sub_request (store_id, id) deferrable initially deferred,
  foreign key (store_id, worker_id) references public.app_worker (store_id, id) deferrable initially deferred
);

create table if not exists public.app_attendance (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  shift_id bigint not null,
  clock_in text not null check (clock_in ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  clock_out text not null check (clock_out ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  confirmed smallint not null default 0 check (confirmed in (0, 1)),
  primary key (store_id, id),
  unique (store_id, shift_id) deferrable initially deferred,
  foreign key (store_id, shift_id) references public.app_shift (store_id, id) deferrable initially deferred
);

create table if not exists public.app_weekly_summary (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  worker_id bigint not null,
  week_start date not null,
  contract_hours double precision not null check (contract_hours >= 0),
  scheduled_hours double precision not null check (scheduled_hours >= 0),
  actual_hours double precision not null check (actual_hours >= 0),
  perfect_attendance smallint not null check (perfect_attendance in (0, 1)),
  holiday_eligible smallint not null check (holiday_eligible in (0, 1)),
  holiday_hours double precision not null check (holiday_hours >= 0),
  primary key (store_id, id),
  unique (store_id, worker_id, week_start) deferrable initially deferred,
  foreign key (store_id, worker_id) references public.app_worker (store_id, id) deferrable initially deferred
);

create table if not exists public.app_payroll (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  worker_id bigint not null,
  year_month text not null check (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  base_hours double precision not null,
  base_pay bigint not null,
  holiday_pay bigint not null,
  premium_pay bigint not null,
  total bigint not null,
  min_wage_warning smallint not null default 0 check (min_wage_warning in (0, 1)),
  min_wage_ack smallint not null default 0 check (min_wage_ack in (0, 1)),
  estimated smallint not null default 0 check (estimated in (0, 1)),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'CONFIRMED')),
  primary key (store_id, id),
  unique (store_id, worker_id, year_month) deferrable initially deferred,
  foreign key (store_id, worker_id) references public.app_worker (store_id, id) deferrable initially deferred
);

create table if not exists public.app_minimum_wage (
  store_id bigint not null references public.app_store (id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  hourly integer not null check (hourly > 0),
  primary key (store_id, year)
);

create table if not exists public.app_notification (
  store_id bigint not null references public.app_store (id) on delete cascade,
  id bigint not null,
  worker_id bigint not null,
  sub_request_id bigint,
  kind text not null check (kind in ('REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'TARGET_CLOSED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
    'REQUEST_EXPIRED', 'REQUEST_CANCELLED', 'REQUEST_FAILED', 'PAYROLL_DRAFT_READY')),
  message text not null check (char_length(message) between 1 and 1000),
  created_at text not null check (created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  read_at text check (read_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  primary key (store_id, id),
  foreign key (store_id, worker_id) references public.app_worker (store_id, id) deferrable initially deferred,
  foreign key (store_id, sub_request_id) references public.app_sub_request (store_id, id) deferrable initially deferred
);

-- ---- Helpers ----------------------------------------------------------------------------------------------------

-- Server time as the app writes it: Korea Standard Time, 'YYYY-MM-DDTHH:MM' (BR-12 in the shared mode).
create or replace function public.app_srv_now()
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI')
$$;

-- Move the date of 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' by p_days days.
create or replace function public.app_add_days(p_value text, p_days integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then null
    else to_char(left(p_value, 10)::date + p_days, 'YYYY-MM-DD') || substr(p_value, 11) end
$$;

-- Move every date written inside a text (notification messages) by p_days days, all at once.
create or replace function public.app_shift_dates(p_text text, p_days integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(p.part || coalesce(public.app_add_days(m.d[1], p_days), ''), '' order by p.n), p_text)
  from unnest(regexp_split_to_array(p_text, '[0-9]{4}-[0-9]{2}-[0-9]{2}')) with ordinality as p(part, n)
  left join regexp_matches(p_text, '([0-9]{4}-[0-9]{2}-[0-9]{2})', 'g') with ordinality as m(d, n) on m.n = p.n
$$;

-- Move the given keys of a template row by p_days days.
create or replace function public.app_move_row(p_row jsonb, p_keys text[], p_days integer)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_row || coalesce(jsonb_object_agg(k, public.app_add_days(p_row ->> k, p_days)) filter (where p_row ->> k is not null), '{}'::jsonb)
  from unnest(p_keys) as k
$$;

-- ---- Row triggers (NFR-14). app_reset_store sets app.seeding for its own transaction and is not checked. ------------

create or replace function public.app_check_sub_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_now text := public.app_srv_now();
  v_shift record;
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'RULE: a substitute request is never deleted'; end if;
  select s.status, s.worker_id, to_char(s.work_date, 'YYYY-MM-DD') || 'T' || s.start_time as start_at into v_shift
    from public.app_shift s where s.store_id = new.store_id and s.id = new.shift_id;
  if not found then raise exception 'RULE: the shift of the request does not exist'; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('REQUESTED', 'FAILED') or new.acceptor_id is not null then
      raise exception 'RULE: a new request is REQUESTED (or FAILED without candidates) and has no acceptor';
    end if;
    if v_shift.status <> 'SCHEDULED' or v_shift.worker_id <> new.requester_id then
      raise exception 'RULE: only the current worker of a scheduled shift can ask for a substitute (BR-03)';
    end if;
    if v_shift.start_at <= v_now or new.deadline <= v_now or new.deadline > v_shift.start_at then
      raise exception 'RULE: the shift must start later and the deadline must lie between now and the shift start (BR-03)';
    end if;
    if abs(extract(epoch from new.created_at::timestamp - v_now::timestamp)) > 600 then
      raise exception 'RULE: the creation time is more than 10 minutes from the server time';
    end if;
    return new;
  end if;
  if new.shift_id <> old.shift_id or new.requester_id <> old.requester_id or new.deadline <> old.deadline
     or new.reason is distinct from old.reason or new.created_at <> old.created_at then
    raise exception 'RULE: shift, requester, deadline, reason and creation time of a request do not change';
  end if;
  if new.acceptor_id is distinct from old.acceptor_id and not (old.status = 'REQUESTED' and new.status = 'ACCEPTED') then
    raise exception 'RULE: the acceptor is set once, by the acceptance';
  end if;
  if new.status = old.status then
    if new.decided_at is distinct from old.decided_at then raise exception 'RULE: the decision time changes only with the status'; end if;
    return new;
  end if;
  if old.status = 'REQUESTED' and new.status = 'ACCEPTED' then
    if new.acceptor_id is null or new.acceptor_id = new.requester_id or not exists (
      select 1 from public.app_sub_request_target t
      where t.store_id = new.store_id and t.sub_request_id = new.id and t.worker_id = new.acceptor_id) then
      raise exception 'RULE: only a worker who was asked can accept (BR-02)';
    end if;
    if new.deadline <= v_now or v_shift.start_at <= v_now then
      raise exception 'RULE: the request is overdue by server time and cannot be accepted (BR-12)';
    end if;
  elsif old.status = 'ACCEPTED' and new.status = 'APPROVED' then
    if new.deadline <= v_now or v_shift.start_at <= v_now then
      raise exception 'RULE: the request is overdue by server time and cannot be approved (BR-12)';
    end if;
  elsif old.status in ('REQUESTED', 'ACCEPTED') and new.status = 'EXPIRED' then
    if new.deadline > v_now and v_shift.start_at > v_now then
      raise exception 'RULE: the request is not overdue by server time (BR-12)';
    end if;
  elsif not ((old.status = 'REQUESTED' and new.status = 'FAILED')
          or (old.status in ('REQUESTED', 'ACCEPTED') and new.status = 'CANCELLED')
          or (old.status = 'ACCEPTED' and new.status = 'REJECTED')) then
    raise exception 'RULE: % -> % is not a request transition of spec §7', old.status, new.status;
  end if;
  return new;
end;
$$;

create or replace function public.app_check_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'RULE: a request target is never deleted'; end if;
  if tg_op = 'INSERT' then
    if new.response <> 'PENDING' then raise exception 'RULE: a new request target is PENDING'; end if;
    return new;
  end if;
  if new.sub_request_id <> old.sub_request_id or new.worker_id <> old.worker_id then
    raise exception 'RULE: request and worker of a target do not change';
  end if;
  if old.response <> 'PENDING' and new is distinct from old then
    raise exception 'RULE: an answered or closed target does not change (% -> %)', old.response, new.response;
  end if;
  return new;
end;
$$;

create or replace function public.app_check_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'SCHEDULED' then raise exception 'RULE: a new shift is SCHEDULED'; end if;
    return new;
  end if;
  if new.status <> old.status and old.status <> 'SCHEDULED' then
    raise exception 'RULE: % -> % is not a shift transition of spec §7', old.status, new.status;
  end if;
  if old.original_worker_id is not null and new.original_worker_id is distinct from old.original_worker_id then
    raise exception 'RULE: the original worker of a shift is kept (BR-04)';
  end if;
  return new;
end;
$$;

create or replace function public.app_check_attendance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.confirmed = 1 and new is distinct from old then
    raise exception 'RULE: a confirmed attendance record does not change';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.app_check_payroll()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'CONFIRMED' then
    raise exception 'RULE: confirmed payroll is read-only';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.status = 'CONFIRMED' and new.min_wage_warning = 1 and new.min_wage_ack = 0 then
    raise exception 'RULE: acknowledge the minimum-wage warning before confirming (BR-09)';
  end if;
  return new;
end;
$$;

create or replace function public.app_check_notification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'RULE: a notification is never deleted'; end if;
  if tg_op = 'INSERT' then
    if abs(extract(epoch from new.created_at::timestamp - public.app_srv_now()::timestamp)) > 600 then
      raise exception 'RULE: the creation time is more than 10 minutes from the server time';
    end if;
    return new;
  end if;
  if (new.worker_id, new.sub_request_id, new.kind, new.message, new.created_at)
     is distinct from (old.worker_id, old.sub_request_id, old.kind, old.message, old.created_at)
     or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'RULE: only the read time of an unread notification changes';
  end if;
  return new;
end;
$$;

create or replace function public.app_check_workplace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.seeding', true) = 'on' then return coalesce(new, old); end if;
  raise exception 'RULE: the workplace of a store is only updated';
end;
$$;

drop trigger if exists app_sub_request_check on public.app_sub_request;
create trigger app_sub_request_check before insert or update or delete on public.app_sub_request
  for each row execute function public.app_check_sub_request();
drop trigger if exists app_sub_request_target_check on public.app_sub_request_target;
create trigger app_sub_request_target_check before insert or update or delete on public.app_sub_request_target
  for each row execute function public.app_check_target();
drop trigger if exists app_shift_check on public.app_shift;
create trigger app_shift_check before insert or update or delete on public.app_shift
  for each row execute function public.app_check_shift();
drop trigger if exists app_attendance_check on public.app_attendance;
create trigger app_attendance_check before update on public.app_attendance
  for each row execute function public.app_check_attendance();
drop trigger if exists app_payroll_check on public.app_payroll;
create trigger app_payroll_check before insert or update or delete on public.app_payroll
  for each row execute function public.app_check_payroll();
drop trigger if exists app_notification_check on public.app_notification;
create trigger app_notification_check before insert or update or delete on public.app_notification
  for each row execute function public.app_check_notification();
drop trigger if exists app_workplace_check on public.app_workplace;
create trigger app_workplace_check before insert or delete on public.app_workplace
  for each row execute function public.app_check_workplace();

-- ---- Read: the whole store in one statement (one consistent snapshot) --------------------------------------------

create or replace function public.app_snapshot(p_store text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'rev', s.rev,
    'now', floor(extract(epoch from now()) * 1000)::bigint,
    'tables', jsonb_build_object(
      'Workplace', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_workplace t where t.store_id = s.id),
      'Worker', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_worker t where t.store_id = s.id),
      'FixedSchedule', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_fixed_schedule t where t.store_id = s.id),
      'Shift', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_shift t where t.store_id = s.id),
      'SubRequest', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_sub_request t where t.store_id = s.id),
      'SubRequestTarget', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_sub_request_target t where t.store_id = s.id),
      'Attendance', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_attendance t where t.store_id = s.id),
      'WeeklySummary', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_weekly_summary t where t.store_id = s.id),
      'Payroll', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_payroll t where t.store_id = s.id),
      'MinimumWage', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.year), '[]'::jsonb) from public.app_minimum_wage t where t.store_id = s.id),
      'Notification', (select coalesce(jsonb_agg(to_jsonb(t) - 'store_id' order by t.id), '[]'::jsonb) from public.app_notification t where t.store_id = s.id)))
  from public.app_store s
  where s.slug = p_store
$$;

-- ---- Write: one change set = the rows one command changed ---------------------------------------------------------
-- p_changes = [{"t": "SubRequest", "op": "insert" | "update" | "delete", "row": {<all columns in snake_case>}}, …]

create or replace function public.app_commit(p_store text, p_base_rev bigint, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.app_store%rowtype;
  v_gate public.app_store_gate%rowtype;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_change jsonb;
  v_op text;
  v_table text;
  v_key text;
  v_row jsonb;
  v_cols text;
  v_count integer;
  v_rows bigint;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'BAD_CHANGES: expected a non-empty array of changes';
  end if;
  if octet_length(p_changes::text) > 262144 or jsonb_array_length(p_changes) > 2000 then
    raise exception 'TOO_LARGE: a change set is limited to 256 kB and 2000 rows';
  end if;

  select * into v_store from public.app_store s where s.slug = p_store for update;
  if not found then raise exception 'UNKNOWN_STORE'; end if;
  if p_base_rev is distinct from v_store.rev then raise exception 'STALE: the store is at revision %', v_store.rev; end if;

  insert into public.app_store_gate (store_id) values (v_store.id) on conflict (store_id) do nothing;
  select * into v_gate from public.app_store_gate g where g.store_id = v_store.id;
  if v_gate.minute_start <= now() - interval '1 minute' then
    v_gate.minute_start := now();
    v_gate.minute_count := 0;
  end if;
  if v_gate.day <> v_today then
    v_gate.day := v_today;
    v_gate.day_count := 0;
  end if;
  if v_gate.minute_count >= 60 then raise exception 'RATE_LIMIT: at most 60 changes a minute per store'; end if;
  if v_gate.day_count >= 3000 then raise exception 'DAILY_LIMIT: at most 3000 changes a day per store'; end if;
  update public.app_store_gate g
    set minute_start = v_gate.minute_start, minute_count = v_gate.minute_count + 1, day = v_gate.day, day_count = v_gate.day_count + 1
    where g.store_id = v_store.id;

  -- Deletes first, then updates, then inserts (keys freed by a delete can be reused in the same change set).
  for v_change in
    select c.value from jsonb_array_elements(p_changes) with ordinality as c(value, n)
    order by case c.value ->> 'op' when 'delete' then 0 when 'update' then 1 else 2 end, c.n
  loop
    v_op := v_change ->> 'op';
    v_table := case v_change ->> 't'
      when 'Workplace' then 'app_workplace' when 'Worker' then 'app_worker' when 'FixedSchedule' then 'app_fixed_schedule'
      when 'Shift' then 'app_shift' when 'SubRequest' then 'app_sub_request' when 'SubRequestTarget' then 'app_sub_request_target'
      when 'Attendance' then 'app_attendance' when 'WeeklySummary' then 'app_weekly_summary' when 'Payroll' then 'app_payroll'
      when 'MinimumWage' then 'app_minimum_wage' when 'Notification' then 'app_notification' end;
    v_key := case when v_table = 'app_minimum_wage' then 'year' else 'id' end;
    if v_table is null or v_op is null or v_op not in ('insert', 'update', 'delete')
       or jsonb_typeof(v_change -> 'row') is distinct from 'object' or jsonb_typeof(v_change -> 'row' -> v_key) is distinct from 'number' then
      raise exception 'BAD_CHANGES: %', left(v_change::text, 200);
    end if;
    v_row := (v_change -> 'row') || jsonb_build_object('store_id', v_store.id);
    if v_op = 'delete' then
      if v_table not in ('app_fixed_schedule', 'app_shift', 'app_weekly_summary', 'app_payroll', 'app_minimum_wage') then
        raise exception 'FORBIDDEN_DELETE: % rows are never deleted', v_change ->> 't';
      end if;
      execute format('delete from public.%I t where t.store_id = $1 and t.%I = ($2 ->> %L)::bigint', v_table, v_key, v_key)
        using v_store.id, v_row;
    elsif v_op = 'update' then
      select string_agg(format('%I = r.%I', a.attname, a.attname), ', ' order by a.attnum) into v_cols
        from pg_catalog.pg_attribute a
        where a.attrelid = format('public.%I', v_table)::regclass and a.attnum > 0 and not a.attisdropped
          and a.attname not in ('store_id', v_key);
      execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.store_id = $2 and t.%3$I = r.%3$I',
        v_table, v_cols, v_key) using v_row, v_store.id;
    else
      execute format('insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1)', v_table) using v_row;
    end if;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'CONFLICT: % % %: row not found', v_op, v_change ->> 't', v_row ->> v_key; end if;
  end loop;

  if exists (select 1 from jsonb_array_elements(p_changes) c where c ->> 'op' = 'insert') then
    select (select count(*) from public.app_worker t where t.store_id = v_store.id)
         + (select count(*) from public.app_fixed_schedule t where t.store_id = v_store.id)
         + (select count(*) from public.app_shift t where t.store_id = v_store.id)
         + (select count(*) from public.app_sub_request t where t.store_id = v_store.id)
         + (select count(*) from public.app_sub_request_target t where t.store_id = v_store.id)
         + (select count(*) from public.app_attendance t where t.store_id = v_store.id)
         + (select count(*) from public.app_weekly_summary t where t.store_id = v_store.id)
         + (select count(*) from public.app_payroll t where t.store_id = v_store.id)
         + (select count(*) from public.app_minimum_wage t where t.store_id = v_store.id)
         + (select count(*) from public.app_notification t where t.store_id = v_store.id) into v_rows;
    if v_rows > 20000 then raise exception 'STORE_FULL: a store holds at most 20000 rows; reset it'; end if;
  end if;
  -- Check the deferred keys now, inside the function, instead of at the end of the request.
  set constraints all immediate;

  update public.app_store s set rev = s.rev + 1, updated_at = now() where s.id = v_store.id;
  return jsonb_build_object('rev', v_store.rev + 1, 'now', floor(extract(epoch from now()) * 1000)::bigint);
end;
$$;

-- ---- Reset: the seed of spec §10 moved by whole weeks to the current date (spec §10 "Shared-mode seed") ------------

create or replace function public.app_reset_store(p_store_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Seoul';
  v_now_text text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI');
  v_tpl jsonb := public.app_seed_template();
  v_days integer;
  v_rev bigint;
begin
  -- k = the smallest k >= 0 with 2026-09-29 21:00 + 7k days later than server time + 6 hours: the seed request stays open.
  v_days := 7 * greatest(0, floor(extract(epoch from v_now + interval '6 hours' - timestamp '2026-09-29 21:00') / 604800)::integer + 1);
  perform set_config('app.seeding', 'on', true);

  delete from public.app_notification t where t.store_id = p_store_id;
  delete from public.app_payroll t where t.store_id = p_store_id;
  delete from public.app_weekly_summary t where t.store_id = p_store_id;
  delete from public.app_attendance t where t.store_id = p_store_id;
  delete from public.app_sub_request_target t where t.store_id = p_store_id;
  delete from public.app_sub_request t where t.store_id = p_store_id;
  delete from public.app_shift t where t.store_id = p_store_id;
  delete from public.app_fixed_schedule t where t.store_id = p_store_id;
  delete from public.app_minimum_wage t where t.store_id = p_store_id;
  delete from public.app_worker t where t.store_id = p_store_id;
  delete from public.app_workplace t where t.store_id = p_store_id;

  insert into public.app_workplace select r.* from jsonb_array_elements(v_tpl -> 'Workplace') e,
    jsonb_populate_record(null::public.app_workplace, e || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_minimum_wage select r.* from jsonb_array_elements(v_tpl -> 'MinimumWage') e,
    jsonb_populate_record(null::public.app_minimum_wage, e || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_worker select r.* from jsonb_array_elements(v_tpl -> 'Worker') e,
    jsonb_populate_record(null::public.app_worker, public.app_move_row(e, array['contract_start', 'contract_end', 'probation_end'], v_days)
      || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_fixed_schedule select r.* from jsonb_array_elements(v_tpl -> 'FixedSchedule') e,
    jsonb_populate_record(null::public.app_fixed_schedule, e || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_shift select r.* from jsonb_array_elements(v_tpl -> 'Shift') e,
    jsonb_populate_record(null::public.app_shift, public.app_move_row(e, array['work_date'], v_days)
      || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_sub_request select r.* from jsonb_array_elements(v_tpl -> 'SubRequest') e,
    jsonb_populate_record(null::public.app_sub_request, public.app_move_row(e, array['deadline', 'created_at', 'decided_at'], v_days)
      || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_sub_request_target select r.* from jsonb_array_elements(v_tpl -> 'SubRequestTarget') e,
    jsonb_populate_record(null::public.app_sub_request_target, public.app_move_row(e, array['responded_at'], v_days)
      || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_attendance select r.* from jsonb_array_elements(v_tpl -> 'Attendance') e,
    jsonb_populate_record(null::public.app_attendance, e || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_weekly_summary select r.* from jsonb_array_elements(v_tpl -> 'WeeklySummary') e,
    jsonb_populate_record(null::public.app_weekly_summary, public.app_move_row(e, array['week_start'], v_days)
      || jsonb_build_object('store_id', p_store_id)) r;
  insert into public.app_notification select r.* from jsonb_array_elements(v_tpl -> 'Notification') e,
    jsonb_populate_record(null::public.app_notification, public.app_move_row(e, array['created_at', 'read_at'], v_days)
      || jsonb_build_object('store_id', p_store_id, 'message', public.app_shift_dates(e ->> 'message', v_days))) r;

  -- Shifts that have not ended by server time are still to be worked; no creation time lies in the future.
  delete from public.app_attendance a using public.app_shift s
    where a.store_id = p_store_id and s.store_id = p_store_id and s.id = a.shift_id
      and s.work_date + s.end_time::time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end > v_now;
  update public.app_shift s set status = 'SCHEDULED'
    where s.store_id = p_store_id and s.status <> 'SCHEDULED'
      and s.work_date + s.end_time::time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end > v_now;
  update public.app_sub_request t set created_at = v_now_text where t.store_id = p_store_id and t.created_at > v_now_text;
  update public.app_notification t set created_at = v_now_text where t.store_id = p_store_id and t.created_at > v_now_text;

  perform set_config('app.seeding', 'off', true);
  update public.app_store s set rev = s.rev + 1, reset_at = now(), updated_at = now() where s.id = p_store_id returning s.rev into v_rev;
  return jsonb_build_object('rev', v_rev, 'now', floor(extract(epoch from now()) * 1000)::bigint, 'moved_days', v_days);
end;
$$;

create or replace function public.app_reset(p_store text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.app_store%rowtype;
  v_gate public.app_store_gate%rowtype;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into v_store from public.app_store s where s.slug = p_store for update;
  if not found then raise exception 'UNKNOWN_STORE'; end if;
  insert into public.app_store_gate (store_id) values (v_store.id) on conflict (store_id) do nothing;
  select * into v_gate from public.app_store_gate g where g.store_id = v_store.id;
  if v_gate.reset_last > now() - interval '1 minute' then raise exception 'RESET_RATE_LIMIT: at most one reset a minute'; end if;
  if v_gate.reset_day = v_today and v_gate.reset_day_count >= 50 then raise exception 'RESET_DAILY_LIMIT: at most 50 resets a day'; end if;
  update public.app_store_gate g
    set reset_last = now(), reset_day = v_today, reset_day_count = case when g.reset_day = v_today then g.reset_day_count + 1 else 1 end
    where g.store_id = v_store.id;
  return public.app_reset_store(v_store.id);
end;
$$;

-- BEGIN SEED TEMPLATE (generated by tools/seed-sql.mjs from the seed of app/core/db.js without Payroll rows; do not edit)
create or replace function public.app_seed_template()
returns jsonb
language sql
immutable
set search_path = ''
as $tpl$
select $json${
"Workplace": [
{"id":1,"name":"Dalbit Café","regular_employees":4,"sub_attendance_policy":"EXCUSED"}
],
"Worker": [
{"id":1,"workplace_id":1,"role":"OWNER","name":"Park Jiyoung","phone":"010-3827-1150","hourly_wage":null,"contract_start":null,"contract_end":null,"probation_end":null,"simple_labor":0,"active":1},
{"id":2,"workplace_id":1,"role":"WORKER","name":"Lee Seoyeon","phone":"010-4172-2083","hourly_wage":10500,"contract_start":"2026-03-02","contract_end":"2027-02-28","probation_end":null,"simple_labor":0,"active":1},
{"id":3,"workplace_id":1,"role":"WORKER","name":"Choi Minho","phone":"010-5290-3316","hourly_wage":10320,"contract_start":"2026-06-01","contract_end":"2026-12-31","probation_end":null,"simple_labor":0,"active":1},
{"id":4,"workplace_id":1,"role":"WORKER","name":"Jung Hana","phone":"010-6631-4427","hourly_wage":10320,"contract_start":"2026-09-01","contract_end":null,"probation_end":"2026-11-30","simple_labor":0,"active":1},
{"id":5,"workplace_id":1,"role":"WORKER","name":"Kang Doyun","phone":"010-7748-5539","hourly_wage":10000,"contract_start":"2026-08-15","contract_end":"2026-11-15","probation_end":null,"simple_labor":1,"active":1}
],
"FixedSchedule": [
{"id":1,"worker_id":2,"weekday":1,"start_time":"18:00","end_time":"23:00"},
{"id":2,"worker_id":2,"weekday":3,"start_time":"18:00","end_time":"23:00"},
{"id":3,"worker_id":3,"weekday":2,"start_time":"18:00","end_time":"23:00"},
{"id":4,"worker_id":3,"weekday":4,"start_time":"18:00","end_time":"23:00"},
{"id":5,"worker_id":3,"weekday":6,"start_time":"12:00","end_time":"18:00"},
{"id":6,"worker_id":4,"weekday":5,"start_time":"17:00","end_time":"23:00"},
{"id":7,"worker_id":4,"weekday":7,"start_time":"10:00","end_time":"16:00"},
{"id":8,"worker_id":5,"weekday":6,"start_time":"10:00","end_time":"16:00"},
{"id":9,"worker_id":5,"weekday":7,"start_time":"16:00","end_time":"22:00"}
],
"Shift": [
{"id":1,"work_date":"2026-09-21","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":2,"work_date":"2026-09-23","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":3,"work_date":"2026-09-22","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":4,"work_date":"2026-09-24","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":5,"work_date":"2026-09-26","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":6,"work_date":"2026-09-25","start_time":"17:00","end_time":"23:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":6,"status":"WORKED"},
{"id":7,"work_date":"2026-09-27","start_time":"10:00","end_time":"16:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":7,"status":"WORKED"},
{"id":8,"work_date":"2026-09-26","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":9,"work_date":"2026-09-27","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"},
{"id":10,"work_date":"2026-09-28","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"SCHEDULED"},
{"id":11,"work_date":"2026-09-30","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"SCHEDULED"},
{"id":12,"work_date":"2026-09-29","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"SCHEDULED"},
{"id":13,"work_date":"2026-10-01","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"SCHEDULED"},
{"id":14,"work_date":"2026-10-03","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"SCHEDULED"},
{"id":15,"work_date":"2026-10-02","start_time":"17:00","end_time":"23:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":6,"status":"SCHEDULED"},
{"id":16,"work_date":"2026-10-04","start_time":"10:00","end_time":"16:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":7,"status":"SCHEDULED"},
{"id":17,"work_date":"2026-10-03","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"SCHEDULED"},
{"id":18,"work_date":"2026-10-04","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"SCHEDULED"},
{"id":19,"work_date":"2026-03-02","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":20,"work_date":"2026-03-04","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":21,"work_date":"2026-03-09","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":22,"work_date":"2026-03-11","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":23,"work_date":"2026-03-16","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":24,"work_date":"2026-03-18","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":25,"work_date":"2026-03-23","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":26,"work_date":"2026-03-25","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":27,"work_date":"2026-03-30","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":28,"work_date":"2026-04-01","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":29,"work_date":"2026-04-06","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":30,"work_date":"2026-04-08","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":31,"work_date":"2026-04-13","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":32,"work_date":"2026-04-15","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":33,"work_date":"2026-04-20","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":34,"work_date":"2026-04-22","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":35,"work_date":"2026-04-27","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":36,"work_date":"2026-04-29","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":37,"work_date":"2026-05-04","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":38,"work_date":"2026-05-06","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":39,"work_date":"2026-05-11","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":40,"work_date":"2026-05-13","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":41,"work_date":"2026-05-18","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":42,"work_date":"2026-05-20","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":43,"work_date":"2026-05-25","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":44,"work_date":"2026-05-27","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":45,"work_date":"2026-06-01","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":46,"work_date":"2026-06-02","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":47,"work_date":"2026-06-03","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":48,"work_date":"2026-06-04","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":49,"work_date":"2026-06-06","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":50,"work_date":"2026-06-08","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":51,"work_date":"2026-06-09","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":52,"work_date":"2026-06-10","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":53,"work_date":"2026-06-11","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":54,"work_date":"2026-06-13","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":55,"work_date":"2026-06-15","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":56,"work_date":"2026-06-16","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":57,"work_date":"2026-06-17","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":58,"work_date":"2026-06-18","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":59,"work_date":"2026-06-20","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":60,"work_date":"2026-06-22","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":61,"work_date":"2026-06-23","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":62,"work_date":"2026-06-24","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":63,"work_date":"2026-06-25","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":64,"work_date":"2026-06-27","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":65,"work_date":"2026-06-29","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":66,"work_date":"2026-06-30","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":67,"work_date":"2026-07-01","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":68,"work_date":"2026-07-02","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":69,"work_date":"2026-07-04","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":70,"work_date":"2026-07-06","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":71,"work_date":"2026-07-07","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":72,"work_date":"2026-07-08","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":73,"work_date":"2026-07-09","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":74,"work_date":"2026-07-11","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":75,"work_date":"2026-07-13","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":76,"work_date":"2026-07-14","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":77,"work_date":"2026-07-15","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":78,"work_date":"2026-07-16","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":79,"work_date":"2026-07-18","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":80,"work_date":"2026-07-20","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":81,"work_date":"2026-07-21","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":82,"work_date":"2026-07-22","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":83,"work_date":"2026-07-23","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":84,"work_date":"2026-07-25","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":85,"work_date":"2026-07-27","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":86,"work_date":"2026-07-28","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":87,"work_date":"2026-07-29","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":88,"work_date":"2026-07-30","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":89,"work_date":"2026-08-01","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":90,"work_date":"2026-08-03","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":91,"work_date":"2026-08-04","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":92,"work_date":"2026-08-05","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":93,"work_date":"2026-08-06","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":94,"work_date":"2026-08-08","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":95,"work_date":"2026-08-10","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":96,"work_date":"2026-08-11","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":97,"work_date":"2026-08-12","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":98,"work_date":"2026-08-13","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":99,"work_date":"2026-08-15","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":100,"work_date":"2026-08-15","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":101,"work_date":"2026-08-16","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"},
{"id":102,"work_date":"2026-08-17","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":103,"work_date":"2026-08-18","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":104,"work_date":"2026-08-19","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":105,"work_date":"2026-08-20","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":106,"work_date":"2026-08-22","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":107,"work_date":"2026-08-22","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":108,"work_date":"2026-08-23","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"},
{"id":109,"work_date":"2026-08-24","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":110,"work_date":"2026-08-25","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":111,"work_date":"2026-08-26","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":112,"work_date":"2026-08-27","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":113,"work_date":"2026-08-29","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":114,"work_date":"2026-08-29","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":115,"work_date":"2026-08-30","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"},
{"id":116,"work_date":"2026-08-31","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":117,"work_date":"2026-09-01","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":118,"work_date":"2026-09-02","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":119,"work_date":"2026-09-03","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":120,"work_date":"2026-09-04","start_time":"17:00","end_time":"23:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":6,"status":"WORKED"},
{"id":121,"work_date":"2026-09-05","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":122,"work_date":"2026-09-05","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":123,"work_date":"2026-09-06","start_time":"10:00","end_time":"16:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":7,"status":"WORKED"},
{"id":124,"work_date":"2026-09-06","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"},
{"id":125,"work_date":"2026-09-07","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":126,"work_date":"2026-09-08","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":127,"work_date":"2026-09-09","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":128,"work_date":"2026-09-10","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":129,"work_date":"2026-09-11","start_time":"17:00","end_time":"23:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":6,"status":"WORKED"},
{"id":130,"work_date":"2026-09-12","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":131,"work_date":"2026-09-12","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":132,"work_date":"2026-09-13","start_time":"10:00","end_time":"16:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":7,"status":"WORKED"},
{"id":133,"work_date":"2026-09-13","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"},
{"id":134,"work_date":"2026-09-14","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":1,"status":"WORKED"},
{"id":135,"work_date":"2026-09-15","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":3,"status":"WORKED"},
{"id":136,"work_date":"2026-09-16","start_time":"18:00","end_time":"23:00","worker_id":2,"original_worker_id":null,"fixed_schedule_id":2,"status":"WORKED"},
{"id":137,"work_date":"2026-09-17","start_time":"18:00","end_time":"23:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":4,"status":"WORKED"},
{"id":138,"work_date":"2026-09-18","start_time":"17:00","end_time":"23:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":6,"status":"WORKED"},
{"id":139,"work_date":"2026-09-19","start_time":"10:00","end_time":"16:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":8,"status":"WORKED"},
{"id":140,"work_date":"2026-09-19","start_time":"12:00","end_time":"18:00","worker_id":3,"original_worker_id":null,"fixed_schedule_id":5,"status":"WORKED"},
{"id":141,"work_date":"2026-09-20","start_time":"10:00","end_time":"16:00","worker_id":4,"original_worker_id":null,"fixed_schedule_id":7,"status":"WORKED"},
{"id":142,"work_date":"2026-09-20","start_time":"16:00","end_time":"22:00","worker_id":5,"original_worker_id":null,"fixed_schedule_id":9,"status":"WORKED"}
],
"SubRequest": [
{"id":1,"shift_id":11,"requester_id":2,"acceptor_id":null,"reason":"Midterm exam","deadline":"2026-09-29T21:00","status":"REQUESTED","created_at":"2026-09-28T08:30","decided_at":null}
],
"SubRequestTarget": [
{"id":1,"sub_request_id":1,"worker_id":3,"response":"PENDING","responded_at":null},
{"id":2,"sub_request_id":1,"worker_id":4,"response":"PENDING","responded_at":null},
{"id":3,"sub_request_id":1,"worker_id":5,"response":"PENDING","responded_at":null}
],
"Attendance": [
{"id":1,"shift_id":1,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":2,"shift_id":2,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":3,"shift_id":3,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":4,"shift_id":4,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":5,"shift_id":5,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":6,"shift_id":6,"clock_in":"17:00","clock_out":"23:00","confirmed":1},
{"id":7,"shift_id":7,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":8,"shift_id":8,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":9,"shift_id":9,"clock_in":"16:00","clock_out":"22:00","confirmed":1},
{"id":10,"shift_id":19,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":11,"shift_id":20,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":12,"shift_id":21,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":13,"shift_id":22,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":14,"shift_id":23,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":15,"shift_id":24,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":16,"shift_id":25,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":17,"shift_id":26,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":18,"shift_id":27,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":19,"shift_id":28,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":20,"shift_id":29,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":21,"shift_id":30,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":22,"shift_id":31,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":23,"shift_id":32,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":24,"shift_id":33,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":25,"shift_id":34,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":26,"shift_id":35,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":27,"shift_id":36,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":28,"shift_id":37,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":29,"shift_id":38,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":30,"shift_id":39,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":31,"shift_id":40,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":32,"shift_id":41,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":33,"shift_id":42,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":34,"shift_id":43,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":35,"shift_id":44,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":36,"shift_id":45,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":37,"shift_id":46,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":38,"shift_id":47,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":39,"shift_id":48,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":40,"shift_id":49,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":41,"shift_id":50,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":42,"shift_id":51,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":43,"shift_id":52,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":44,"shift_id":53,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":45,"shift_id":54,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":46,"shift_id":55,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":47,"shift_id":56,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":48,"shift_id":57,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":49,"shift_id":58,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":50,"shift_id":59,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":51,"shift_id":60,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":52,"shift_id":61,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":53,"shift_id":62,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":54,"shift_id":63,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":55,"shift_id":64,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":56,"shift_id":65,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":57,"shift_id":66,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":58,"shift_id":67,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":59,"shift_id":68,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":60,"shift_id":69,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":61,"shift_id":70,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":62,"shift_id":71,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":63,"shift_id":72,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":64,"shift_id":73,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":65,"shift_id":74,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":66,"shift_id":75,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":67,"shift_id":76,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":68,"shift_id":77,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":69,"shift_id":78,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":70,"shift_id":79,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":71,"shift_id":80,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":72,"shift_id":81,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":73,"shift_id":82,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":74,"shift_id":83,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":75,"shift_id":84,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":76,"shift_id":85,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":77,"shift_id":86,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":78,"shift_id":87,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":79,"shift_id":88,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":80,"shift_id":89,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":81,"shift_id":90,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":82,"shift_id":91,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":83,"shift_id":92,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":84,"shift_id":93,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":85,"shift_id":94,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":86,"shift_id":95,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":87,"shift_id":96,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":88,"shift_id":97,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":89,"shift_id":98,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":90,"shift_id":99,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":91,"shift_id":100,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":92,"shift_id":101,"clock_in":"16:00","clock_out":"22:00","confirmed":1},
{"id":93,"shift_id":102,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":94,"shift_id":103,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":95,"shift_id":104,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":96,"shift_id":105,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":97,"shift_id":106,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":98,"shift_id":107,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":99,"shift_id":108,"clock_in":"16:00","clock_out":"22:00","confirmed":1},
{"id":100,"shift_id":109,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":101,"shift_id":110,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":102,"shift_id":111,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":103,"shift_id":112,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":104,"shift_id":113,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":105,"shift_id":114,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":106,"shift_id":115,"clock_in":"16:00","clock_out":"22:00","confirmed":1},
{"id":107,"shift_id":116,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":108,"shift_id":117,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":109,"shift_id":118,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":110,"shift_id":119,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":111,"shift_id":120,"clock_in":"17:00","clock_out":"23:00","confirmed":1},
{"id":112,"shift_id":121,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":113,"shift_id":122,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":114,"shift_id":123,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":115,"shift_id":124,"clock_in":"16:00","clock_out":"22:00","confirmed":1},
{"id":116,"shift_id":125,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":117,"shift_id":126,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":118,"shift_id":127,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":119,"shift_id":128,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":120,"shift_id":129,"clock_in":"17:00","clock_out":"23:00","confirmed":1},
{"id":121,"shift_id":130,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":122,"shift_id":131,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":123,"shift_id":132,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":124,"shift_id":133,"clock_in":"16:00","clock_out":"22:00","confirmed":1},
{"id":125,"shift_id":134,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":126,"shift_id":135,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":127,"shift_id":136,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":128,"shift_id":137,"clock_in":"18:00","clock_out":"23:00","confirmed":1},
{"id":129,"shift_id":138,"clock_in":"17:00","clock_out":"23:00","confirmed":1},
{"id":130,"shift_id":139,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":131,"shift_id":140,"clock_in":"12:00","clock_out":"18:00","confirmed":1},
{"id":132,"shift_id":141,"clock_in":"10:00","clock_out":"16:00","confirmed":1},
{"id":133,"shift_id":142,"clock_in":"16:00","clock_out":"22:00","confirmed":1}
],
"WeeklySummary": [
{"id":1,"worker_id":2,"week_start":"2026-03-02","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":2,"worker_id":2,"week_start":"2026-03-09","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":3,"worker_id":2,"week_start":"2026-03-16","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":4,"worker_id":2,"week_start":"2026-03-23","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":5,"worker_id":2,"week_start":"2026-03-30","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":6,"worker_id":2,"week_start":"2026-04-06","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":7,"worker_id":2,"week_start":"2026-04-13","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":8,"worker_id":2,"week_start":"2026-04-20","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":9,"worker_id":2,"week_start":"2026-04-27","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":10,"worker_id":2,"week_start":"2026-05-04","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":11,"worker_id":2,"week_start":"2026-05-11","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":12,"worker_id":2,"week_start":"2026-05-18","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":13,"worker_id":2,"week_start":"2026-05-25","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":14,"worker_id":2,"week_start":"2026-06-01","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":15,"worker_id":3,"week_start":"2026-06-01","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":16,"worker_id":2,"week_start":"2026-06-08","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":17,"worker_id":3,"week_start":"2026-06-08","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":18,"worker_id":2,"week_start":"2026-06-15","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":19,"worker_id":3,"week_start":"2026-06-15","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":20,"worker_id":2,"week_start":"2026-06-22","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":21,"worker_id":3,"week_start":"2026-06-22","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":22,"worker_id":2,"week_start":"2026-06-29","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":23,"worker_id":3,"week_start":"2026-06-29","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":24,"worker_id":2,"week_start":"2026-07-06","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":25,"worker_id":3,"week_start":"2026-07-06","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":26,"worker_id":2,"week_start":"2026-07-13","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":27,"worker_id":3,"week_start":"2026-07-13","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":28,"worker_id":2,"week_start":"2026-07-20","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":29,"worker_id":3,"week_start":"2026-07-20","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":30,"worker_id":2,"week_start":"2026-07-27","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":31,"worker_id":3,"week_start":"2026-07-27","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":32,"worker_id":2,"week_start":"2026-08-03","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":33,"worker_id":3,"week_start":"2026-08-03","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":34,"worker_id":2,"week_start":"2026-08-10","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":35,"worker_id":3,"week_start":"2026-08-10","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":36,"worker_id":5,"week_start":"2026-08-10","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":37,"worker_id":2,"week_start":"2026-08-17","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":38,"worker_id":3,"week_start":"2026-08-17","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":39,"worker_id":5,"week_start":"2026-08-17","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":40,"worker_id":2,"week_start":"2026-08-24","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":41,"worker_id":3,"week_start":"2026-08-24","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":42,"worker_id":5,"week_start":"2026-08-24","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":43,"worker_id":2,"week_start":"2026-08-31","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":44,"worker_id":3,"week_start":"2026-08-31","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":45,"worker_id":4,"week_start":"2026-08-31","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":46,"worker_id":5,"week_start":"2026-08-31","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":47,"worker_id":2,"week_start":"2026-09-07","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":48,"worker_id":3,"week_start":"2026-09-07","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":49,"worker_id":4,"week_start":"2026-09-07","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":50,"worker_id":5,"week_start":"2026-09-07","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":51,"worker_id":2,"week_start":"2026-09-14","contract_hours":10,"scheduled_hours":10,"actual_hours":10,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":52,"worker_id":3,"week_start":"2026-09-14","contract_hours":16,"scheduled_hours":16,"actual_hours":16,"perfect_attendance":1,"holiday_eligible":1,"holiday_hours":3.2},
{"id":53,"worker_id":4,"week_start":"2026-09-14","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0},
{"id":54,"worker_id":5,"week_start":"2026-09-14","contract_hours":12,"scheduled_hours":12,"actual_hours":12,"perfect_attendance":1,"holiday_eligible":0,"holiday_hours":0}
],
"MinimumWage": [
{"year":2025,"hourly":10030},
{"year":2026,"hourly":10320}
],
"Notification": [
{"id":1,"worker_id":3,"sub_request_id":1,"kind":"REQUEST_RECEIVED","message":"Lee Seoyeon asks for a substitute on Wed 2026-09-30 18:00–23:00. Reply by 2026-09-29 21:00.","created_at":"2026-09-28T08:30","read_at":null},
{"id":2,"worker_id":4,"sub_request_id":1,"kind":"REQUEST_RECEIVED","message":"Lee Seoyeon asks for a substitute on Wed 2026-09-30 18:00–23:00. Reply by 2026-09-29 21:00.","created_at":"2026-09-28T08:30","read_at":null},
{"id":3,"worker_id":5,"sub_request_id":1,"kind":"REQUEST_RECEIVED","message":"Lee Seoyeon asks for a substitute on Wed 2026-09-30 18:00–23:00. Reply by 2026-09-29 21:00.","created_at":"2026-09-28T08:30","read_at":null}
]
}$json$::jsonb
$tpl$;
-- END SEED TEMPLATE

-- ---- Access: read-only tables for the API roles, three callable functions -----------------------------------------

alter table public.app_store enable row level security;
alter table public.app_store_gate enable row level security;
alter table public.app_workplace enable row level security;
alter table public.app_worker enable row level security;
alter table public.app_fixed_schedule enable row level security;
alter table public.app_shift enable row level security;
alter table public.app_sub_request enable row level security;
alter table public.app_sub_request_target enable row level security;
alter table public.app_attendance enable row level security;
alter table public.app_weekly_summary enable row level security;
alter table public.app_payroll enable row level security;
alter table public.app_minimum_wage enable row level security;
alter table public.app_notification enable row level security;

drop policy if exists "read stores" on public.app_store;
create policy "read stores" on public.app_store for select to anon, authenticated using (true);
drop policy if exists "read workplaces" on public.app_workplace;
create policy "read workplaces" on public.app_workplace for select to anon, authenticated using (true);
drop policy if exists "read workers" on public.app_worker;
create policy "read workers" on public.app_worker for select to anon, authenticated using (true);
drop policy if exists "read fixed schedules" on public.app_fixed_schedule;
create policy "read fixed schedules" on public.app_fixed_schedule for select to anon, authenticated using (true);
drop policy if exists "read shifts" on public.app_shift;
create policy "read shifts" on public.app_shift for select to anon, authenticated using (true);
drop policy if exists "read requests" on public.app_sub_request;
create policy "read requests" on public.app_sub_request for select to anon, authenticated using (true);
drop policy if exists "read request targets" on public.app_sub_request_target;
create policy "read request targets" on public.app_sub_request_target for select to anon, authenticated using (true);
drop policy if exists "read attendance" on public.app_attendance;
create policy "read attendance" on public.app_attendance for select to anon, authenticated using (true);
drop policy if exists "read weekly summaries" on public.app_weekly_summary;
create policy "read weekly summaries" on public.app_weekly_summary for select to anon, authenticated using (true);
drop policy if exists "read payroll" on public.app_payroll;
create policy "read payroll" on public.app_payroll for select to anon, authenticated using (true);
drop policy if exists "read minimum wages" on public.app_minimum_wage;
create policy "read minimum wages" on public.app_minimum_wage for select to anon, authenticated using (true);
drop policy if exists "read notifications" on public.app_notification;
create policy "read notifications" on public.app_notification for select to anon, authenticated using (true);

-- The project's default privileges grant everything on new tables and functions to the API roles: take it back.
revoke all on public.app_store, public.app_store_gate, public.app_workplace, public.app_worker, public.app_fixed_schedule,
  public.app_shift, public.app_sub_request, public.app_sub_request_target, public.app_attendance, public.app_weekly_summary,
  public.app_payroll, public.app_minimum_wage, public.app_notification from anon, authenticated;
revoke all on sequence public.app_store_id_seq from anon, authenticated;
grant select on public.app_store, public.app_workplace, public.app_worker, public.app_fixed_schedule, public.app_shift,
  public.app_sub_request, public.app_sub_request_target, public.app_attendance, public.app_weekly_summary, public.app_payroll,
  public.app_minimum_wage, public.app_notification to anon, authenticated;

revoke execute on function public.app_srv_now(), public.app_add_days(text, integer), public.app_shift_dates(text, integer),
  public.app_move_row(jsonb, text[], integer), public.app_seed_template(), public.app_reset_store(bigint),
  public.app_check_sub_request(), public.app_check_target(), public.app_check_shift(), public.app_check_attendance(),
  public.app_check_payroll(), public.app_check_notification(), public.app_check_workplace()
  from public, anon, authenticated;
revoke execute on function public.app_snapshot(text), public.app_commit(text, bigint, jsonb), public.app_reset(text) from public;
grant execute on function public.app_snapshot(text), public.app_commit(text, bigint, jsonb), public.app_reset(text) to anon, authenticated;

-- The demo store of the app (spec §9 step 1), filled once when it is created.
insert into public.app_store (slug) values ('dalbit') on conflict (slug) do nothing;
select public.app_reset_store(s.id) from public.app_store s where s.slug = 'dalbit' and s.rev = 0;

notify pgrst, 'reload schema';
