// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.window = {};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
new Function(fs.readFileSync(new URL("../ui/lib.js", import.meta.url), "utf8"))();
const G = window.GD;

test("calculator", () => {
  assert.equal(G.calc("2+2*3"), 8);
  assert.equal(G.calc("(2+2)*3"), 12);
  assert.equal(G.calc("2^10"), 1024);
  assert.equal(G.calc("15% * 200"), 30);
  assert.equal(G.calc("sqrt(16)+1"), 5);
  assert.equal(G.calc("2pi").toFixed(4), "6.2832");
  assert.equal(G.calc("1,000 / 4"), 250);
  assert.equal(G.calc("-3+5"), 2);
  assert.equal(G.calc("42"), null, "bare number is not a calculation");
  assert.equal(G.calc("hello"), null);
  assert.equal(G.calc("alert(1)"), null);
  assert.equal(G.calc("1/0"), null);
});

test("unit conversion", () => {
  assert.equal(G.convert("5 km in miles").value, 3.1068560);
  assert.equal(G.convert("100 f to c").value, 37.78);
  assert.equal(G.convert("1 gb in mb").value, 1024);
  assert.equal(G.convert("2 hours to minutes").value, 120);
  assert.equal(G.convert("5 km in kg"), null);
});

test("time zones", () => {
  assert.match(G.timeIn("time in tokyo").sub, /Asia\/Tokyo/);
  assert.match(G.timeIn("london time").text, /London/);
  assert.equal(G.timeIn("time in atlantis"), null);
});

test("ics parsing and recurrence", () => {
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Standup", "DTSTART:20261102T150000Z", "DTEND:20261102T151500Z",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261126", "DTEND;VALUE=DATE:20261127", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Lunch\\, with Sam", "DTSTART;TZID=America/Chicago:20261127T120000", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Gone", "STATUS:CANCELLED", "DTSTART:20261127T120000Z", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const evs = G.parseIcs(ics);
  assert.equal(evs.length, 3);
  assert.equal(evs[2].title, "Lunch, with Sam");
  assert.equal(evs[2].start.toISOString(), "2026-11-27T18:00:00.000Z", "Chicago noon = 18:00 UTC");
  assert.ok(evs[1].allDay);
  const out = G.expand(evs, new Date("2026-11-01"), new Date("2026-12-31"));
  assert.equal(out.filter((e) => e.title === "Standup").length, 6);
  const days = out.filter((e) => e.title === "Standup").map((e) => e.start.getUTCDay());
  assert.deepEqual(days, [1, 3, 5, 1, 3, 5]);
});
