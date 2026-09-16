# Lunchbokning

1:1 lunch booking page for Nexer employees, plus a password-gated admin
view. Static HTML/CSS/JS — no build step. Bookings live in Supabase.

## Setup

1. **Supabase.** Create a free project at supabase.com. In the SQL editor,
   run `supabase/schema.sql`. Then go to Project Settings → API and copy
   the Project URL and `anon` public key into `js/config.js`.
2. **Admin login.** In Supabase → Authentication → Users, add a user with
   email `admin@lunchbokning.internal` (must match `ADMIN_EMAIL` in
   `js/admin.js`) and set its password — that password is what you'll type
   into `admin.html`.
3. **Deploy.** It's a static site — any static host works (e.g. `vercel
   deploy` from this directory).

## Structure

- `index.html` / `js/booking.js` — the booking page.
- `admin.html` / `js/admin.js` — the admin view (all bookings, password-gated).
- `js/store.js` — shared data + the Supabase client calls.
- `js/config.js` — Supabase URL/anon key (fill in, see step 1).
- `css/nocturne.css` — the design system's token sheet, copied as-is.
- `css/page.css` — light-theme token overrides + this page's layout.
- `supabase/schema.sql` — the database schema, RLS policies, and RPC
  functions. Employee names are never readable by the anon key — only by
  an authenticated admin session — enforced in Postgres, not just in the UI.
