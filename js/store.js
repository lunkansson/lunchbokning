// Shared data + booking access for the lunch signup pages.
// Real shared storage lives in Supabase (see supabase/schema.sql). The
// anon key used here can only reach a handful of RPC functions that never
// return employee names — that's enforced server-side, not by this file.
(function () {
  "use strict";

  var COOLDOWN_WEEKS = 6; // must match cooldown_days (= weeks * 7) in schema.sql

  var MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
  var WEEKDAYS_FULL = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

  var EMPLOYEES = [
    { id: "alma", name: "Alma Osmanovic" },
    { id: "andreas-g", name: "Andreas Ganslandt" },
    { id: "andreas-h", name: "Andreas Höjvall" },
    { id: "carl-nicholas", name: "Carl-Nicholas Fung" },
    { id: "christian", name: "Christian Öster" },
    { id: "david", name: "David Sjödahl" },
    { id: "emma", name: "Emma Kullbo" },
    { id: "frida", name: "Frida Carlén" },
    { id: "fritz", name: "Fritz Mellqvist" },
    { id: "janki", name: "Janki Patel" },
    { id: "karin", name: "Karin Berglind" },
    { id: "magda", name: "Magda Fogmark" },
    { id: "mathilda", name: "Mathilda Lindén" },
    { id: "robert", name: "Robert Ronelius" },
    { id: "sina", name: "Sina Mohammedzade" },
    { id: "ulrika", name: "Ulrika Jarnberger" }
  ];

  // Fyra lunchdagar i månaden × två sittningar. This is just the schedule of
  // when/where lunches happen — who has booked which slot lives in Supabase.
  var LUNCH_DAYS = [
    { date: "2026-09-09", place: "Bistro Nord", coords: [57.7089, 11.9746], times: ["11:45", "12:45"] },
    { date: "2026-09-17", place: "Kajplats 6", coords: [57.7068, 11.9389], times: ["11:45", "12:45"] },
    { date: "2026-09-23", place: "Soltorget", coords: [57.6969, 11.9865], times: ["11:45", "12:45"] },
    { date: "2026-09-25", place: "Hörnet", coords: [57.6975, 11.9575], times: ["11:45", "12:45"] },
    { date: "2026-10-01", place: "Bistro Nord", coords: [57.7089, 11.9746], times: ["11:45", "12:45"] },
    { date: "2026-10-07", place: "Kajplats 6", coords: [57.7068, 11.9389], times: ["11:45", "12:45"] },
    { date: "2026-10-15", place: "Soltorget", coords: [57.6969, 11.9865], times: ["11:45", "12:45"] },
    { date: "2026-10-21", place: "Hörnet", coords: [57.6975, 11.9575], times: ["11:45", "12:45"] },
    { date: "2026-11-04", place: "Bistro Nord", coords: [57.7089, 11.9746], times: ["11:45", "12:45"] },
    { date: "2026-11-12", place: "Kajplats 6", coords: [57.7068, 11.9389], times: ["11:45", "12:45"] },
    { date: "2026-11-18", place: "Soltorget", coords: [57.6969, 11.9865], times: ["11:45", "12:45"] },
    { date: "2026-11-26", place: "Hörnet", coords: [57.6975, 11.9575], times: ["11:45", "12:45"] }
  ];

  function parseDate(iso) {
    return new Date(iso + "T12:00:00");
  }

  function formatShort(dt) {
    return dt.getDate() + " " + MONTHS[dt.getMonth()];
  }

  var client = null;
  function db() {
    if (!client) {
      var cfg = window.SUPABASE_CONFIG || {};
      if (!cfg.url || !cfg.anonKey) throw new Error("Supabase is not configured — fill in js/config.js");
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
    }
    return client;
  }

  // { "2026-09-17|11:45": true, … } — presence only, never who.
  async function fetchTakenSlots() {
    var res = await db().rpc("taken_slots");
    if (res.error) throw res.error;
    var set = {};
    (res.data || []).forEach(function (row) { set[row.booking_date + "|" + row.booking_time] = true; });
    return set;
  }

  async function lastLunchFor(employeeId) {
    var res = await db().rpc("last_lunch", { p_employee_id: employeeId });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function createBooking(entry) {
    var res = await db().rpc("create_booking", {
      p_employee_id: entry.employeeId,
      p_employee_name: entry.employeeName,
      p_date: entry.date,
      p_time: entry.time,
      p_place: entry.place
    });
    if (res.error) {
      var msg = res.error.message || "";
      if (msg.indexOf("slot_taken") !== -1) throw new Error("slot_taken");
      if (msg.indexOf("cooldown_active") !== -1) throw new Error("cooldown_active");
      throw res.error;
    }
    var row = Array.isArray(res.data) ? res.data[0] : res.data;
    return row; // { id, cancel_token, booked_at }
  }

  async function cancelBooking(id, cancelToken) {
    var res = await db().rpc("cancel_booking", { p_id: id, p_token: cancelToken });
    if (res.error) throw res.error;
    return !!res.data;
  }

  // — admin only: requires an authenticated session (see admin.js) —
  async function adminListBookings() {
    var res = await db().from("bookings").select("*").order("date").order("time");
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function adminDeleteBooking(id) {
    var res = await db().from("bookings").delete().eq("id", id);
    if (res.error) throw res.error;
  }

  async function signInWithPassword(email, password) {
    var res = await db().auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw res.error;
    return res.data;
  }

  async function getSession() {
    try {
      var res = await db().auth.getSession();
      return res.data ? res.data.session : null;
    } catch (e) {
      return null;
    }
  }

  async function signOut() {
    await db().auth.signOut();
  }

  window.LunchStore = {
    COOLDOWN_WEEKS: COOLDOWN_WEEKS,
    MONTHS: MONTHS,
    WEEKDAYS_FULL: WEEKDAYS_FULL,
    EMPLOYEES: EMPLOYEES,
    LUNCH_DAYS: LUNCH_DAYS,
    parseDate: parseDate,
    formatShort: formatShort,
    fetchTakenSlots: fetchTakenSlots,
    lastLunchFor: lastLunchFor,
    createBooking: createBooking,
    cancelBooking: cancelBooking,
    adminListBookings: adminListBookings,
    adminDeleteBooking: adminDeleteBooking,
    signInWithPassword: signInWithPassword,
    getSession: getSession,
    signOut: signOut
  };
})();
