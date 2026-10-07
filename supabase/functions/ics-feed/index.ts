// Supabase Edge Function: serves a subscribable .ics calendar feed of
// confirmed lunch bookings, gated by a shared secret token (?token=...).
// Set/change the token from the SQL editor:
//   select set_ics_feed_token('a-long-random-string-here');
//
// Deployed with --no-verify-jwt (see .github/workflows/deploy-ics-feed.yml)
// since calendar apps fetch this as a plain URL, with no Supabase auth
// header — our own token query param is the only gate.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge Runtime; nothing to configure for those two.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildIcs } from "./ics.ts";

Deno.serve(async (req) => {
  var url = new URL(req.url);
  var token = url.searchParams.get("token") || "";

  var supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  var { data, error } = await supabase.rpc("ics_feed_bookings", { p_token: token });
  if (error) {
    return new Response("Forbidden", { status: 403 });
  }

  var body = buildIcs(data || []);
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=lunchbokning.ics"
    }
  });
});
