import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";

test("grade imports overwrite only active records, reset progress and retain secure history", async (t) => {
  const db = await loadTestDatabase();
  const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
  const [student, teacher, newTeacher, academic, admin, manager, otherStudent] = ids;
  const row = (course: string) => ({ course_code: course, course_name: "Original course", credits: 1,
    classroom: "1/1", teacher_name: ["Teacher A"], student_code: "00123", student_name: "Student A",
    roll_number: 1, academic_year: 2569, semester: 1, original_grade: "0" });
  const statuses = ["pending", "requested", "assigned", "submitted", "teacher_approved", "completed"];
  const original = statuses.map(row);
  const replacement = original.map(r => ({ ...r, course_name: "Replaced course", credits: 2,
    classroom: "2/2", teacher_name: ["Teacher B"], roll_number: 2, original_grade: "ร" }));
  async function as(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function owner() { await db.exec("reset role"); }
  async function importRows(rows: unknown[], rpc = "import_grades_overwrite") {
    return (await db.query<{ result: { inserted: number; updated: number; skipped: number } }>(
      `select ${rpc}($1::jsonb) result`, [JSON.stringify(rows)])).rows[0].result;
  }
  async function count(table: string) {
    return Number((await db.query<{ n: number }>(`select count(*) n from ${table}`)).rows[0].n);
  }
  try {
    for (const [i, role, name, code] of [
      [0, "student", "Student A", "00123"], [1, "teacher", "Teacher A", null],
      [2, "teacher", "Teacher B", null], [3, "academic", "Academic", null],
      [4, "admin", "Admin", null], [5, "manager", "Manager", null],
      [6, "student", "Student B", "00456"],
    ] as const) {
      await db.query("insert into auth.users values($1)", [ids[i]]);
      await db.query("insert into profiles(id,role,full_name,student_code) values($1,$2,$3,$4)", [ids[i], role, name, code]);
    }
    await as(admin);
    await db.exec("select update_schedule(now()-interval '1 day',now()+interval '2 days','test')");
    assert.deepEqual(await importRows(original), { inserted: 6, updated: 0, skipped: 0 });
    await owner();
    for (const status of statuses) {
      await db.query(`update grade_records set status=$1::grade_status, assignment='Previous assignment', due_at=now(),
        requested_at=now(), assigned_at=now(), submitted_at=now(), teacher_approved_at=now(),
        completed_at=case when $1='completed' then now() end,
        final_grade=case when $1 in ('teacher_approved','completed') then '1' end where course_code=$1`, [status]);
    }
    const before = (await db.query<Record<string, unknown>>("select * from grade_records order by course_code")).rows;
    const completedId = before.find(r => r.status === "completed")!.id;
    const job = (await db.query<{ id: string }>(`insert into grade_assignments(record_id,round_number,assignment,due_at)
      values($1,1,'Previous assignment',now()) returning id`, [completedId])).rows[0].id;
    const path = `${completedId}/00000000-0000-4000-8000-000000000001.png`;
    await db.query(`insert into assignment_files(record_id,assignment_id,storage_path,original_name,mime_type,size_bytes,uploaded_by)
      values($1,$2,$3,'old.png','image/png',6600000,$4)`, [completedId, job, path, teacher]);
    await db.query("insert into storage.objects(bucket_id,name) values('assignment-files',$1)", [path]);
    await db.query(`insert into grade_corrections(record_id,student_id,teacher_id,previous_grade,new_grade,changed_by,changed_by_name)
      values($1,$2,array[$3::uuid],'0','1',$3,'Teacher A')`, [completedId, student, teacher]);

    await t.test("all six active statuses are overwritten and progress is detached into snapshots", async () => {
      await as(admin);
      assert.deepEqual(await importRows(replacement), { inserted: 0, updated: 6, skipped: 0 });
      await owner();
      const after = (await db.query<Record<string, unknown>>("select * from grade_records order by course_code")).rows;
      for (let i = 0; i < after.length; i++) {
        const r = after[i];
        assert.equal(r.id, before[i].id);
        assert.deepEqual(r.created_at, before[i].created_at);
        assert.equal(r.status, "pending");
        assert.equal(r.course_name, "Replaced course");
        assert.equal(Number(r.credits), 2);
        assert.equal(r.classroom, "2/2");
        assert.equal(r.roll_number, 2);
        assert.equal(r.original_grade, "ร");
        assert.deepEqual(r.teacher_id, [newTeacher]);
        assert.deepEqual(r.teacher_name, ["Teacher B"]);
        for (const key of ["assignment", "due_at", "requested_at", "assigned_at", "submitted_at", "teacher_approved_at", "completed_at", "final_grade"]) assert.equal(r[key], null, key);
      }
      const snapshots = (await db.query<{ id: string; record_id: string; record_snapshot: Record<string, unknown>; reset_reason: string; reset_by: string; closes_at: null }>("select * from grade_reset_history")).rows;
      assert.equal(snapshots.length, 6);
      for (const s of snapshots) {
        assert.equal(s.reset_reason, "import_overwrite"); assert.equal(s.reset_by, admin); assert.equal(s.closes_at, null);
        assert.equal(s.record_snapshot.status, before.find(r => r.id === s.record_id)!.status);
        assert.equal(s.record_snapshot.assignment, "Previous assignment");
      }
      const snapshot = snapshots.find(s => s.record_id === completedId)!;
      const files = (await db.query<{ record_id: null; reset_history_id: string; storage_path: string; assignment_id: string }>("select * from assignment_files")).rows;
      assert.equal(files[0].record_id, null); assert.equal(files[0].reset_history_id, snapshot.id);
      assert.equal(files[0].storage_path, path); assert.equal(files[0].assignment_id, job);
      assert.deepEqual((await db.query("select record_id,reset_history_id from grade_assignments")).rows, [{ record_id: null, reset_history_id: snapshot.id }]);
      assert.equal(await count("grade_corrections"), 1);
      assert.equal(await count("audit_log where action='import_overwrite'"), 6);
    });

    await t.test("repeated overwrites work and roles retain only their permitted data", async () => {
      await as(admin);
      assert.deepEqual(await importRows(replacement, "import_grades"), { inserted: 0, updated: 6, skipped: 0 });
      assert.equal(await count("grade_records"), 0); // Admin cannot read student grade records.
      await assert.rejects(() => db.exec("update grade_records set final_grade='4'"), /permission denied/);
      await as(teacher); assert.equal(await count("grade_records"), 0);
      assert.equal(await count("grade_reset_history"), 6);
      assert.equal(await count("assignment_files"), 1);
      assert.equal(await count("storage.objects"), 1);
      await as(newTeacher); assert.equal(await count("grade_records"), 6);
      assert.equal(await count("grade_reset_history"), 6);
      assert.equal(await count("assignment_files"), 0);
      assert.equal(await count("storage.objects"), 0);
      await db.query("delete from storage.objects where name=$1", [path]);
      await owner(); assert.equal(await count("storage.objects"), 1);
      // Fresh, unattached uploads remain readable/removable by the current teacher.
      const freshPath = `${completedId}/00000000-0000-4000-8000-000000000002.png`;
      await db.query("insert into storage.objects(bucket_id,name) values('assignment-files',$1)", [freshPath]);
      await as(newTeacher); assert.equal(await count("storage.objects"), 1);
      await db.query("delete from storage.objects where name=$1", [freshPath]);
      assert.equal(await count("storage.objects"), 0);
      await as(student); assert.equal(await count("storage.objects"), 1);
      await as(otherStudent); assert.equal(await count("grade_reset_history"), 0);
      for (const id of [student, teacher, newTeacher, academic, manager, otherStudent]) {
        await as(id);
        for (const rpc of ["import_grades", "import_grades_overwrite"])
          await assert.rejects(() => importRows(original, rpc), /ไม่มีสิทธิ์/);
      }
      await db.exec("reset role; set role anon");
      await assert.rejects(() => importRows(original), /permission denied/);
      await owner(); assert.equal(await count("grade_reset_history"), 12);
    });

    await t.test("invalid rows and duplicates roll back the entire import", async () => {
      await owner();
      const counts = [await count("grade_reset_history"), await count("audit_log")];
      await as(admin);
      await assert.rejects(() => importRows([original[0], row("NEW"), { ...row("BAD"), teacher_name: ["Unknown"] }]), /ชื่อครูไม่พบ/);
      await assert.rejects(() => importRows([original[0], original[0]]), /ซ้ำในไฟล์/);
      await assert.rejects(() => importRows([{ ...row("BAD"), student_code: "unknown" }]), /ไม่พบบัญชี/);
      await owner();
      assert.equal(await count("grade_records"), 6);
      assert.deepEqual([await count("grade_reset_history"), await count("audit_log")], counts);
      assert.equal((await db.query<{ course_name: string }>("select course_name from grade_records where course_code='pending'")).rows[0].course_name, "Replaced course");
    });

    await t.test("the student and replacement teacher restart with assignment round one", async () => {
      await as(student);
      await db.query("select advance_grade($1,'pending')", [completedId]);
      await as(newTeacher);
      await db.query("select assign_grade($1,'New assignment after overwrite',now()+interval '1 day','[]'::jsonb,'requested')", [completedId]);
      assert.deepEqual((await db.query("select round_number,assignment from grade_assignments where record_id=$1", [completedId])).rows,
        [{ round_number: 1, assignment: "New assignment after overwrite" }]);
      assert.deepEqual((await db.query("select status,final_grade from grade_records where id=$1", [completedId])).rows,
        [{ status: "assigned", final_grade: null }]);
    });

    await t.test("closing still resets unfinished rows and archived duplicates remain immutable", async () => {
      await as(admin); assert.deepEqual(await importRows([row("ARCHIVE")]), { inserted: 1, updated: 0, skipped: 0 });
      await owner(); await db.exec("update grade_records set status='completed', completed_at=now(), final_grade='4' where course_code='ARCHIVE'");
      await as(admin); await db.exec("select update_schedule(now()-interval '3 days',now()-interval '1 day','closed')");
      await assert.rejects(() => importRows(original), /ไม่มีสิทธิ์/);
      await owner();
      const history = (await db.query("select * from grade_record_history")).rows;
      assert.equal(history.length, 1);
      assert.equal(await count("grade_reset_history where reset_reason='period_close' and closes_at is not null"), 6);
      await as(admin); await db.exec("select update_schedule(now()-interval '1 day',now()+interval '2 days','reopened')");
      assert.deepEqual(await importRows([row("NEW"), original[0], { ...row("ARCHIVE"), course_name: "Overwrite history?" }]), { inserted: 1, updated: 1, skipped: 1 });
      assert.deepEqual(await importRows([{ ...original[0], semester: 2 }, { ...original[0], academic_year: 2570 }]), { inserted: 2, updated: 0, skipped: 0 });
      await owner();
      assert.deepEqual((await db.query("select * from grade_record_history")).rows, history);
      assert.equal(await count("grade_records where course_code='ARCHIVE'"), 0);
      assert.equal(await count("grade_records"), 9);
    });
  } finally { await db.close(); }
});
