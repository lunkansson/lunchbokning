-- Lunchbokning — Supabase schema.
-- Run in the Supabase SQL editor, or let CI apply it on push (see
-- .github/workflows/apply-schema.yml). Every statement here is written to
-- be safe to run again and again: `create table/extension if not exists`,
-- `create or replace function`, idempotent grants — never a `drop table`.
-- If you add a new column later, pair it with an idempotent
-- `alter table ... add column if not exists ...` here, right after the
-- `create table` block, so re-running never fails and never loses data.

create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  employee_name text not null,
  date date not null,
  time text not null,
  place text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'pending')),
  cancel_token uuid not null default gen_random_uuid(),
  booked_at timestamptz not null default now(),
  constraint uniq_slot unique (date, time)
);

alter table public.bookings enable row level security;

-- No policies for anon/public at all: the table is reachable only through
-- the SECURITY DEFINER functions below. The booking-side ones never return
-- employee_name; the admin-side ones (further down) do, but only after
-- checking a password server-side.

-- One person per slot; seven-week cooldown per employee. cooldown_days
-- mirrors COOLDOWN_WEEKS in js/store.js — change both together.
--
-- Thursday bookings are auto-confirmed; any other date is inserted as
-- 'pending' until an admin approves it. This is decided here, from the
-- date itself, on purpose — never trust a client-supplied status, or
-- anyone could self-approve any day by calling the API directly.
create or replace function public.create_booking(
  p_employee_id text, p_employee_name text, p_date date, p_time text, p_place text
) returns table(id uuid, cancel_token uuid, booked_at timestamptz, status text)
language plpgsql security definer set search_path = public as $$
declare
  cooldown_days constant integer := 49;
  v_last date;
  v_id uuid;
  v_token uuid;
  v_at timestamptz;
  v_status text;
begin
  if p_employee_id is null or p_employee_id = '' then
    raise exception 'invalid_employee';
  end if;

  select max(date) into v_last from public.bookings where employee_id = p_employee_id;
  if v_last is not null and p_date < v_last + cooldown_days then
    raise exception 'cooldown_active';
  end if;

  v_status := case when extract(dow from p_date)::int = 4 then 'confirmed' else 'pending' end;

  begin
    insert into public.bookings (employee_id, employee_name, date, time, place, status)
    values (p_employee_id, p_employee_name, p_date, p_time, p_place, v_status)
    returning bookings.id, bookings.cancel_token, bookings.booked_at into v_id, v_token, v_at;
  exception when unique_violation then
    raise exception 'slot_taken';
  end;

  return query select v_id, v_token, v_at, v_status;
end;
$$;

create or replace function public.cancel_booking(p_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.bookings where id = p_id and cancel_token = p_token;
  return found;
end;
$$;

-- Slot availability only — never exposes who booked it. Includes pending
-- requests too, not just confirmed bookings, so two people can't end up
-- both waiting on approval for the same date.
-- (Columns are aliased away from the bare words "date"/"time": Postgres's
-- parser can't take them as column names directly in a RETURNS TABLE list.)
create or replace function public.taken_slots()
returns table(booking_date date, booking_time text)
language sql security definer set search_path = public as $$
  select date, time from public.bookings;
$$;

-- Cooldown check for one employee — reveals only that one employee's own
-- last lunch date, nothing about anyone else's bookings.
create or replace function public.last_lunch(p_employee_id text)
returns date
language sql security definer set search_path = public as $$
  select max(date) from public.bookings where employee_id = p_employee_id;
$$;

grant execute on function public.create_booking(text, text, date, text, text) to anon;
grant execute on function public.cancel_booking(uuid, uuid) to anon;
grant execute on function public.taken_slots() to anon;
grant execute on function public.last_lunch(text) to anon;

-- No table-level access for anon at all — every read/write above goes
-- through a function, and none of them return employee_name to anon.
revoke all on public.bookings from anon;

-- ─── Admin: a single bcrypt-hashed password, no Supabase Auth account ───
-- Set/change it any time by running, right here in the SQL editor:
--   select set_admin_password('your-password-here');
-- That password is never stored in plain text and this function is not
-- reachable over the API (no grant to anon) — only from the SQL editor.
create table if not exists public.admin_settings (
  id boolean primary key default true check (id),
  password_hash text not null default ''
);
insert into public.admin_settings (id) values (true) on conflict (id) do nothing;

create or replace function public.set_admin_password(p_password text)
returns void language sql set search_path = public as $$
  update public.admin_settings set password_hash = crypt(p_password, gen_salt('bf')) where id = true;
$$;

create or replace function public.check_admin_password(p_password text)
returns boolean language sql security definer set search_path = public as $$
  select password_hash <> '' and password_hash = crypt(p_password, password_hash)
  from public.admin_settings where id = true;
$$;

-- Password-gated reads/writes on the real bookings table. Each call
-- re-checks the password server-side; nothing is trusted from the client
-- beyond "did they type the right password this time".
create or replace function public.admin_list_bookings(p_password text)
returns setof public.bookings
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_admin_password(p_password) then
    raise exception 'invalid_password';
  end if;
  return query select * from public.bookings order by date, time;
end;
$$;

create or replace function public.admin_delete_booking(p_password text, p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_admin_password(p_password) then
    raise exception 'invalid_password';
  end if;
  delete from public.bookings where id = p_id;
  return found;
end;
$$;

-- Turns a pending request into a real, confirmed booking. Denying one is
-- just admin_delete_booking above — a denied request has nothing worth
-- keeping.
create or replace function public.admin_approve_booking(p_password text, p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_admin_password(p_password) then
    raise exception 'invalid_password';
  end if;
  update public.bookings set status = 'confirmed' where id = p_id and status = 'pending';
  return found;
end;
$$;

grant execute on function public.admin_list_bookings(text) to anon;
grant execute on function public.admin_delete_booking(text, uuid) to anon;
grant execute on function public.admin_approve_booking(text, uuid) to anon;
-- check_admin_password and set_admin_password are deliberately NOT granted
-- to anon: the former is only ever called from inside the two functions
-- above, the latter only runs when you execute it yourself in the SQL editor.
