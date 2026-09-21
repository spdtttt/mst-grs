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
    await db.exec(readFileSync("supabase/migrations/001_initial.sql", "utf8"));
    await db.exec(
      readFileSync(
        "supabase/migrations/002_assignment_attachments.sql",
        "utf8",
      ),
    );
    await db.exec(readFileSync("supabase/migrations/003_web_push.sql", "utf8"));
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
      readFileSync("supabase/migrations/004_academic_schedule.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/005_manager_role.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/006_manager_dashboard_stats.sql",
        "utf8",
      ),
    );
    await db.query("insert into auth.users values($1)", [manager]);
    await db.exec(
      readFileSync(
        "supabase/migrations/007_manager_student_counts.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/008_manager_outstanding_statuses.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync("supabase/migrations/009_manager_student_lists.sql", "utf8"),
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
      db.query("select public.import_grades($1::jsonb) result", [
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
        db.query("select assign_grade($1,$2,$3,$4::jsonb)", [
          id,
          "short",
          new Date(Date.now() + 86400000).toISOString(),
          "[]",
        ]),
      /กรุณากรอก/,
    );
    await db.query("select assign_grade($1,$2,$3,$4::jsonb)", [
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
    ]);
    assert.equal(
      (await db.query("select * from assignment_files")).rows.length,
      1,
    );
    await move("assigned");
    await assert.rejects(() => move("submitted"), /ระบุผลการเรียน/);
    await move("submitted", null, null, "1");
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
      4,
    );
    assert.equal(
      (await db.query("select * from audit_log where action='assign:1'")).rows
        .length,
      1,
    );
    await importRows([
      { ...input, course_code: "ว31101", course_name: "วิทยาศาสตร์" },
      {
        ...input,
        course_code: "อ32101",
        course_name: "ภาษาอังกฤษ",
        classroom: "ม.5/1",
        student_code: "002",
        student_name: "นักเรียน สอง",
      },
    ]);
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
  } finally {
    await db.close();
  }
});
