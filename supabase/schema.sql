-- Lunchbokning — Supabase schema.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: it drops/recreates the objects it owns.

create extension if not exists pgcrypto;

drop function if exists public.create_booking(text, text, date, text, text);
drop function if exists public.cancel_booking(uuid, uuid);
drop function if exists public.taken_slots();
drop function if exists public.last_lunch(text);
drop table if exists public.bookings;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  employee_name text not null,
  date date not null,
  time text not null,
  place text not null,
  cancel_token uuid not null default gen_random_uuid(),
  booked_at timestamptz not null default now(),
  constraint uniq_slot unique (date, time)
);

alter table public.bookings enable row level security;

-- No policies for anon/public at all: the table is reachable only through
-- the SECURITY DEFINER functions below. The booking-side ones never return
-- employee_name; the admin-side ones (further down) do, but only after
-- checking a password server-side.

-- One person per slot; six-week cooldown per employee. cooldown_days
-- mirrors COOLDOWN_WEEKS in js/store.js — change both together.
create or replace function public.create_booking(
  p_employee_id text, p_employee_name text, p_date date, p_time text, p_place text
) returns table(id uuid, cancel_token uuid, booked_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  cooldown_days constant integer := 42;
  v_last date;
  v_id uuid;
  v_token uuid;
  v_at timestamptz;
begin
  if p_employee_id is null or p_employee_id = '' then
    raise exception 'invalid_employee';
  end if;

  select max(date) into v_last from public.bookings where employee_id = p_employee_id;
  if v_last is not null and p_date < v_last + cooldown_days then
    raise exception 'cooldown_active';
  end if;

  begin
    insert into public.bookings (employee_id, employee_name, date, time, place)
    values (p_employee_id, p_employee_name, p_date, p_time, p_place)
    returning bookings.id, bookings.cancel_token, bookings.booked_at into v_id, v_token, v_at;
  exception when unique_violation then
    raise exception 'slot_taken';
  end;

  return query select v_id, v_token, v_at;
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

-- Slot availability only — never exposes who booked it.
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

grant execute on function public.admin_list_bookings(text) to anon;
grant execute on function public.admin_delete_booking(text, uuid) to anon;
-- check_admin_password and set_admin_password are deliberately NOT granted
-- to anon: the former is only ever called from inside the two functions
-- above, the latter only runs when you execute it yourself in the SQL editor.
