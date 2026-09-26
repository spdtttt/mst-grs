import { test } from "node:test";
import assert from "node:assert/strict";
import { syntheticSchool, syntheticCounts } from "../src/lib/synthetic-school";
import { importSchema } from "../src/lib/import";

test("load fixtures have exactly the requested accounts and more than 500 unfinished grades", () => {
  const data = syntheticSchool();
  assert.equal(data.accounts.length, 2520);
  for (const [role, count] of Object.entries(syntheticCounts))
    assert.equal(data.accounts.filter(a => a.role === role).length, count);
  assert.equal(new Set(data.accounts.map(a => a.id)).size, 2520);
  assert.equal(new Set(data.accounts.map(a => `${a.role}:${a.identifier}`)).size, 2520);
  assert.equal(data.records.length, 1200);
  assert.equal(data.records.filter(r => r.status !== "completed").length, 1000);
  assert.equal(data.records.filter(r => r.status === "completed").length, 200);
  assert.equal(new Set(data.records.map(r => [r.student_code, r.course_code, r.academic_year, r.semester].join("/"))).size, 1200);
  const people = new Map(data.accounts.map(a => [a.id, a]));
  for (const r of data.records) {
    assert.equal(people.get(r.student_id)?.role, "student");
    for (const teacher of r.teacher_id) assert.equal(people.get(teacher)?.role, "teacher");
  }
  for (const row of data.imports) assert.equal(importSchema.safeParse(row).success, true);
});
