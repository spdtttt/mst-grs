import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import type { TeacherList } from "../src/lib/teachers";
import { TEACHER_SUBJECT_GROUPS } from "../src/lib/teachers";

test("teacher subject filter counts before pagination, combines search, includes unregistered and shared-role teachers, and enforces Admin", async () => {
  const db = await loadTestDatabase();
  const id = (n: number) =>
    `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const list = async (group = "", search = "", page = 1) =>
    (
      await db.query<{ result: TeacherList }>(
        "select admin_teacher_registry_list($1,$2,$3) result",
        [search, page, group],
      )
    ).rows[0].result;
  try {
    await db.query("insert into auth.users(id) values($1)", [id(1)]);
    await db.query(
      "insert into profiles(id,role,full_name) values($1,'admin','Admin')",
      [id(1)],
    );
    for (let n = 2; n <= 64; n++) {
      await db.query(
        "insert into profiles(id,role,full_name,learning_subject_group) values($1,'teacher',$2,$3)",
        [
          id(n),
          `Teacher ${String(n).padStart(2, "0")}`,
          n <= 53
            ? TEACHER_SUBJECT_GROUPS[1]
            : n <= 62
              ? TEACHER_SUBJECT_GROUPS[n - 54]
              : null,
        ],
      );
    }
    await db.query(
      "select set_staff_roles($1,ARRAY['teacher','academic']::app_role[])",
      [id(53)],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1),
    ]);
    await db.exec("set role authenticated");
    assert.equal((await list()).total, 63);
    const first = await list(TEACHER_SUBJECT_GROUPS[1]);
    const second = await list(TEACHER_SUBJECT_GROUPS[1], "", 2);
    assert.equal(first.total, 53);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 3);
    assert.ok(
      [...first.items, ...second.items].every(
        (row) =>
          row.learning_subject_group === TEACHER_SUBJECT_GROUPS[1] &&
          row.has_auth === false,
      ),
    );
    assert.ok(second.items.some((row) => row.id === id(53)));
    assert.equal(
      (await list(TEACHER_SUBJECT_GROUPS[1], "Teacher 02")).total,
      1,
    );
    assert.equal(
      (await list(TEACHER_SUBJECT_GROUPS[0], "Teacher 02")).total,
      0,
    );
    for (const group of TEACHER_SUBJECT_GROUPS)
      assert.ok((await list(group)).total > 0);
    assert.equal((await list("", "%_")).total, 0);
    await assert.rejects(() => list("", "", 0), /ACCOUNT_INVALID/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(2),
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(() => list(), /ACCOUNT_FORBIDDEN/);
    await db.exec("reset role; set role anon");
    await assert.rejects(() => list(), /permission denied/);
  } finally {
    await db.close();
  }
});

test("teacher list is Admin-only, includes additional teacher roles, pages and searches without exposing credentials", async () => {
  const db = await loadTestDatabase();
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const as = async (user: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
  };
  const list = async (search = "", page = 1) =>
    (
      await db.query<{ result: TeacherList }>(
        "select public.admin_teacher_list($1,$2) result",
        [search, page],
      )
    ).rows[0].result;
  try {
    for (let n = 1; n <= 56; n++) {
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2,$3)",
        [
          id(n),
          n <= 52
            ? "teacher"
            : n === 53
              ? "admin"
              : n === 54
                ? "academic"
                : n === 55
                  ? "manager"
                  : "academic",
          n <= 52 ? `Teacher ${String(n).padStart(2, "0")}` : `Staff ${n}`,
        ],
      );
    }
    await db.query(
      "select public.set_staff_roles($1,ARRAY['academic','teacher']::public.app_role[])",
      [id(56)],
    );
    await as(id(53));
    const first = await list();
    const second = await list("", 2);
    assert.equal(first.total, 53);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 3);
    assert.equal(
      new Set([...first.items, ...second.items].map((teacher) => teacher.id))
        .size,
      53,
    );
    assert.deepEqual(Object.keys(first.items[0]).sort(), ["full_name", "id"]);
    assert.equal((await list("teacher 01")).items[0].id, id(1));
    assert.equal((await list("Staff 56")).items[0].id, id(56));
    assert.equal((await list("%_")).total, 0);
    assert.equal((await list("not found")).items.length, 0);
    await assert.rejects(() => list("", 0), /ตัวกรอง/);
    await assert.rejects(() => list("x".repeat(151)), /ตัวกรอง/);
    for (const n of [1, 54, 55, 56]) {
      await as(id(n));
      await assert.rejects(() => list(), /เฉพาะผู้ดูแลระบบ/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(() => list(), /permission denied/);
  } finally {
    await db.close();
  }
});

test("historical reset before the registry deleted profile and Auth atomically", async () => {
  const db = await loadTestDatabase({ through: "041" });
  const id = (n: number) =>
    `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const as = async (n: number) => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims','{}',false)",
      [id(n)],
    );
    await db.exec("set role authenticated");
  };
  const reset = (n: number, name = `Account ${n}`) =>
    db.query("select public.admin_reset_teacher($1,$2)", [id(n), name]);
  const count = async (table: string, n: number) =>
    (await db.query(`select id from ${table} where id=$1`, [id(n)])).rows
      .length;
  try {
    for (const [n, role] of [
      [1, "admin"],
      [2, "teacher"],
      [3, "academic"],
      [4, "manager"],
      [5, "teacher"],
    ] as const) {
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2,$3)",
        [id(n), role, `Account ${n}`],
      );
    }
    await db.query(
      "select public.set_staff_roles($1,ARRAY['teacher','academic','admin']::public.app_role[])",
      [id(2)],
    );
    await db.query("insert into auth.sessions values($1,$2)", [id(102), id(2)]);
    await db.query("select public.activate_login_role($1,$2,'teacher')", [
      id(102),
      id(2),
    ]);
    await db.query(
      "insert into audit_log(actor_id,action) values($1,'teacher_registered')",
      [id(2)],
    );

    for (const n of [2, 3, 4, 5]) {
      await as(n);
      await assert.rejects(() => reset(2), /TEACHER_RESET_FORBIDDEN/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(() => reset(2), /permission denied/);
    await as(1);
    await assert.rejects(() => reset(1), /TEACHER_RESET_SELF/);
    await assert.rejects(() => reset(3), /TEACHER_RESET_NOT_TEACHER/);
    await assert.rejects(() => reset(2, "Old name"), /TEACHER_RESET_CHANGED/);

    // Force the second delete to fail after the profile/audit changes.
    await db.exec(
      "reset role; create table auth_delete_blocker(user_id uuid references auth.users(id))",
    );
    await db.query("insert into auth_delete_blocker values($1)", [id(2)]);
    await as(1);
    await assert.rejects(() => reset(2), /foreign key constraint/);
    await db.exec("reset role");
    assert.equal(await count("profiles", 2), 1);
    assert.equal(await count("auth.users", 2), 1);
    const original = (
      await db.query<{ actor_id: string; deleted_actor_id: null }>(
        "select actor_id,deleted_actor_id from audit_log where action='teacher_registered'",
      )
    ).rows[0];
    assert.deepEqual(original, { actor_id: id(2), deleted_actor_id: null });
    assert.equal(
      (
        await db.query("select * from profile_roles where profile_id=$1", [
          id(2),
        ])
      ).rows.length,
      2,
    );
    await db.exec("delete from auth_delete_blocker");

    await as(1);
    await reset(2);
    await reset(2); // Lost success responses can be retried without deleting another account.
    await db.exec("reset role");
    assert.equal(await count("profiles", 2), 0);
    assert.equal(await count("auth.users", 2), 0);
    assert.equal(
      (await db.query("select * from auth.sessions where user_id=$1", [id(2)]))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from login_role_sessions where user_id=$1", [
          id(2),
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from profile_roles where profile_id=$1", [
          id(2),
        ])
      ).rows.length,
      0,
    );
    const retained = (
      await db.query(
        "select actor_id,deleted_actor_id,deleted_actor_name from audit_log where action='teacher_registered'",
      )
    ).rows[0];
    assert.deepEqual(retained, {
      actor_id: null,
      deleted_actor_id: id(2),
      deleted_actor_name: "Account 2",
    });
    assert.equal(
      (
        await db.query("select * from audit_log where action=$1", [
          `teacher_account_reset:${id(2)}`,
        ])
      ).rows.length,
      1,
    );
    assert.equal(await count("profiles", 1), 1);
    assert.equal(await count("profiles", 5), 1);
  } finally {
    await db.close();
  }
});

