import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";

test("grade corrections lock when academics approve, including stale requests", async (t) => {
  const db = await loadTestDatabase({ through: "044" });
  const [student, teacher, otherTeacher, academic, admin, coTeacher] =
    Array.from({ length: 6 }, (_, i) => `80000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  const statuses = ["pending", "requested", "assigned", "submitted", "teacher_approved", "completed"];
  async function as(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  const correct = (id: string, expected: string, next: string) =>
    db.query<{ result: { previous_grade: string; new_grade: string; changed_by: string } }>(
      "select correct_final_grade($1,$2,$3) result", [id, expected, next],
    );
  async function snapshot(id: string) {
    return {
      record: (await db.query<Record<string, unknown>>("select * from grade_records where id=$1", [id])).rows,
      corrections: (await db.query<Record<string, unknown>>("select * from grade_corrections where record_id=$1 order by id", [id])).rows,
      audit: (await db.query<Record<string, unknown>>("select * from audit_log where record_id=$1 order by id", [id])).rows,
    };
  }
  try {
    for (const [id, role, name, code] of [
      [student, "student", "Student", "00123"],
      [teacher, "teacher", "Teacher", null],
      [otherTeacher, "teacher", "Other teacher", null],
      [academic, "academic", "Academic", null],
      [admin, "admin", "Admin", null],
      [coTeacher, "teacher", "Co-teacher", null],
    ]) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query("insert into profiles(id,role,full_name,student_code) values($1,$2,$3,$4)", [id, role, name, code]);
    }
    await as(admin);
    await db.exec("select update_schedule(now()-interval '1 day',now()+interval '2 days','test')");
    await db.query("select import_grades($1::jsonb)", [JSON.stringify(statuses.map(status => ({
      course_code: status, course_name: status, credits: 1, classroom: "1/1",
      teacher_name: ["Teacher", "Co-teacher"], student_code: "00123", student_name: "Student",
      roll_number: 1, academic_year: 2569, semester: 1, original_grade: "0",
    })))]);
    await db.exec("reset role");
    for (const status of statuses) {
      await db.query(`update grade_records set status=$1::grade_status,
        final_grade=case when $1 in ('teacher_approved','completed') then '1' end,
        teacher_approved_at=case when $1 in ('teacher_approved','completed') then now() end,
        completed_at=case when $1='completed' then now() end where course_code=$1`, [status]);
    }
    const records = (await db.query<{ id: string; status: string }>("select id,status from grade_records")).rows;
    const idFor = (status: string) => records.find(r => r.status === status)!.id;
    const approvedId = idFor("teacher_approved");
    const completedId = idFor("completed");

    // Existing corrections made under the old policy must survive the upgrade.
    await as(teacher);
    await correct(completedId, "1", "2");
    await db.exec("reset role");
    const legacy = await snapshot(completedId);
    await db.exec(readFileSync("tests/fixtures/migration-history/045_lock_approved_grade_corrections.sql", "utf8"));
    await db.exec(readFileSync("tests/fixtures/migration-history/051_measurement_wording.sql", "utf8"));
    assert.deepEqual(await snapshot(completedId), legacy);

    await t.test("only assigned teachers may correct grades through the RPC", async () => {
      for (const actor of [student, otherTeacher, academic, admin]) {
        await as(actor);
        await assert.rejects(() => correct(approvedId, "1", "3"), /ไม่มีสิทธิ์/);
      }
      await db.exec("reset role; set role anon");
      await assert.rejects(() => correct(approvedId, "1", "3"), /permission denied/);
      await as(teacher);
      await assert.rejects(() => db.query("update grade_records set final_grade='4' where id=$1", [completedId]), /permission denied/);
    });

    await t.test("earlier workflow states cannot use grade correction", async () => {
      await as(teacher);
      for (const status of statuses.slice(0, 4)) {
        await assert.rejects(() => correct(idFor(status), "1", "3"), /เฉพาะรายการที่รอฝ่ายวัดผลอนุมัติ/);
      }
    });

    await t.test("all supported grades and co-teachers retain correction history before approval", async () => {
      let previous = "1";
      for (const grade of ["0", "ร", "มผ", "1.5", "2", "2.5", "3", "3.5", "4", "ผ", "1"]) {
        await as(grade === "ผ" ? coTeacher : teacher);
        const result = (await correct(approvedId, previous, grade)).rows[0].result;
        assert.equal(result.previous_grade, previous);
        assert.equal(result.new_grade, grade);
        assert.equal(result.changed_by, grade === "ผ" ? coTeacher : teacher);
        previous = grade;
      }
      await db.exec("reset role");
      const state = await snapshot(approvedId);
      assert.equal(state.record[0].status, "teacher_approved");
      assert.equal(state.record[0].final_grade, "1");
      assert.equal(state.corrections.length, 11);
      assert.equal(state.audit.filter(row => row.action === "correct_final_grade").length, 11);
      await as(teacher);
      await assert.rejects(() => correct(approvedId, "0", "3"), /เปลี่ยนแปลงแล้ว/);
      await assert.rejects(() => correct(approvedId, "1", "1"), /ต่างจากเดิม/);
      await assert.rejects(() => correct(approvedId, "1", "5"), /ที่ถูกต้อง/);
      await db.exec("reset role");
      assert.deepEqual(await snapshot(approvedId), state);
    });

    await t.test("already completed records reject changes without modifying data or audit", async () => {
      await as(teacher);
      await assert.rejects(() => correct(completedId, "2", "4"), /ฝ่ายวัดผลอนุมัติแล้ว/);
      await db.exec("reset role");
      assert.deepEqual(await snapshot(completedId), legacy);
    });

    await t.test("a request opened before approval cannot save after academic approval", async () => {
      await as(teacher);
      const staleGrade = (await db.query<{ final_grade: string }>(
        "select final_grade from grade_records where id=$1", [approvedId],
      )).rows[0].final_grade;
      await as(academic);
      await db.query("select advance_grade($1,'teacher_approved')", [approvedId]);
      await db.exec("reset role");
      const approved = await snapshot(approvedId);
      assert.equal(approved.record[0].status, "completed");
      assert.ok(approved.record[0].completed_at);
      for (const actor of [teacher, coTeacher]) {
        await as(actor);
        await assert.rejects(() => correct(approvedId, staleGrade, "4"), /ฝ่ายวัดผลอนุมัติแล้ว/);
      }
      await db.exec("reset role");
      assert.deepEqual(await snapshot(approvedId), approved);
    });

    await t.test("first teacher approval still works and closed periods reject corrections", async () => {
      await as(teacher);
      await db.query("select advance_grade($1,'submitted',null,null,'0')", [idFor("submitted")]);
      await correct(idFor("submitted"), "0", "ร");
      await as(admin);
      await db.exec("select update_schedule(now()+interval '1 day',now()+interval '2 days','not open yet')");
      await as(teacher);
      await assert.rejects(() => correct(idFor("submitted"), "ร", "4"), /ระบบปิด/);
    });
  } finally {
    await db.close();
  }
});
