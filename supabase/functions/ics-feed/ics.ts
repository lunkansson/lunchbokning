// Pure ICS-formatting helpers, kept separate from index.ts so they can be
// unit-tested with plain `deno test` (no Supabase runtime needed).

export function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

// "2026-10-08", "12:00" -> "20261008T120000" (floating local time — no
// timezone conversion, so it shows as 12:00 in whatever zone the calendar
// app itself is set to).
export function icsDateTime(dateStr: string, timeStr: string): string {
  var datePart = dateStr.replace(/-/g, "");
  var parts = timeStr.split(":");
  var hh = pad(parseInt(parts[0], 10));
  var mm = pad(parseInt(parts[1], 10));
  return datePart + "T" + hh + mm + "00";
}

export function addMinutes(dateStr: string, timeStr: string, minutes: number): string {
  var d = new Date(dateStr + "T" + timeStr + ":00");
  d.setMinutes(d.getMinutes() + minutes);
  var y = d.getFullYear();
  var mo = pad(d.getMonth() + 1);
  var da = pad(d.getDate());
  var h = pad(d.getHours());
  var mi = pad(d.getMinutes());
  return "" + y + mo + da + "T" + h + mi + "00";
}

export function nowStamp(): string {
  var d = new Date();
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"
  );
}

export function escapeText(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface BookingRow {
  id: string;
  employee_name: string;
  booking_date: string;
  booking_time: string;
  place: string;
}

export function buildIcs(rows: BookingRow[]): string {
  var stamp = nowStamp();
  var lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lunchbokning//sv",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lunchbokning"
  ];

  rows.forEach(function (row) {
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + row.id + "@lunchbokning");
    lines.push("DTSTAMP:" + stamp);
    lines.push("DTSTART:" + icsDateTime(row.booking_date, row.booking_time));
    lines.push("DTEND:" + addMinutes(row.booking_date, row.booking_time, 60));
    lines.push("SUMMARY:" + escapeText("Lunch med " + row.employee_name));
    lines.push("LOCATION:" + escapeText(row.place));
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
