import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextStatus,
  statuses,
  isOpen,
  safeCell,
  isRole,
  roles,
  resetForNewPeriod,
} from "../src/lib/domain";
import { columns, parseRows, parseDelimited } from "../src/lib/import";
import { loginEmail, identityPassword } from "../src/lib/identity";
import { safeReturnPath } from "../src/lib/navigation";
import { demoRecords } from "../src/lib/demo";
import {
  summarizeManagerStats,
  summarizeManagerStudents,
} from "../src/lib/manager-stats";
test("new-period reset clears workflow progress without changing the original failed course", () => {
  for (const record of demoRecords.filter((record) => record.status !== "completed")) {
    const reset = resetForNewPeriod(record);
    assert.equal(reset.status, "pending");
    for (const field of ["assignment", "due_at", "requested_at", "assigned_at", "submitted_at", "teacher_approved_at", "completed_at", "final_grade"] as const) {
      assert.equal(reset[field], null);
    }
    for (const field of ["id", "academic_year", "semester", "original_grade", "course_code", "student_id", "teacher_id"] as const) {
      assert.deepEqual(reset[field], record[field]);
    }
    assert.deepEqual(resetForNewPeriod(reset), reset);
  }
});
test("two approvals are mandatory and teacher approval stays 75%", () => {
  assert.equal(nextStatus.student?.pending, "requested");
  assert.equal(nextStatus.teacher?.requested, "assigned");
  assert.equal(nextStatus.teacher?.assigned, "submitted");
  assert.equal(nextStatus.teacher?.submitted, "teacher_approved");
  assert.equal(nextStatus.academic?.teacher_approved, "completed");
  assert.equal(statuses.teacher_approved.progress, 75);
  assert.equal(statuses.completed.progress, 100);
  assert.equal(nextStatus.teacher?.teacher_approved, undefined);
  assert.equal(nextStatus.student?.assigned, undefined);
  assert.deepEqual(Object.keys(roles), [
    "student",
    "teacher",
    "academic",
    "manager",
  ]);
  assert.equal(isRole("manager"), true);
  assert.equal(nextStatus.manager, undefined);
  assert.equal(isRole("admin"), false);
  assert.equal(isRole(null), false);
});
test("schedule uses whole Bangkok dates, including the closing day", () => {
  const s = {
    id: 1,
    opens_at: "2026-09-17T09:00:00+07:00",
    closes_at: "2026-09-17T10:00:00+07:00",
    notice: "",
  };
  assert.equal(isOpen({ ...s, opens_at: null, closes_at: null }), false);
  assert.equal(isOpen(s, Date.parse("2026-09-17T02:00:00Z")), true);
  assert.equal(isOpen(s, Date.parse("2026-09-17T03:00:00Z")), true);
  assert.equal(isOpen(s, Date.parse("2026-09-16T17:00:00Z")), true);
  assert.equal(isOpen(s, Date.parse("2026-09-17T16:59:59.999Z")), true);
  assert.equal(isOpen(s, Date.parse("2026-09-17T17:00:00Z")), false);
});
test("manager chart counts students once after all their courses are complete", () => {
  const stats = summarizeManagerStats([
    ...demoRecords,
    {
      ...demoRecords[0],
      id: "another-student",
      student_id: "another-student",
      classroom: "ม.5/1",
      status: "completed",
    },
  ]);
  assert.deepEqual(
    [
      stats.total_records,
      stats.incomplete_records,
      stats.completed_records,
      stats.total_students,
      stats.completed_students,
      stats.incomplete_students,
    ],
    [7, 5, 2, 2, 1, 1],
  );
  assert.deepEqual(
    stats.by_level
      .filter((row) => row.completed_students || row.incomplete_students)
      .map((row) => [
        row.level,
        row.completed_students,
        row.incomplete_students,
      ]),
    [
      [4, 0, 1],
      [5, 1, 0],
    ],
  );
  assert.deepEqual(stats.outstanding_by_status, {
    pending: 1,
    requested: 1,
    assigned: 1,
    submitted: 1,
    teacher_approved: 1,
  });
});
test("manager student totals include unknown levels and handle empty data", () => {
  const completed = {
    ...demoRecords[0],
    student_id: "completed-student",
    classroom: "ไม่ระบุ",
    status: "completed" as const,
  };
  const stats = summarizeManagerStats([
    ...demoRecords,
    completed,
    { ...completed, id: "second-course" },
  ]);
  assert.deepEqual(
    [
      stats.total_students,
      stats.completed_students,
      stats.incomplete_students,
      stats.unclassified_students,
    ],
    [2, 1, 1, 1],
  );
  const empty = summarizeManagerStats([]);
  assert.deepEqual(empty.outstanding_by_status, {
    pending: 0,
    requested: 0,
    assigned: 0,
    submitted: 0,
    teacher_approved: 0,
  });
  assert.deepEqual(
    [empty.total_students, empty.completed_students, empty.incomplete_students],
    [0, 0, 0],
  );
});
test("manager lists count each student once and paginate completed students", () => {
  const completed = Array.from({ length: 21 }, (_, index) => ({
    ...demoRecords[5],
    id: `finished-${index}`,
    student_id: `finished-${index}`,
    student_code: String(index).padStart(5, "0"),
    student_name: `นักเรียน ${index}`,
    classroom: "ม.5/1",
    academic_year: index === 0 ? 2568 : 2569,
    semester: index === 0 ? 2 : 1,
  }));
  const records = [...demoRecords, ...completed];
  const incompleteList = summarizeManagerStudents(records, false);
  assert.equal(incompleteList.total, 1);
  assert.deepEqual(
    [
      incompleteList.items[0].student_code,
      incompleteList.items[0].total_records,
      incompleteList.items[0].incomplete_records,
      incompleteList.items[0].completed_records,
    ],
    ["12345", 6, 5, 1],
  );
  assert.equal(summarizeManagerStudents(records, true).items.length, 20);
  assert.equal(summarizeManagerStudents(records, true, "", 2).items.length, 1);
  assert.equal(summarizeManagerStudents(records, true, "00020").total, 1);
  assert.equal(summarizeManagerStudents(records, false, "00020").total, 0);
  assert.deepEqual(incompleteList.years, [2569, 2568]);
  assert.equal(
    summarizeManagerStudents(records, false, "", 1, { level: 4, academicYear: 2569, semester: 1 }).total,
    1,
  );
  assert.equal(
    summarizeManagerStudents(records, false, "", 1, { level: 5 }).total,
    0,
  );
  const olderTerm = summarizeManagerStudents(records, true, "", 1, {
    level: 5,
    academicYear: 2568,
    semester: 2,
  });
  assert.deepEqual(olderTerm.items.map((student) => student.student_code), ["00000"]);
  assert.equal(
    summarizeManagerStudents(records, true, "", 1, { academicYear: 2568, semester: 1 }).total,
    0,
  );
});
test("CSV export neutralizes spreadsheet formulas including whitespace", () => {
  for (const c of ["=1+1", "+cmd", "-1", "@SUM(A1)", "\t=1"])
    assert.equal(safeCell(c), "'" + c);
  assert.equal(safeCell("01234"), "01234");
});
const row = [
  "ค31101",
  "คณิตศาสตร์",
  1.5,
  "ม.4/2",
  "ครู ตัวอย่าง",
  "00123",
  "นักเรียน ตัวอย่าง",
  12,
  2569,
  1,
  "ร",
];
test("import keeps only the specified 11 columns and leading zero IDs", () => {
  const result = parseRows(
    [...Object.keys(columns), "รวม", "Q1"],
    [[...row, 99, 88]],
  );
  assert.equal(result.errors.length, 0);
  assert.equal(Object.keys(result.rows[0]).length, 11);
  assert.equal(result.rows[0].student_code, "00123");
  assert.deepEqual(result.rows[0].teacher_name, ["ครู ตัวอย่าง"]);
  assert.equal("Q1" in result.rows[0], false);
});

