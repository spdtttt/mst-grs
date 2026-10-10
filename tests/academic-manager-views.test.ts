import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";

const uuid = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("academic staff can read manager statistics and student lists; other roles cannot", async () => {
  const db = await loadTestDatabase();
  const manager = uuid(1);
  const academic = uuid(2);
  const teacher = uuid(3);
  const student = uuid(4);
  const doneStudent = uuid(5);
  async function as(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function stats() {
    return (await db.query<{ s: Record<string, number> }>(
      "select manager_dashboard_stats() s",
    )).rows[0].s;
  }
  async function list(completed: boolean) {
    return (await db.query<{ r: { total: number; items: { student_code: string }[] } }>(
      "select manager_student_list_filtered($1,'',20,0,null,null,null) r",
      [completed],
    )).rows[0].r;
  }
  async function courses(code: string) {
    return (await db.query<{ r: unknown[] }>(
      "select manager_student_courses($1) r",
      [code],
    )).rows[0].r;
  }
  try {
    for (const [id, role] of [
      [manager, "manager"],
      [academic, "academic"],
      [teacher, "teacher"],
      [student, "student"],
      [doneStudent, "student"],
    ]) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code) values($1,$2::text::app_role,$2::text,$3)",
        [id, role, role === "student" ? (id === student ? "S1" : "S2") : null],
      );
    }
    for (const [n, studentId, code, status] of [
      [10, student, "S1", "pending"],
      [11, doneStudent, "S2", "completed"],
    ] as const) {
      await db.query(
        `insert into grade_records(
          id,student_id,student_code,student_name,course_code,course_name,credits,classroom,
          teacher_id,teacher_name,roll_number,academic_year,semester,original_grade,status,final_grade,completed_at
        ) values($1,$2,$3,$3,'c1','Course',1,'ม.4/2',array[$4::uuid],array['teacher'],1,2569,1,'0',$5::text::grade_status,
          case when $6::boolean then '1' end,
          case when $6::boolean then now() end)`,
        [uuid(n), studentId, code, teacher, status, status === "completed"],
      );
    }

    for (const viewer of [manager, academic]) {
      await as(viewer);
      const s = await stats();
      assert.equal(s.total_students, 2);
      assert.equal(s.completed_students, 1);
      assert.equal(s.incomplete_students, 1);
      const incomplete = await list(false);
      assert.equal(incomplete.total, 1);
      assert.equal(incomplete.items[0].student_code, "S1");
      const completed = await list(true);
      assert.equal(completed.total, 1);
      assert.equal(completed.items[0].student_code, "S2");
      assert.equal((await courses("S1")).length, 1);
    }

    for (const viewer of [teacher, student]) {
      await as(viewer);
      await assert.rejects(stats, /ไม่มีสิทธิ์ดูสถิติผู้บริหาร/);
      await assert.rejects(() => list(false), /ไม่มีสิทธิ์ดูรายชื่อนักเรียน/);
      await assert.rejects(() => courses("S1"), /ไม่มีสิทธิ์ดูรายละเอียดนักเรียน/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(stats, /permission denied/);
  } finally {
    await db.close();
  }
});