test("historical reset before the registry rejected referenced teachers", async () => {
  const db = await loadTestDatabase({ through: "041" });
  const admin = "30000000-0000-4000-8000-000000000001";
  const teacher = "30000000-0000-4000-8000-000000000002";
  const student = "30000000-0000-4000-8000-000000000003";
  const grade = "30000000-0000-4000-8000-000000000004";
  const reset = () =>
    db.query("select public.admin_reset_teacher($1,'Teacher')", [teacher]);
  const blocked = async (message: RegExp) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(reset, message);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("select * from auth.users where id=$1", [teacher])).rows
        .length,
      1,
    );
  };
  try {
    await db.query("insert into auth.users(id) values($1),($2),($3)", [
      admin,
      teacher,
      student,
    ]);
    await db.query(
      "insert into profiles(id,role,full_name,student_code) values($1,'admin','Admin',null),($2,'teacher','Teacher',null),($3,'student','Student','10001')",
      [admin, teacher, student],
    );
    await db.query(
      `insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id)
      values($1,'C1','Course',1,'ม.4/1',ARRAY['Teacher'],'10001','Student',1,2569,1,'0',$2,ARRAY[$3]::uuid[])`,
      [grade, student, teacher],
    );
    await blocked(/TEACHER_RESET_REFERENCED/);
    await db.exec(
      "update grade_records set status='completed',final_grade='1',completed_at=now()",
    );
    await db.exec(
      "insert into grade_record_history select g.*,now(),now() from grade_records g; delete from grade_records",
    );
    await blocked(/TEACHER_RESET_REFERENCED/);
    await db.exec("delete from grade_record_history");
    await db.query(
      "insert into grade_reset_history(record_id,student_id,teacher_id,record_snapshot,reset_reason) values($1,$2,ARRAY[$3]::uuid[],'{}','import_overwrite')",
      [grade, student, teacher],
    );
    await blocked(/TEACHER_RESET_REFERENCED/);
    await db.exec("delete from grade_reset_history");
    await db.query(
      "insert into grade_corrections(record_id,student_id,teacher_id,previous_grade,new_grade,changed_by,changed_by_name) values($1,$2,ARRAY[$3]::uuid[],'1','2',$3,'Teacher')",
      [grade, student, teacher],
    );
    await blocked(/TEACHER_RESET_REFERENCED/);
    await db.exec(
      "delete from grade_corrections; alter table storage.objects add column owner_id text, add column owner uuid",
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('assignment-files','owned-file.png',$1)",
      [teacher],
    );
    await blocked(/TEACHER_RESET_STORAGE/);
    await db.query(
      "update storage.objects set owner=owner_id::uuid,owner_id=null",
    );
    await blocked(/TEACHER_RESET_STORAGE/);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
