import assert from "node:assert/strict";
import { icsDateTime, addMinutes, escapeText, buildIcs } from "./ics.ts";

function assertEquals(actual: unknown, expected: unknown) { assert.deepStrictEqual(actual, expected); }
function assertStringIncludes(actual: string, expected: string) { assert.ok(actual.includes(expected), "expected string to include: " + expected); }

Deno.test("icsDateTime formats date+time correctly", () => {
  assertEquals(icsDateTime("2026-10-08", "12:00"), "20261008T120000");
  assertEquals(icsDateTime("2026-01-05", "9:05"), "20260105T090500");
});

Deno.test("addMinutes adds duration without crossing into the next day wrongly", () => {
  assertEquals(addMinutes("2026-10-08", "12:00", 60), "20261008T130000");
});

Deno.test("addMinutes rolls over midnight correctly", () => {
  assertEquals(addMinutes("2026-10-08", "23:30", 60), "20261009T003000");
});

Deno.test("escapeText escapes commas, semicolons, backslashes", () => {
  assertEquals(escapeText("Lunch, med; Alma\\Bob"), "Lunch\\, med\\; Alma\\\\Bob");
});

Deno.test("buildIcs produces a well-formed calendar with one event per row", () => {
  var ics = buildIcs([
    { id: "abc-123", employee_name: "Ulrika Jarnberger", booking_date: "2026-10-08", booking_time: "12:00", place: "Lindholmen" }
  ]);
  assertStringIncludes(ics, "BEGIN:VCALENDAR");
  assertStringIncludes(ics, "END:VCALENDAR");
  assertStringIncludes(ics, "BEGIN:VEVENT");
  assertStringIncludes(ics, "UID:abc-123@lunchbokning");
  assertStringIncludes(ics, "DTSTART:20261008T120000");
  assertStringIncludes(ics, "DTEND:20261008T130000");
  assertStringIncludes(ics, "SUMMARY:Lunch med Ulrika Jarnberger");
  assertStringIncludes(ics, "LOCATION:Lindholmen");
  // CRLF line endings per RFC 5545
  assertStringIncludes(ics, "VCALENDAR\r\n");
});

Deno.test("buildIcs with zero rows is still a valid (empty) calendar", () => {
  var ics = buildIcs([]);
  assertStringIncludes(ics, "BEGIN:VCALENDAR");
  assertStringIncludes(ics, "END:VCALENDAR");
  assertEquals(ics.indexOf("BEGIN:VEVENT"), -1);
});
