import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { demoRecords } from "../src/lib/demo";
import type { GradeRecord } from "../src/lib/domain";
import {
  summarizeManagerStats,
  type ManagerStats,
} from "../src/lib/manager-stats";

const emptyDistribution = {
  one: 0,
  two_to_three: 0,
  four_to_five: 0,
  more_than_five: 0,
};
const uuid = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("course completion can be 80% while no student has completed all courses", () => {
  const records = Array.from({ length: 100 }, (_, student) =>
    Array.from({ length: 5 }, (_, course) => ({
      ...demoRecords[0],
      id: `${student}-${course}`,
      student_id: String(student),
      status:
        course < 4 ? ("completed" as const) : ("teacher_approved" as const),
    })),
  ).flat();
  const stats = summarizeManagerStats(records);
  assert.equal(stats.completed_records / stats.total_records, 0.8);
  assert.equal(stats.completed_students, 0);
  assert.equal(stats.incomplete_students, 100);
  assert.deepEqual(stats.students_by_remaining_records, {
    ...emptyDistribution,
    one: 100,
  });
  assert.deepEqual(
    summarizeManagerStats([]).students_by_remaining_records,
    emptyDistribution,
  );
});

test("manager SQL and demo agree on bucket boundaries, permissions and active-record scope", async () => {
  const db = await loadTestDatabase();
  const manager = uuid(1);
  const teacher = uuid(2);
  const records: GradeRecord[] = [];
  async function as(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function stats() {
    return (
      await db.query<{ stats: ManagerStats }>(
        "select manager_dashboard_stats() stats",
      )
    ).rows[0].stats;
  }
  try {
    for (const [id, role] of [
      [manager, "manager"],
      [teacher, "teacher"],
    ]) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2::text::app_role,$2::text)",
        [id, role],
      );
    }
    await as(manager);
    assert.deepEqual(await stats(), summarizeManagerStats([]));
    await db.exec("reset role");

    // Every bucket boundary, a fully completed student, and an unclassified student.
    for (const remaining of [0, 1, 2, 3, 4, 5, 6]) {
      const student = uuid(10 + remaining);
      await db.query("insert into auth.users(id) values($1)", [student]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code) values($1,'student',$2,$2)",
        [student, String(remaining)],
      );
      for (let i = 0; i <= remaining; i++) {
        const completed = i === 0;
        const record: GradeRecord = {
          ...demoRecords[0],
          id: uuid(100 + records.length),
          student_id: student,
          student_code: String(remaining),
          course_code: `course-${i}`,
          classroom: remaining === 6 ? "unknown" : "ม.4/2",
          teacher_id: [teacher],
          teacher_name: ["teacher"],
          status: completed
            ? "completed"
            : i === 1
              ? "teacher_approved"
              : "pending",
          final_grade: i <= 1 ? "1" : null,
          completed_at: completed ? "2026-09-16T10:00:00Z" : null,
          academic_year: i % 2 === 0 ? 2569 : 2568,
        };
        records.push(record);
        await db.query(
          `insert into grade_records(
          id,student_id,student_code,student_name,course_code,course_name,credits,classroom,
          teacher_id,teacher_name,roll_number,academic_year,semester,original_grade,status,final_grade,completed_at,created_at
        ) values($1,$2,$3,$3,$4,'Course',1,$5,array[$6::uuid],array['teacher'],1,$7,1,'0',$8,$9,$10,$11)`,
          [
            record.id,
            student,
            record.student_code,
            record.course_code,
            record.classroom,
            teacher,
            record.academic_year,
            record.status,
            record.final_grade,
            record.completed_at,
            record.created_at,
          ],
        );
      }
    }
    await as(manager);
    const actual = await stats();
    assert.deepEqual(actual, summarizeManagerStats(records));
    assert.deepEqual(actual.students_by_remaining_records, {
      one: 1,
      two_to_three: 2,
      four_to_five: 2,
      more_than_five: 1,
    });
    assert.equal(actual.completed_students, 1);
    assert.equal(actual.completed_records, 7);
    assert.equal(actual.total_records, 28);
    assert.equal(actual.unclassified_students, 1);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );

    await db.exec("reset role; begin");
    await db.exec(
      "update grade_records set status='completed', completed_at=now(), final_grade='1'",
    );
    await as(manager);
    const allCompleted = await stats();
    assert.equal(allCompleted.completed_students, 7);
    assert.equal(allCompleted.completed_records, 28);
    assert.equal(allCompleted.incomplete_students, 0);
    assert.deepEqual(
      allCompleted.students_by_remaining_records,
      emptyDistribution,
    );
    await db.exec("reset role; rollback");

    await as(uuid(10));
    await assert.rejects(stats, /ไม่มีสิทธิ์ดูสถิติผู้บริหาร/);
    await as(teacher);
    await assert.rejects(stats, /ไม่มีสิทธิ์ดูสถิติผู้บริหาร/);
    await db.exec("reset role; set role anon");
    await assert.rejects(stats, /permission denied/);

    await db.exec("reset role");
    await db.exec(
      "select archive_completed_before_close(now() - interval '1 minute')",
    );
    await as(manager);
    const afterClose = await stats();
    assert.equal(afterClose.total_records, 21);
    assert.equal(afterClose.completed_records, 0);
    assert.equal(afterClose.total_students, 6);
    assert.equal(afterClose.completed_students, 0);
    assert.deepEqual(
      afterClose.students_by_remaining_records,
      actual.students_by_remaining_records,
    );
  } finally {
    await db.close();
  }
});
