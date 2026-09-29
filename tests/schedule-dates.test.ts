import { test } from "node:test";
import assert from "node:assert/strict";
import { bangkokDate, normalizeSchedule, scheduleClosingDate, scheduleDates } from "../src/lib/schedule-dates";
import { isOpen } from "../src/lib/domain";

test("same-day schedule covers the whole selected Bangkok day", () => {
  const range = scheduleDates("2026-09-29", "2026-09-29")!;
  assert.deepEqual(range, { opens_at: "2026-09-28T17:00:00.000Z", closes_at: "2026-09-29T17:00:00.000Z" });
  const schedule = { id: 1, notice: "", ...range };
  assert.equal(isOpen(schedule, Date.parse(range.opens_at) - 1), false);
  assert.equal(isOpen(schedule, Date.parse(range.opens_at)), true);
  assert.equal(isOpen(schedule, Date.parse(range.closes_at) - 1), true);
  assert.equal(isOpen(schedule, Date.parse(range.closes_at)), false);
  assert.equal(scheduleClosingDate(range.closes_at), "2026-09-29");
});

test("date ranges handle leap days and year rollover without a browser timezone", () => {
  assert.equal(scheduleDates("2028-02-29", "2028-02-29")?.closes_at, "2028-02-29T17:00:00.000Z");
  assert.equal(bangkokDate(scheduleDates("2026-12-31", "2026-12-31")!.closes_at), "2027-01-01");
  for (const [start, end] of [["", ""], ["2026-02-29", "2026-03-01"], ["2026-10-01", "2026-09-30"], ["2026-09-29T09:00", "2026-09-30"]]) {
    assert.equal(scheduleDates(start, end), null);
  }
});

test("legacy times normalize once and repeated edits keep the same closing day", () => {
  const normalized = normalizeSchedule({ opens_at: "2026-09-29T09:00:00+07:00", closes_at: "2026-09-30T15:00:00+07:00" });
  assert.equal(normalized.opens_at, "2026-09-28T17:00:00.000Z");
  assert.equal(normalized.closes_at, "2026-09-30T17:00:00.000Z");
  assert.deepEqual(normalizeSchedule(normalized), normalized);
  assert.deepEqual(scheduleDates(bangkokDate(normalized.opens_at), scheduleClosingDate(normalized.closes_at)), normalized);
});
