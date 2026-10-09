import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("PostgreSQL enforces role isolation, schedule, two approvals and atomic imports", async () => {
  const db = new PGlite();
  const student = "00000000-0000-0000-0000-000000000001",
    other = "00000000-0000-0000-0000-000000000002",
    teacher = "00000000-0000-0000-0000-000000000003",
    academic = "00000000-0000-0000-0000-000000000004",
    admin = "00000000-0000-0000-0000-000000000005",
    otherTeacher = "00000000-0000-0000-0000-000000000006",
    manager = "00000000-0000-0000-0000-000000000007";
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; create schema storage; grant usage on schema storage to authenticated; create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(),bucket_id text not null,name text not null); alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated; create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace($1,'/[^/]+$',''),'/') $$; grant execute on function storage.foldername(text) to authenticated;",
    );
    await db.exec(readFileSync("tests/fixtures/migration-history/001_initial.sql", "utf8"));
    await db.exec(
      readFileSync(
        "tests/fixtures/migration-history/002_assignment_attachments.sql",
        "utf8",
      ),
    );
    await db.exec(readFileSync("tests/fixtures/migration-history/003_web_push.sql", "utf8"));
    for (const [id, role, name, code] of [
      [student, "student", "นักเรียน หนึ่ง", "001"],
      [other, "student", "นักเรียน สอง", "002"],
      [teacher, "teacher", "ครู หนึ่ง", null],
      [academic, "academic", "วิชาการ", null],
      [admin, "admin", "ผู้ดูแล", null],
      [otherTeacher, "teacher", "ครู สอง", null],
    ]) {
      await db.query("insert into auth.users values($1)", [id]);
      await db.query(
        "insert into public.profiles(id,role,full_name,student_code) values($1,$2,$3,$4)",
        [id, role, name, code],
      );
    }
    await db.query(
      "insert into audit_log(actor_id,action) values($1,'schedule_updated')",
      [admin],
    );
    await db.exec(
      readFileSync("tests/fixtures/migration-history/004_academic_schedule.sql", "utf8"),
    );
    await db.exec(
      readFileSync("tests/fixtures/migration-history/005_manager_role.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "tests/fixtures/migration-history/006_manager_dashboard_stats.sql",
        "utf8",
      ),
    );
    await db.query("insert into auth.users values($1)", [manager]);
    await db.exec(
      readFileSync(
        "tests/fixtures/migration-history/007_manager_student_counts.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        "tests/fixtures/migration-history/008_manager_outstanding_statuses.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync("tests/fixtures/migration-history/009_manager_student_lists.sql", "utf8"),
    );
    await db.exec(
      readFileSync("tests/fixtures/migration-history/010_manager_student_courses.sql", "utf8"),
    );
    await db.exec(
      readFileSync("tests/fixtures/migration-history/011_manager_student_filters.sql", "utf8"),
    );
    await db.query(
      "insert into public.profiles(id,role,full_name) values($1,'manager','ผู้บริหาร')",
      [manager],
    );
    assert.deepEqual(
      (
        await db.query<{ role: string }>(
          "select unnest(enum_range(null::public.app_role))::text as role",
        )
      ).rows.map((row) => row.role),
      ["student", "teacher", "academic", "manager"],
    );
    assert.equal(
      (await db.query("select id from profiles where id=$1", [admin])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select id from auth.users where id=$1", [admin])).rows
        .length,
      0,
    );
    assert.equal((await db.query("select id from profiles")).rows.length, 6);
    assert.equal((await db.query("select id from auth.users")).rows.length, 6);
    assert.equal(
      (
        await db.query(
          "select * from audit_log where actor_id is null and action='schedule_updated'",
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      () => db.query("update profiles set role='admin' where id=$1", [admin]),
      /invalid input value for enum/,
    );
    async function as(id: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    }
    const pushEndpoint =
      "https://push.example.test/subscriptions/teacher-device";
    await as(student);
    await assert.rejects(
      () => db.query("select manager_student_list(false,'',20,0)"),
      /ไม่มีสิทธิ์ดูรายชื่อนักเรียน/,
    );
    await assert.rejects(
      () => db.query("select manager_student_courses('001')"),
      /ไม่มีสิทธิ์ดูรายละเอียดนักเรียน/,
    );
    await assert.rejects(
      () => db.query("select manager_student_list_filtered(false,'',20,0,null,null,null)"),
      /ไม่มีสิทธิ์ดูรายชื่อนักเรียน/,
    );
    await assert.rejects(
      () =>
        db.query("select upsert_push_subscription($1,$2,$3,$4)", [
          pushEndpoint,
          "p".repeat(64),
          "a".repeat(24),
          "test",
        ]),
      /เฉพาะครู/,
    );
    await as(teacher);
    await db.query("select upsert_push_subscription($1,$2,$3,$4)", [
      pushEndpoint,
      "p".repeat(64),
      "a".repeat(24),
      "teacher-browser",
    ]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from push_subscriptions")).rows.length,
      1,
    );
    await as(otherTeacher);
    await db.query("select upsert_push_subscription($1,$2,$3,$4)", [
      pushEndpoint,
      "q".repeat(64),
      "b".repeat(24),
      "shared-device",
    ]);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ user_id: string }>(
          "select user_id from push_subscriptions",
        )
      ).rows[0].user_id,
      otherTeacher,
    );
    await as(otherTeacher);
    await db.query("select delete_push_subscription($1)", [pushEndpoint]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from push_subscriptions")).rows.length,
      0,
    );
    const input = {
      course_code: "ค31101",
      course_name: "คณิตศาสตร์",
      credits: 1.5,
      classroom: "ม.4/2",
      teacher_name: "ครู หนึ่ง",
      student_code: "001",
      student_name: "นักเรียน หนึ่ง",
      roll_number: 1,
      academic_year: 2569,
      semester: 1,
      original_grade: "0",
    };
    const importRows = (rows: unknown[]) =>
      db.query<{ result: { inserted: number; skipped: number } }>("select public.import_grades($1::jsonb) result", [
        JSON.stringify(rows),
      ]);
    await as(academic);
    await assert.rejects(() => importRows([input]), /ไม่มีสิทธิ์/);
    await as(student);
    await assert.rejects(
      () =>
        db.query(
          "select update_schedule(now()-interval '1 hour',now()+interval '1 day','test')",
        ),
      /ไม่มีสิทธิ์/,
    );
    await as(admin);
    assert.equal(
      (await db.query<{ role: null }>("select my_role() as role")).rows[0].role,
      null,
    );
    await assert.rejects(
      () =>
        db.query(
          "select update_schedule(now()-interval '1 hour',now()+interval '1 day','test')",
        ),
      /ไม่มีสิทธิ์/,
    );
    assert.equal(
      (await db.query("select * from site_schedule")).rows.length,
      0,
    );
    await as(teacher);
    await assert.rejects(
      () =>
        db.query(
          "select update_schedule(now()-interval '1 hour',now()+interval '1 day','test')",
        ),
      /ไม่มีสิทธิ์/,
    );
    await as(academic);
    await db.query(
      "select update_schedule(now()-interval '1 hour',now()+interval '1 day','test')",
    );
    await as(academic);
    await importRows([input]);
    const duplicate = await importRows([input]);
    assert.deepEqual((duplicate.rows[0] as { result: unknown }).result, {
      inserted: 0,
      skipped: 1,
    });
    await assert.rejects(
      () =>
        importRows([
          { ...input, course_code: "ว31101" },
          { ...input, course_code: "อ31101", student_code: "999" },
        ]),
      /ไม่พบบัญชี/,
    );
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      1,
      "failed import must roll back earlier rows",
    );
    const id = (await db.query<{ id: string }>("select id from grade_records"))
      .rows[0].id;
    const move = (
      expected: string,
      assignment: string | null = null,
      due: string | null = null,
      grade: string | null = null,
    ) =>
      db.query("select advance_grade($1,$2,$3,$4,$5)", [
        id,
        expected,
        assignment,
        due,
        grade,
      ]);
    await as(manager);
    assert.equal((await db.query("select * from profiles")).rows.length, 1);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    const initialStats = (
      await db.query<{ stats: Record<string, unknown> }>(
        "select manager_dashboard_stats() stats",
      )
    ).rows[0].stats;
    assert.equal(initialStats.total_records, 1);
    assert.equal(initialStats.incomplete_records, 1);
    assert.deepEqual(initialStats.outstanding_by_status, {
      pending: 1,
      requested: 0,
      assigned: 0,
      submitted: 0,
      teacher_approved: 0,
    });
    assert.equal(initialStats.completed_records, 0);
    assert.equal(initialStats.total_students, 1);
    const initialList = (
      await db.query<{
        list: {
          total: number;
          items: {
            student_code: string;
            total_records: number;
            incomplete_records: number;
          }[];
        };
      }>("select manager_student_list(false,'',20,0) list")
    ).rows[0].list;
    assert.equal(initialList.total, 1);
    assert.deepEqual(
      initialList.items.map((row) => [
        row.student_code,
        row.total_records,
        row.incomplete_records,
      ]),
      [["001", 1, 1]],
    );
    const initialCourses = (
      await db.query<{ courses: Record<string, unknown>[] }>(
        "select manager_student_courses('001') courses",
      )
    ).rows[0].courses;
    assert.equal(initialCourses.length, 1);
    assert.equal(initialCourses[0].status, "pending");
    assert.deepEqual(Object.keys(initialCourses[0]).sort(), [
      "academic_year", "course_code", "course_name", "credits", "id",
      "original_grade", "semester", "status", "teacher_name",
    ]);
    await db.exec("reset role");
    await db.exec(readFileSync("tests/fixtures/migration-history/012_multi_teachers.sql", "utf8"));
    await db.query(
      "update grade_records set status='assigned',assignment='Legacy assignment details',due_at=now()+interval '1 day',assigned_at=now() where id=$1",
      [id],
    );
    await db.query(
      "insert into assignment_files(record_id,storage_path,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,'legacy.pdf','application/pdf',1024,$3)",
      [id, `${id}/00000000-0000-4000-8000-000000000097.pdf`, teacher],
    );
    await db.exec(readFileSync("tests/fixtures/migration-history/013_assignment_rounds.sql", "utf8"));
    const legacyRound = (await db.query<{ id: string; assignment: string }>(
      "select id,assignment from grade_assignments where record_id=$1", [id],
    )).rows[0];
    assert.equal(legacyRound.assignment, "Legacy assignment details");
    assert.equal(
      (await db.query<{ assignment_id: string }>(
        "select assignment_id from assignment_files where record_id=$1", [id],
      )).rows[0].assignment_id,
      legacyRound.id,
    );
    await db.query("delete from assignment_files where record_id=$1", [id]);
    await db.query("delete from grade_assignments where record_id=$1", [id]);
    await db.query(
      "update grade_records set status='pending',assignment=null,due_at=null,assigned_at=null where id=$1",
      [id],
    );
    const migratedTeacher = (
      await db.query<{ teacher_name: string[]; teacher_id: string[] }>(
        "select teacher_name,teacher_id from grade_records where id=$1",
        [id],
      )
    ).rows[0];
    assert.deepEqual(migratedTeacher.teacher_name, ["ครู หนึ่ง"]);
    assert.deepEqual(migratedTeacher.teacher_id, [teacher]);
    await assert.rejects(
      () => db.query("delete from public.profiles where id=$1", [teacher]),
      /ไม่สามารถลบบัญชีครูที่มีรายการผลการเรียนอยู่/,
    );
    await as(academic);
    await assert.rejects(
      () => importRows([{ ...input, course_code: "ช31101", teacher_name: ["-ครูที่ปรึกษาชุมนุม -"] }]),
      /กรุณาระบุชื่อครูจริง/,
    );
    await assert.rejects(
      () => importRows([{ ...input, course_code: "ช31101", teacher_name: ["ครู ที่ไม่มีบัญชี"] }]),
      /ชื่อครูไม่พบหรือซ้ำ/,
    );
    await as(manager);
    const migratedCourses = (
      await db.query<{ courses: { teacher_name: string[] }[] }>(
        "select manager_student_courses('001') courses",
      )
    ).rows[0].courses;
    assert.deepEqual(migratedCourses[0].teacher_name, ["ครู หนึ่ง"]);
    assert.deepEqual(
      (
        initialStats.by_level as {
          level: number;
          incomplete_students: number;
        }[]
      )
        .filter((row) => row.incomplete_students > 0)
        .map((row) => row.level),
      [4],
    );
    await assert.rejects(() => move("pending"), /ไม่มีสิทธิ์/);
    await assert.rejects(() => importRows([input]), /ไม่มีสิทธิ์/);
    await assert.rejects(
      () =>
        db.query(
          "select update_schedule(now()-interval '1 hour',now()+interval '1 day','test')",
        ),
      /ไม่มีสิทธิ์/,
    );
    await as(other);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await assert.rejects(
      () => db.query("select manager_dashboard_stats()"),
      /ไม่มีสิทธิ์/,
    );
    await assert.rejects(() => move("pending"), /ไม่มีสิทธิ์/);
    await as(student);
    assert.equal((await db.query("select * from profiles")).rows.length, 1);
    await assert.rejects(
      () => db.query("update profiles set role='academic'"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("update grade_records set status='completed'"),
      /permission denied/,
    );
    await move("pending");
    await assert.rejects(() => move("pending"), /ข้อมูลเปลี่ยนแปลง/);
    await assert.rejects(
      () =>
        move(
          "requested",
          "assignment details",
          new Date(Date.now() + 86400000).toISOString(),
        ),
      /ไม่มีสิทธิ์/,
    );
    await as(otherTeacher);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        move(
          "requested",
          "assignment details",
          new Date(Date.now() + 86400000).toISOString(),
        ),
      /ไม่มีสิทธิ์/,
    );
    await as(teacher);
    const attachmentPath = `${id}/00000000-0000-4000-8000-000000000099.pdf`;
    await db.query(
      "insert into storage.objects(bucket_id,name) values('assignment-files',$1)",
      [attachmentPath],
    );
    await assert.rejects(
      () =>
        db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
          id,
          "short",
          new Date(Date.now() + 86400000).toISOString(),
          "[]",
          "requested",
        ]),
      /กรุณากรอก/,
    );
    await db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
      id,
      "Complete the assigned work",
      new Date(Date.now() + 86400000).toISOString(),
      JSON.stringify([
        {
          storage_path: attachmentPath,
          original_name: "assignment.pdf",
          mime_type: "application/pdf",
          size_bytes: 1024,
        },
      ]),
      "requested",
    ]);
    assert.equal(
      (await db.query("select * from assignment_files")).rows.length,
      1,
    );
    await db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
      id,
      "Updated assignment details",
      new Date(Date.now() + 2 * 86400000).toISOString(),
      "[]",
      "assigned",
    ]);
    assert.equal(
      (await db.query<{ assignment: string }>(
        "select assignment from grade_records where id=$1", [id],
      )).rows[0].assignment,
      "Updated assignment details",
    );
    assert.equal(
      (await db.query("select id from grade_assignments where record_id=$1", [id])).rows.length,
      1,
    );
    await as(otherTeacher);
    assert.equal(
      (await db.query("select id from grade_assignments where record_id=$1", [id])).rows.length,
      0,
    );
    await assert.rejects(
      () => db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
        id, "Unauthorized assignment edit", new Date(Date.now() + 2 * 86400000).toISOString(), "[]", "assigned",
      ]),
      /ไม่มีสิทธิ์/,
    );
    await as(teacher);
    await move("assigned");
    await assert.rejects(
      () => db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
        id, "Stale assignment edit", new Date(Date.now() + 3 * 86400000).toISOString(), "[]", "assigned",
      ]),
      /ข้อมูลเปลี่ยนแปลง/,
    );
    await db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
      id,
      "Second assignment after receiving the first",
      new Date(Date.now() + 3 * 86400000).toISOString(),
      "[]",
      "submitted",
    ]);
    const rounds = (await db.query<{
      round_number: number; received_at: string | null;
    }>("select round_number,received_at from grade_assignments where record_id=$1 order by round_number", [id])).rows;
    assert.equal(rounds.length, 2);
    assert.ok(rounds[0].received_at);
    assert.equal(rounds[1].received_at, null);
    assert.equal(
      (await db.query<{ round_number: number }>(
        "select a.round_number from assignment_files f join grade_assignments a on a.id=f.assignment_id where f.record_id=$1", [id],
      )).rows[0].round_number,
      1,
    );
    const reassigned = (await db.query<{ status: string; submitted_at: string | null }>(
      "select status,submitted_at from grade_records where id=$1", [id],
    )).rows[0];
    assert.equal(reassigned.status, "assigned");
    assert.equal(reassigned.submitted_at, null);
    await assert.rejects(() => move("submitted", null, null, "1"), /ข้อมูลเปลี่ยนแปลง/);
    await move("assigned");
    await assert.rejects(() => move("submitted"), /ระบุผลการเรียน/);
    await move("submitted", null, null, "1");
    await assert.rejects(
      () => db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
        id, "Too late to assign more work", new Date(Date.now() + 4 * 86400000).toISOString(), "[]", "submitted",
      ]),
      /ไม่มีสิทธิ์/,
    );
    await assert.rejects(() => move("teacher_approved"), /ไม่มีสิทธิ์/);
    assert.equal(
      (await db.query<{ status: string }>("select status from grade_records"))
        .rows[0].status,
      "teacher_approved",
    );
    await as(manager);
    const awaitingAcademic = (
      await db.query<{
        stats: { outstanding_by_status: { teacher_approved: number } };
      }>("select manager_dashboard_stats() stats")
    ).rows[0].stats;
    assert.equal(awaitingAcademic.outstanding_by_status.teacher_approved, 1);
    await as(academic);
    await move("teacher_approved");
    const completed = await db.query<{
      status: string;
      completed_at: unknown;
      final_grade: string;
    }>("select * from grade_records");
    assert.equal(completed.rows[0].status, "completed");
    assert.ok(completed.rows[0].completed_at);
    assert.equal(completed.rows[0].final_grade, "1");
    assert.equal(
      (await db.query("select * from audit_log where action='advance'")).rows
        .length,
      5,
    );
    assert.equal(
      (await db.query("select * from audit_log where action='assign:1'")).rows
        .length,
      1,
    );
    await importRows([
      { ...input, course_code: "ว31101", course_name: "วิทยาศาสตร์", teacher_name: ["ครู หนึ่ง", "ครู สอง"], academic_year: 2568, semester: 2 },
      {
        ...input,
        course_code: "อ32101",
        course_name: "ภาษาอังกฤษ",
        classroom: "ม.5/1",
        student_code: "002",
        student_name: "นักเรียน สอง",
        teacher_name: ["ครู หนึ่ง"],
        academic_year: 2568,
        semester: 2,
      },
    ]);
    await as(otherTeacher);
    const sharedRecords = await db.query<{
      id: string;
      teacher_name: string[];
      teacher_id: string[];
    }>("select id,teacher_name,teacher_id from grade_records");
    assert.equal(sharedRecords.rows.length, 1);
    assert.deepEqual(sharedRecords.rows[0].teacher_name, ["ครู หนึ่ง", "ครู สอง"]);
    assert.deepEqual(sharedRecords.rows[0].teacher_id, [teacher, otherTeacher]);
    const sharedId = sharedRecords.rows[0].id;
    await as(teacher);
    assert.equal((await db.query("select id from grade_records")).rows.length, 3);
    await as(student);
    await db.query("select advance_grade($1,'pending',null,null,null)", [sharedId]);
    await as(otherTeacher);
    const sharedAttachmentPath = `${sharedId}/00000000-0000-4000-8000-000000000098.pdf`;
    await db.query("insert into storage.objects(bucket_id,name) values('assignment-files',$1)", [sharedAttachmentPath]);
    await db.query("select assign_grade($1,$2,$3,$4::jsonb,$5::public.grade_status)", [
      sharedId,
      "Shared teacher assignment",
      new Date(Date.now() + 86400000).toISOString(),
      JSON.stringify([{
        storage_path: sharedAttachmentPath,
        original_name: "shared.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
      }]),
      "requested",
    ]);
    await as(teacher);
    assert.equal((await db.query("select id from assignment_files where record_id=$1", [sharedId])).rows.length, 1);
    assert.equal((await db.query("select id from storage.objects where name=$1", [sharedAttachmentPath])).rows.length, 1);
    await db.query("select advance_grade($1,'assigned',null,null,null)", [sharedId]);
    await as(otherTeacher);
    await db.query("select advance_grade($1,'submitted',null,null,'1')", [sharedId]);
    assert.equal(
      (await db.query<{ status: string }>("select status from grade_records where id=$1", [sharedId])).rows[0].status,
      "teacher_approved",
    );
    await db.exec("reset role");
    await db.query(
      "update public.grade_records set status='completed',final_grade='1',completed_at=now() where student_id=$1",
      [other],
    );
    await as(manager);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    const finalStats = (
      await db.query<{
        stats: {
          total_records: number;
          completed_records: number;
          incomplete_records: number;
          outstanding_by_status: Record<string, number>;
          total_students: number;
          completed_students: number;
          incomplete_students: number;
          by_level: {
            level: number;
            completed_students: number;
            incomplete_students: number;
          }[];
        };
      }>("select manager_dashboard_stats() stats")
    ).rows[0].stats;
    assert.deepEqual(
      [
        finalStats.total_records,
        finalStats.completed_records,
        finalStats.incomplete_records,
        finalStats.total_students,
        finalStats.completed_students,
        finalStats.incomplete_students,
      ],
      [3, 2, 1, 2, 1, 1],
    );
    assert.equal(
      Object.values(finalStats.outstanding_by_status).reduce(
        (total, count) => total + count,
        0,
      ),
      finalStats.incomplete_records,
    );
    assert.deepEqual(
      finalStats.by_level
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
      "a student with completed and pending courses counts once as incomplete",
    );
    const completedList = (
      await db.query<{
        list: {
          total: number;
          items: { student_code: string; incomplete_records: number }[];
        };
      }>("select manager_student_list(true,'002',20,0) list")
    ).rows[0].list;
    assert.equal(completedList.total, 1);
    assert.deepEqual(
      completedList.items.map((row) => [
        row.student_code,
        row.incomplete_records,
      ]),
      [["002", 0]],
    );
    const unmatchedList = (
      await db.query<{ list: { total: number; items: unknown[] } }>(
        "select manager_student_list(false,'002',20,0) list",
      )
    ).rows[0].list;
    assert.deepEqual(unmatchedList, { total: 0, items: [] });
    const filteredList = (
      await db.query<{
        list: { total: number; years: number[]; items: { student_code: string }[] };
      }>("select manager_student_list_filtered(false,'',20,0,4,2569,1) list")
    ).rows[0].list;
    assert.deepEqual(filteredList.years, [2569, 2568]);
    assert.deepEqual(filteredList.items.map((row) => row.student_code), ["001"]);
    assert.equal(filteredList.total, 1);
    const olderIncomplete = (
      await db.query<{ list: { total: number } }>(
        "select manager_student_list_filtered(false,'',20,0,null,2568,2) list",
      )
    ).rows[0].list;
    assert.equal(olderIncomplete.total, 0, "filter uses the student's latest term");
    const filteredCompleted = (
      await db.query<{ list: { total: number; items: { student_code: string }[] } }>(
        "select manager_student_list_filtered(true,'002',20,0,5,2568,2) list",
      )
    ).rows[0].list;
    assert.deepEqual(filteredCompleted.items.map((row) => row.student_code), ["002"]);
    assert.equal(filteredCompleted.total, 1);
    await assert.rejects(
      () => db.query("select manager_student_list_filtered(false,'',20,0,7,null,null)"),
      /ข้อมูลตัวกรองหรือการแบ่งหน้าไม่ถูกต้อง/,
    );
    const completedCourses = (
      await db.query<{ courses: { status: string }[] }>(
        "select manager_student_courses('002') courses",
      )
    ).rows[0].courses;
    assert.ok(completedCourses.length > 0);
    assert.ok(completedCourses.every((course) => course.status === "completed"));
    await db.exec("begin; reset role");
    await db.query(
      "update public.grade_records set classroom='ไม่ระบุ' where student_id=$1",
      [other],
    );
    await as(manager);
    const unclassifiedStats = (
      await db.query<{
        stats: {
          total_students: number;
          completed_students: number;
          incomplete_students: number;
          unclassified_students: number;
        };
      }>("select manager_dashboard_stats() stats")
    ).rows[0].stats;
    assert.deepEqual(
      [
        unclassifiedStats.total_students,
        unclassifiedStats.completed_students,
        unclassifiedStats.incomplete_students,
        unclassifiedStats.unclassified_students,
      ],
      [2, 1, 1, 1],
      "student cards include students without a recognized grade level",
    );
    await db.exec("rollback");
    await as(admin);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await as(academic);
    await db.query(
      "select update_schedule(now()-interval '2 hours',now()-interval '1 hour','closed')",
    );
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await db.query(
      "select update_schedule(now()+interval '1 hour',now()+interval '1 day','reopened later')",
    );
    await as(student);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await assert.rejects(() => move("completed"), /ปิดรับ/);
    await db.exec("reset role; set role anon");
    for (let i = 1; i <= 11; i++) {
      const result = await db.query<{ ok: boolean }>(
        "select consume_login_attempt($1) ok",
        ["a".repeat(64)],
      );
      assert.equal(result.rows[0].ok, i <= 10);
    }
    await assert.rejects(
      () => db.query("select * from profiles"),
      /permission denied/,
    );
    // Archive lifecycle: the cron entry point is exercised directly because
    // pg_cron is not available in the embedded PostgreSQL test runtime.
    await db.exec("reset role");
    await db.exec(readFileSync("tests/fixtures/migration-history/016_grade_record_history.sql", "utf8"));
    const beforeCompleted = (await db.query<{ id: string; student_id: string; teacher_id: string[] }>(
      "select * from grade_records where status='completed' order by id",
    )).rows;
    const beforePending = (await db.query("select * from grade_records where status<>'completed' order by id")).rows;
    assert.ok(beforeCompleted.length >= 2);
    assert.ok(beforePending.length > 0);
    assert.equal((await db.query<{ moved: number }>("select archive_completed_grade_records() moved")).rows[0].moved, 0, "never archive before closing");
    const roundsBefore = (await db.query<Record<string, unknown>>("select * from grade_assignments where record_id=$1 order by round_number", [id])).rows;
    const filesBefore = (await db.query<Record<string, unknown>>("select * from assignment_files where record_id=$1 order by id", [id])).rows;
    const auditsBefore = (await db.query("select * from audit_log where record_id=$1 order by id", [id])).rows;
    assert.ok(roundsBefore.length > 0);
    assert.ok(filesBefore.length > 0);
    assert.ok(auditsBefore.length > 0);
    // Simulate the clock passing the deadline without invoking the schedule UI.
    await db.exec("alter table site_schedule disable trigger archive_on_schedule_change; update site_schedule set opens_at=now()-interval '2 days',closes_at=now()-interval '1 day'; alter table site_schedule enable trigger archive_on_schedule_change;");
    await db.exec("create function test_archive_failure() returns trigger language plpgsql as $$ begin raise exception 'test archive rollback'; end $$; create trigger test_archive_failure before delete on grade_records for each row execute function test_archive_failure();");
    await assert.rejects(() => db.query("select archive_completed_grade_records()"), /test archive rollback/);
    assert.equal((await db.query("select * from grade_record_history")).rows.length, 0);
    assert.deepEqual((await db.query("select * from assignment_files where record_id=$1 order by id", [id])).rows, filesBefore, "failed move leaves attachments intact");
    await db.exec("drop trigger test_archive_failure on grade_records; drop function test_archive_failure();");
    assert.equal((await db.query<{ moved: number }>("select archive_completed_grade_records() moved")).rows[0].moved, beforeCompleted.length);
    assert.equal((await db.query<{ moved: number }>("select archive_completed_grade_records() moved")).rows[0].moved, 0, "cron retries are idempotent");
    assert.deepEqual((await db.query("select * from grade_records order by id")).rows, beforePending, "unfinished records are untouched");
    const archived = (await db.query<{ id: string; student_id: string; teacher_id: string[]; archived_at: unknown; archived_closes_at: unknown }>("select * from grade_record_history order by id")).rows;
    assert.deepEqual(archived.map(({ archived_at, archived_closes_at, ...record }) => record), beforeCompleted, "all original columns survive unchanged");
    assert.deepEqual((await db.query("select * from grade_assignments where archived_record_id=$1 order by round_number", [id])).rows,
      roundsBefore.map((r) => ({ ...r, record_id: null, archived_record_id: id })));
    assert.deepEqual((await db.query("select * from assignment_files where archived_record_id=$1 order by id", [id])).rows,
      filesBefore.map((r) => ({ ...r, record_id: null, archived_record_id: id })));
    assert.equal((await db.query("select * from audit_log where archived_record_id=$1", [id])).rows.length, auditsBefore.length + 1);

    for (const actor of [student, other, teacher, otherTeacher, academic, manager]) {
      await as(actor);
      const expected = archived.filter((record) => actor === academic ||
        ((actor === student || actor === other) && record.student_id === actor) ||
        ((actor === teacher || actor === otherTeacher) && record.teacher_id.includes(actor)));
      assert.deepEqual((await db.query<{ id: string }>("select id from grade_record_history order by id")).rows.map(r => r.id), expected.map(r => r.id), "history RLS applies while closed");
      await assert.rejects(() => db.query("select archive_completed_grade_records()"), /permission denied/);
      await assert.rejects(() => db.query("delete from grade_record_history"), /permission denied/);
      await assert.rejects(() => db.query("update grade_record_history set final_grade='4'"), /permission denied/);
    }
    await as(student);
    assert.equal((await db.query("select * from grade_assignments where archived_record_id=$1", [id])).rows.length, roundsBefore.length);
    assert.equal((await db.query("select * from assignment_files where archived_record_id=$1", [id])).rows.length, filesBefore.length);
    const archivedPath = filesBefore[0].storage_path;
    assert.equal((await db.query("select * from storage.objects where name=$1", [archivedPath])).rows.length, 1, "archived file remains downloadable while closed");
    await as(other);
    assert.equal((await db.query("select * from assignment_files where archived_record_id=$1", [id])).rows.length, 0);
    assert.equal((await db.query("select * from storage.objects where name=$1", [archivedPath])).rows.length, 0);
    await as(academic);
    await db.query("select update_schedule(now()-interval '1 hour',now()+interval '1 day','new period')");
    assert.deepEqual((await importRows([{ ...input, teacher_name: [input.teacher_name] }])).rows[0].result, { inserted: 0, skipped: 1 }, "reimport does not resurrect archived grades");
    assert.equal((await db.query("select * from grade_record_history")).rows.length, archived.length, "history remains available while open");
    await as(student);
    assert.equal((await db.query("select * from grade_record_history where id=$1", [id])).rows.length, 1);
    await as(teacher);
    assert.equal((await db.query("select * from grade_record_history where id=$1", [id])).rows.length, 1);

    // Reopening immediately after expiry must archive even before cron's tick.
    await db.exec("reset role");
    await db.query("update grade_records set status='completed',final_grade='1',completed_at=now() where id=$1", [sharedId]);
    await db.exec("alter table site_schedule disable trigger archive_on_schedule_change; update site_schedule set opens_at=now()-interval '2 days',closes_at=now()-interval '1 day'; alter table site_schedule enable trigger archive_on_schedule_change;");
    await as(academic);
    await db.query("select update_schedule(now()-interval '1 hour',now()+interval '1 day','reopen before cron')");
    assert.equal((await db.query("select * from grade_records where id=$1", [sharedId])).rows.length, 0);
    assert.equal((await db.query("select * from grade_record_history where id=$1", [sharedId])).rows.length, 1);
    await as(otherTeacher);
    assert.equal((await db.query("select * from grade_record_history where id=$1", [sharedId])).rows.length, 1, "co-teachers can read their archived course");
    await db.exec("reset role; set role anon");
    await assert.rejects(() => db.query("select * from grade_record_history"), /permission denied/);

    // Direct uploads must accept large files while validating actual Storage metadata.
    await db.exec("reset role; alter table storage.objects add column metadata jsonb;");
    await db.exec(readFileSync("tests/fixtures/migration-history/019_direct_assignment_uploads.sql", "utf8"));
    assert.equal((await db.query<{ file_size_limit: number | null }>(
      "select file_size_limit from storage.buckets where id='assignment-files'",
    )).rows[0].file_size_limit, null);
    await as(academic);
    await importRows([{ ...input, course_code: "UPLOAD-TEST", teacher_name: [input.teacher_name] }]);
    const uploadId = (await db.query<{ id: string }>(
      "select id from grade_records where course_code='UPLOAD-TEST'",
    )).rows[0].id;
    await as(student);
    await db.query("select advance_grade($1,'pending')", [uploadId]);
    const largePath = `${uploadId}/00000000-0000-4000-8000-000000000098.png`;
    const largeSize = Math.ceil(6.6 * 1024 * 1024);
    const largeFile = { storage_path: largePath, original_name: "phone.png", mime_type: "image/png", size_bytes: largeSize };
    const assignUpload = (files: unknown[], expected = "requested") => db.query(
      "select assign_grade($1,$2,now()+interval '1 day',$3::jsonb,$4::grade_status)",
      [uploadId, "Complete the uploaded worksheet", JSON.stringify(files), expected],
    );
    await assert.rejects(() => assignUpload([]), /ไม่มีสิทธิ์/);
    await as(otherTeacher);
    await assert.rejects(() => assignUpload([]), /ไม่มีสิทธิ์/);
    await as(teacher);
    await assert.rejects(() => assignUpload([largeFile]), /ไม่พบไฟล์/);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('assignment-files',$1,$2::jsonb)",
      [largePath, JSON.stringify({ size: largeSize, mimetype: "image/png" })]);
    await assert.rejects(() => assignUpload([{ ...largeFile, size_bytes: 1024 }]), /ไม่พบไฟล์/);
    await assert.rejects(() => assignUpload([{ ...largeFile, mime_type: "application/pdf" }]), /ไม่พบไฟล์/);
    await assert.rejects(() => assignUpload([largeFile], "submitted"), /ข้อมูลเปลี่ยนแปลง/);
    await assignUpload([largeFile]);
    assert.equal((await db.query<{ size_bytes: number }>(
      "select size_bytes from assignment_files where storage_path=$1", [largePath],
    )).rows[0].size_bytes, largeSize);
    const extraFiles = [];
    for (let index = 0; index < 6; index++) {
      const storage_path = `${uploadId}/00000000-0000-4000-8000-00000000008${index}.pdf`;
      const size_bytes = index === 0 ? 3 * 1024 ** 3 : 1024;
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('assignment-files',$1,$2::jsonb)",
        [storage_path, JSON.stringify({ size: size_bytes, mimetype: "application/pdf" })]);
      extraFiles.push({ storage_path, original_name: `${index}.pdf`, mime_type: "application/pdf", size_bytes });
    }
    await assignUpload(extraFiles, "assigned");
    assert.equal((await db.query("select * from assignment_files where record_id=$1", [uploadId])).rows.length, 7);
    await db.query("delete from storage.objects where name=$1", [largePath]);
    assert.equal((await db.query("select * from storage.objects where name=$1", [largePath])).rows.length, 1,
      "cleanup cannot delete a file already linked to a task");
    await assignUpload([], "assigned");

    // Date-only schedules normalize legacy hours and preserve inclusive closing days.
    await db.exec("reset role");
    const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Bangkok')::date::text as today")).rows[0].today;
    await db.query("update grade_records set status='completed',final_grade='1',completed_at=now() where id=$1", [uploadId]);
    await db.exec("alter table site_schedule disable trigger archive_on_schedule_change");
    await db.query("update site_schedule set opens_at=$1::timestamptz,closes_at=$2::timestamptz", [`${today}T01:00:00+07:00`, `${today}T02:00:00+07:00`]);
    await db.exec("alter table site_schedule enable trigger archive_on_schedule_change");
    await db.exec(readFileSync("tests/fixtures/migration-history/020_date_only_schedule.sql", "utf8"));
    assert.equal((await db.query("select id from grade_records where id=$1", [uploadId])).rows.length, 1,
      "conversion must not archive against the old partial-day deadline");
    await as(academic);
    await db.query("select update_schedule($1,$2,'same day')", [`${today}T09:00:00+07:00`, `${today}T10:00:00+07:00`]);
    assert.equal((await db.query<{ open: boolean }>("select site_is_open() as open")).rows[0].open, true);
    const bounds = (await db.query<{ opens_at: Date; closes_at: Date }>("select opens_at,closes_at from site_schedule")).rows[0];
    assert.equal(new Date(bounds.opens_at).getTime(), Date.parse(`${today}T00:00:00+07:00`));
    assert.equal(new Date(bounds.closes_at).getTime(), Date.parse(`${today}T00:00:00+07:00`) + 86400000);
    await db.query("select update_schedule($1,$2,'repeat save')", [bounds.opens_at, bounds.closes_at]);
    assert.deepEqual((await db.query("select opens_at,closes_at from site_schedule")).rows[0], bounds);
    await db.exec("reset role");
    assert.equal((await db.query<{ count: number }>("select archive_completed_grade_records() as count")).rows[0].count, 0);
    await as(teacher);
    await assert.rejects(() => db.query("select update_schedule($1,$2,'forbidden')", [bounds.opens_at, bounds.closes_at]), /ไม่มีสิทธิ์/);
    await as(academic);
    await assert.rejects(() => db.query("select update_schedule($1,$2,'backwards')", [bounds.closes_at, bounds.opens_at]), /ช่วงวันที่/);

    // Period rollover: reset every unfinished state and preserve earlier attempts.
    const unfinishedStates = ["pending", "requested", "assigned", "submitted", "teacher_approved"];
    for (const state of unfinishedStates) {
      await importRows([{ ...input, course_code: `RESET-${state}`, teacher_name: [input.teacher_name] }]);
    }
    await db.exec("reset role");
    const resetRecords = (await db.query<{ id: string; course_code: string }>(
      "select id,course_code from grade_records where course_code like 'RESET-%' order by course_code",
    )).rows;
    for (const record of resetRecords) {
      await db.query("update grade_records set status=$2::grade_status,assignment='Previous period worksheet',due_at=now()+interval '1 day',requested_at=now(),assigned_at=now(),submitted_at=now(),teacher_approved_at=now(),final_grade='1' where id=$1",
        [record.id, record.course_code.slice(6)]);
    }
    const resetId = resetRecords.find((record) => record.course_code === "RESET-assigned")!.id;
    const oldTask = (await db.query<{ id: string }>("insert into grade_assignments(record_id,round_number,assignment,due_at) values($1,1,'Previous period worksheet',now()+interval '1 day') returning id", [resetId])).rows[0].id;
    const oldPath = `${resetId}/00000000-0000-4000-8000-000000000079.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('assignment-files',$1,'{\"size\":1024,\"mimetype\":\"application/pdf\"}')", [oldPath]);
    await db.query("insert into assignment_files(record_id,assignment_id,storage_path,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,$3,'old.pdf','application/pdf',1024,$4)", [resetId, oldTask, oldPath, teacher]);
    const beforeReset = (await db.query<Record<string, unknown>>("select * from grade_records where id=any($1::uuid[]) order by id", [resetRecords.map((record) => record.id)])).rows;
    await db.exec(readFileSync("tests/fixtures/migration-history/021_reset_unfinished_on_close.sql", "utf8"));
    assert.equal((await db.query("select * from school_period_closures")).rows.length, 0, "do not reset before the closing date");
    const firstClose = new Date(Date.parse(`${today}T00:00:00+07:00`) - 2 * 86400000).toISOString();
    async function expireWithoutTrigger(close: string) {
      await db.exec("reset role; alter table site_schedule disable trigger archive_on_schedule_change");
      await db.query("update site_schedule set opens_at=$1::timestamptz-interval '1 day',closes_at=$1::timestamptz", [close]);
      await db.exec("alter table site_schedule enable trigger archive_on_schedule_change");
    }
    await expireWithoutTrigger(firstClose);
    await db.exec("create function fail_reset_test() returns trigger language plpgsql as $$ begin if new.action='reset_at_period_close' then raise exception 'test reset rollback'; end if; return new; end $$; create trigger fail_reset_test before insert on audit_log for each row execute function fail_reset_test();");
    await assert.rejects(() => db.query("select archive_completed_grade_records()"), /test reset rollback/);
    assert.equal((await db.query("select * from school_period_closures")).rows.length, 0);
    assert.equal((await db.query("select * from grade_assignments where id=$1 and record_id=$2", [oldTask, resetId])).rows.length, 1);
    assert.equal((await db.query("select * from grade_records where id=$1", [uploadId])).rows.length, 1, "archive also rolls back with reset failure");
    await db.exec("drop trigger fail_reset_test on audit_log; drop function fail_reset_test();");
    await db.query("select archive_completed_grade_records()");
    const afterReset = (await db.query<Record<string, unknown>>("select * from grade_records where id=any($1::uuid[]) order by id", [resetRecords.map((record) => record.id)])).rows;
    for (const [index, record] of afterReset.entries()) {
      const expected: Record<string, unknown> = { ...beforeReset[index], status: "pending" };
      for (const field of ["assignment", "due_at", "requested_at", "assigned_at", "submitted_at", "teacher_approved_at", "completed_at", "final_grade"]) expected[field] = null;
      assert.deepEqual(record, expected);
    }
    assert.equal((await db.query("select * from grade_record_history where id=$1", [uploadId])).rows.length, 1);
    const snapshot = (await db.query<{ id: string; record_snapshot: Record<string, unknown> }>("select * from grade_reset_history where record_id=$1", [resetId])).rows[0];
    assert.equal(snapshot.record_snapshot.status, "assigned");
    assert.equal((await db.query("select * from grade_assignments where record_id=$1", [resetId])).rows.length, 0);
    assert.equal((await db.query("select * from assignment_files where record_id=$1", [resetId])).rows.length, 0);
    assert.equal((await db.query("select * from assignment_files where reset_history_id=$1", [snapshot.id])).rows.length, 1);
    const resetCount = (await db.query("select * from grade_reset_history")).rows.length;
    await db.query("select archive_completed_grade_records()");
    assert.equal((await db.query("select * from grade_reset_history")).rows.length, resetCount, "cron is idempotent");
    for (const actor of [student, teacher, academic]) {
      await as(actor);
      assert.equal((await db.query("select * from grade_reset_history where id=$1", [snapshot.id])).rows.length, 1);
      assert.equal((await db.query("select * from storage.objects where name=$1", [oldPath])).rows.length, 1);
      await assert.rejects(() => db.query("select archive_completed_grade_records()"), /permission denied/);
      await assert.rejects(() => db.query("delete from grade_reset_history"), /permission denied/);
    }
    await as(other);
    assert.equal((await db.query("select * from grade_reset_history where id=$1", [snapshot.id])).rows.length, 0);
    assert.equal((await db.query("select * from assignment_files where reset_history_id=$1", [snapshot.id])).rows.length, 0);
    assert.equal((await db.query("select * from storage.objects where name=$1", [oldPath])).rows.length, 0);
    await as(academic);
    await db.query("select update_schedule($1,$2,'next period')", [bounds.opens_at, bounds.closes_at]);
    await as(student);
    await db.query("select advance_grade($1,'pending')", [resetId]);
    await as(teacher);
    await db.query("select assign_grade($1,'New period worksheet',now()+interval '1 day','[]','requested')", [resetId]);
    assert.equal((await db.query<{ round_number: number }>("select round_number from grade_assignments where record_id=$1", [resetId])).rows[0].round_number, 1);
    await db.query("delete from storage.objects where name=$1", [oldPath]);
    assert.equal((await db.query("select * from storage.objects where name=$1", [oldPath])).rows.length, 1, "retained old files cannot be removed as orphan uploads");
    await db.exec("reset role");
    await db.query("select archive_completed_before_close($1)", [firstClose]);
    assert.equal((await db.query<{ status: string }>("select status from grade_records where id=$1", [resetId])).rows[0].status, "assigned", "a processed deadline cannot reset new-period progress");
    const secondClose = new Date(Date.parse(firstClose) + 86400000).toISOString();
    await expireWithoutTrigger(secondClose);
    await as(academic);
    await db.query("select update_schedule($1,$2,'reopen before cron')", [bounds.opens_at, bounds.closes_at]);
    assert.equal((await db.query<{ status: string }>("select status from grade_records where id=$1", [resetId])).rows[0].status, "pending");
    assert.equal((await db.query("select * from grade_reset_history where record_id=$1", [resetId])).rows.length, 2, "a second period resets even with no completed records");
    await db.exec("reset role");
    await db.query("update grade_records set status='completed',final_grade='1',completed_at=now() where id=$1", [resetId]);
    await expireWithoutTrigger(new Date(Date.parse(secondClose) + 86400000).toISOString());
    await db.query("select archive_completed_grade_records()");
    assert.equal((await db.query("select * from grade_record_history where id=$1", [resetId])).rows.length, 1,
      "retained failed attempts must not block a later successful archive");
    assert.equal((await db.query("select * from grade_assignments where reset_history_id=$1", [snapshot.id])).rows.length, 1);
    assert.equal((await db.query("select * from assignment_files where reset_history_id=$1", [snapshot.id])).rows.length, 1);

    // Teachers may correct approved grades during the open period, with an
    // immutable history. Archived records can never be corrected.
    await db.exec(readFileSync("tests/fixtures/migration-history/022_grade_corrections.sql", "utf8"));
    await db.exec(readFileSync("tests/fixtures/migration-history/023_allow_all_new_grades.sql", "utf8"));
    await as(academic);
    await db.query("select update_schedule($1,$2,'open for corrections')", [bounds.opens_at, bounds.closes_at]);
    const approvedId = resetRecords.find((record) => record.course_code === "RESET-teacher_approved")!.id;
    const completedId = resetRecords.find((record) => record.course_code === "RESET-submitted")!.id;
    const firstApprovalId = resetRecords.find((record) => record.course_code === "RESET-pending")!.id;
    await db.exec("reset role");
    await db.query("update grade_records set status='teacher_approved',final_grade='1',teacher_approved_at=now() where id=$1", [approvedId]);
    await db.query("update grade_records set status='completed',final_grade='2',teacher_approved_at=now(),completed_at=now() where id=$1", [completedId]);
    await db.query("update grade_records set status='submitted',submitted_at=now() where id=$1", [firstApprovalId]);
    const correct = (recordId: string, expected: string, next: string) => db.query<{ result: {
      record_id: string; previous_grade: string; new_grade: string; changed_by: string;
    } }>("select correct_final_grade($1,$2,$3) as result", [recordId, expected, next]);
    await as(student);
    await assert.rejects(() => correct(approvedId, "1", "3"), /ไม่มีสิทธิ์/);
    await as(academic);
    await assert.rejects(() => correct(completedId, "2", "3"), /ไม่มีสิทธิ์/);
    await as(otherTeacher);
    await assert.rejects(() => correct(approvedId, "1", "3"), /ไม่มีสิทธิ์/);
    await as(teacher);
    await assert.rejects(() => correct(uploadId, "1", "3"), /เข้าประวัติแล้ว/);
    await db.query("select advance_grade($1,'submitted',null,null,'0')", [firstApprovalId]);
    assert.deepEqual((await db.query<{ status: string; final_grade: string }>(
      "select status,final_grade from grade_records where id=$1", [firstApprovalId],
    )).rows[0], { status: "teacher_approved", final_grade: "0" });
    await correct(firstApprovalId, "0", "ร");
    await correct(firstApprovalId, "ร", "มผ");
    await assert.rejects(() => correct(approvedId, "1", "มส"), /ถูกต้อง/);
    await assert.rejects(() => correct(approvedId, "1", "1"), /ต่างจากเดิม/);
    const firstCorrection = (await correct(approvedId, "1", "3")).rows[0].result;
    assert.deepEqual([firstCorrection.record_id, firstCorrection.previous_grade, firstCorrection.new_grade, firstCorrection.changed_by],
      [approvedId, "1", "3", teacher]);
    await assert.rejects(() => correct(approvedId, "1", "4"), /เปลี่ยนแปลงแล้ว/);
    await correct(approvedId, "3", "4");
    await correct(completedId, "2", "0");
    assert.deepEqual((await db.query<{ status: string; final_grade: string }>(
      "select status,final_grade from grade_records where id=$1", [completedId],
    )).rows[0], { status: "completed", final_grade: "0" });
    assert.deepEqual((await db.query<{ previous_grade: string; new_grade: string }>(
      "select previous_grade,new_grade from grade_corrections where record_id=$1 order by changed_at,id", [firstApprovalId],
    )).rows.map(({ previous_grade, new_grade }) => [previous_grade, new_grade]), [["0", "ร"], ["ร", "มผ"]]);
    assert.deepEqual((await db.query<{ previous_grade: string; new_grade: string }>(
      "select previous_grade,new_grade from grade_corrections where record_id=$1 order by changed_at,id", [approvedId],
    )).rows.map(({ previous_grade, new_grade }) => [previous_grade, new_grade]), [["1", "3"], ["3", "4"]]);
    await assert.rejects(() => db.query("insert into grade_corrections(record_id) values($1)", [approvedId]), /permission denied/);
    await assert.rejects(() => db.query("delete from grade_corrections"), /permission denied/);
    await as(otherTeacher);
    assert.equal((await db.query("select * from grade_corrections where record_id=$1", [approvedId])).rows.length, 0);
    await as(student);
    assert.equal((await db.query("select * from grade_corrections where record_id=$1", [approvedId])).rows.length, 2);
    await db.exec("reset role");
    await expireWithoutTrigger(new Date(Date.parse(secondClose) + 1000).toISOString());
    await as(teacher);
    await assert.rejects(() => correct(approvedId, "4", "3"), /ระบบปิด/);
    await db.exec("reset role");
    await db.query("select archive_completed_grade_records()");
    assert.equal((await db.query<{ final_grade: string }>("select final_grade from grade_record_history where id=$1", [completedId])).rows[0].final_grade, "0");
    await as(teacher);
    assert.equal((await db.query("select * from grade_corrections where record_id=$1", [completedId])).rows.length, 1,
      "correction history remains readable after archiving");
    await assert.rejects(() => correct(completedId, "0", "4"), /ระบบปิด/);

    // Admin owns import and schedule operations; the other roles keep their
    // existing record permissions and cannot invoke either operation.
    await db.exec("reset role");
    await db.exec(readFileSync("tests/fixtures/migration-history/024_admin_role.sql", "utf8"));
    await db.exec(readFileSync("tests/fixtures/migration-history/025_admin_operations.sql", "utf8"));
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query("insert into profiles(id,role,full_name) values($1,'admin','ผู้ดูแลระบบ')", [admin]);
    assert.deepEqual((await db.query<{ role: string }>(
      "select unnest(enum_range(null::public.app_role))::text as role",
    )).rows.map((row) => row.role), ["student", "teacher", "academic", "manager", "admin"]);
    await as(academic);
    await assert.rejects(() => importRows([{ ...input, course_code: "ADMIN-ONLY", teacher_name: [input.teacher_name] }]), /ไม่มีสิทธิ์/);
    await assert.rejects(() => db.query("select update_schedule(now()-interval '1 hour',now()+interval '1 day','forbidden')"), /ไม่มีสิทธิ์/);
    await as(manager);
    await assert.rejects(() => importRows([{ ...input, course_code: "ADMIN-ONLY", teacher_name: [input.teacher_name] }]), /ไม่มีสิทธิ์/);
    await assert.rejects(() => db.query("select update_schedule(now()-interval '1 hour',now()+interval '1 day','forbidden')"), /ไม่มีสิทธิ์/);
    await as(admin);
    assert.equal((await db.query<{ role: string }>("select my_role()::text as role")).rows[0].role, "admin");
    assert.equal((await db.query("select * from site_schedule")).rows.length, 1);
    await db.query("select update_schedule(now()-interval '1 hour',now()+interval '1 day','admin period')");
    const adminImport = await importRows([{ ...input, course_code: "ADMIN-ONLY", teacher_name: [input.teacher_name] }]);
    assert.deepEqual(adminImport.rows[0].result, { inserted: 1, skipped: 0 });
    assert.equal((await db.query("select * from grade_records")).rows.length, 0,
      "admin cannot read academic records through the regular table");
    await assert.rejects(() => db.query("select manager_dashboard_stats()"), /ไม่มีสิทธิ์/);
    await as(academic);
    const adminOnlyRows = (await db.query<{ id: string }>(
      "select id from grade_records where course_code='ADMIN-ONLY'",
    )).rows;
    assert.equal(adminOnlyRows.length, 1);
    await as(admin);
    await assert.rejects(() => db.query("select advance_grade($1,'pending')", [adminOnlyRows[0].id]), /ไม่มีสิทธิ์/);
  } finally {
    await db.close();
  }
});
