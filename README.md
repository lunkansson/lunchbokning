# Lunchbokning

1:1 lunch booking page for Nexer employees, plus a password-gated admin
view. Static HTML/CSS/JS — no build step. Bookings live in Supabase.

## Setup

1. **Supabase.** Create a free project at supabase.com. In the SQL editor,
   run `supabase/schema.sql`. Then go to Project Settings → API and copy
   the Project URL and `anon` public key into `js/config.js`.
2. **Admin password.** Still in the SQL editor, run:
   ```sql
   select set_admin_password('choose-a-password');
   ```
   That's what you type into `admin.html` — no Supabase Auth account, no
   email. Re-run it any time to change the password.
3. **Deploy.** It's a static site — any static host works (e.g. `vercel
   deploy` from this directory).

## Structure

- `index.html` / `js/booking.js` — the booking page.
- `admin.html` / `js/admin.js` — the admin view (all bookings, password-gated).
- `js/store.js` — shared data + the Supabase client calls.
- `js/config.js` — Supabase URL/anon key (fill in, see step 1).
- `css/nocturne.css` — the design system's token sheet, copied as-is.
- `css/page.css` — light-theme token overrides + this page's layout.
- `supabase/schema.sql` — the database schema and RPC functions. Employee
  names are only ever returned by `admin_list_bookings`/`admin_delete_booking`,
  which check the bcrypt-hashed password server-side on every call — there's
  no session, and the anon key alone can never read a name. Enforced in
  Postgres, not just in the UI.
