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

-- No policies for anon/public: the table is reachable only through the
-- SECURITY DEFINER functions below, which never return employee_name to
-- anonymous callers. Only an authenticated admin can read/delete rows
-- directly (see policies at the bottom).

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

-- Admin (logged-in via Supabase Auth) can see and remove real bookings.
-- Explicit grants alongside the RLS policies: don't rely on whatever
-- table-level privileges a given project's defaults happen to hand out.
revoke all on public.bookings from anon;
grant select, delete on public.bookings to authenticated;
create policy admin_select on public.bookings for select to authenticated using (true);
create policy admin_delete on public.bookings for delete to authenticated using (true);