test("import parses numbered co-teachers and rejects duplicate names", () => {
  const twoTeachers = [...row];
  twoTeachers[4] = "1.นางสาวนวิยา หมื่นหนู, 2.นางสาววรัญรัตน์ เพชรชำนาญ";
  const parsed = parseRows(Object.keys(columns), [twoTeachers]);
  assert.deepEqual(parsed.rows[0].teacher_name, [
    "นางสาวนวิยา หมื่นหนู",
    "นางสาววรัญรัตน์ เพชรชำนาญ",
  ]);
  assert.equal(parsed.errors.length, 0);
  const csvCell = parseDelimited('ครูผู้สอน\n"1.นางสาวนวิยา หมื่นหนู, 2.นางสาววรัญรัตน์ เพชรชำนาญ"')[1][0];
  assert.equal(csvCell, twoTeachers[4]);
  twoTeachers[4] = "1.ครู ตัวอย่าง, 2.ครู ตัวอย่าง";
  assert.equal(parseRows(Object.keys(columns), [twoTeachers]).errors.length, 1);
  twoTeachers[4] = "1.-ครูที่ปรึกษาชุมนุม -";
  assert.match(
    parseRows(Object.keys(columns), [twoTeachers]).errors[0],
    /กรุณาระบุชื่อครูจริง/,
  );
});
test("import rejects missing headers, wrong grade, duplicates and malformed numbers", () => {
  assert.throws(() => parseRows(["รหัสวิชา"], [row]));
  assert.equal(parseRows(Object.keys(columns), [row, row]).errors.length, 1);
  assert.equal(
    parseRows(Object.keys(columns), [[...row.slice(0, 10), "4"]]).errors.length,
    1,
  );
  const bad = [...row];
  bad[2] = "abc";
  assert.equal(parseRows(Object.keys(columns), [bad]).errors.length, 1);
});
test("CSV handles quoted commas, newlines, escaped quotes and TSV", () => {
  assert.deepEqual(parseDelimited('a,b\r\n"x,y","hello\nworld"\r\n"a""b",c'), [
    ["a", "b"],
    ["x,y", "hello\nworld"],
    ['a"b', "c"],
  ]);
  assert.deepEqual(parseDelimited("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.throws(() => parseDelimited('a,"b'));
});
test("derived auth identity hides citizen ID and separates roles", () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  assert.notEqual(
    loginEmail("teacher:1234567890123", secret),
    loginEmail("student:1234567890123", secret),
  );
  assert.ok(
    !loginEmail("teacher:1234567890123", secret).includes("1234567890123"),
  );
  assert.notEqual(
    identityPassword("teacher", "1234567890123", secret),
    identityPassword("student", "1234567890123", secret),
  );
  assert.throws(() => loginEmail("x", "short"));
});
test("post-login return paths stay inside the authenticated dashboard", () => {
  assert.equal(
    safeReturnPath(
      "/dashboard/assignments/00000000-0000-4000-8000-000000000001",
    ),
    "/dashboard/assignments/00000000-0000-4000-8000-000000000001",
  );
  assert.equal(safeReturnPath("https://example.com"), "/dashboard");
  assert.equal(safeReturnPath("//example.com"), "/dashboard");
  assert.equal(safeReturnPath("/demo"), "/dashboard");
});
