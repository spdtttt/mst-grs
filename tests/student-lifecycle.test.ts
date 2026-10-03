import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import {
  lifecycleChangeSchema,
  type LifecycleList,
  type LifecycleChangeResult,
} from "../src/lib/student-lifecycle";

const id = (n: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("graduation classifies all unfinished statuses as not graduated and allows graduation after completion", async () => {
  const db = await loadTestDatabase();
  const change = async (
    students: { id: string; revision: number }[],
    status = "graduated",
  ) =>
    (
      await db.query<{ result: LifecycleChangeResult }>(
        "select admin_set_student_status($1,$2,2569) result",
        [JSON.stringify(students), status],
      )
    ).rows[0].result;
  const asAdmin = async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1),
    ]);
    await db.exec("set role authenticated");
  };
  try {
    for (let n = 1; n <= 9; n++) {
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code) values($1,$2,$3,$4)",
        [
          id(n),
          n === 1 ? "admin" : n === 2 ? "teacher" : "student",
          `Student ${n}`,
          n >= 3 ? String(10000 + n) : null,
        ],
      );
    }
    const statuses = [
      "pending",
      "requested",
      "assigned",
      "submitted",
      "teacher_approved",
      "completed",
    ];
    for (let i = 0; i < statuses.length; i++) {
      await db.query(
        `insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id,status,final_grade,completed_at)
        values($1,'C1','Course',1,'ม.6/1',ARRAY['Teacher'],$2,$3,1,$4,2,'0',$5,ARRAY[$6]::uuid[],$7,$8,$9)`,
        [
          id(200 + i),
          String(10003 + i),
          `Student ${i + 3}`,
          i === 0 ? 2567 : 2569,
          id(i + 3),
          id(2),
          statuses[i],
          i >= 4 ? "1" : null,
          i === 5 ? new Date().toISOString() : null,
        ],
      );
    }
    // Completed historical grades must remain available and must not block graduation.
    await db.exec(
      "insert into grade_record_history select g.*,now(),now() from grade_records g where status='completed'",
    );
    await asAdmin();
    const result = await change(
      Array.from({ length: 7 }, (_, i) => ({ id: id(i + 3), revision: 0 })),
    );
    assert.equal(result.updated, 7);
    assert.equal(result.graduated, 2); // One completed student and one with no outstanding records.
    assert.deepEqual(
      result.notGraduated.map((row) => row.id),
      [3, 4, 5, 6, 7].map(id),
    );
    assert.ok(result.notGraduated.every((row) => row.outstanding_count === 1));
    const list = (
      await db.query<{ data: LifecycleList }>(
        "select admin_student_lifecycle_list('', 'not_graduated') data",
      )
    ).rows[0].data;
    assert.equal(list.total, 5);
    assert.equal(list.counts.not_graduated, 5);
    assert.ok(list.items.every((row) => row.student_status_year === 2569));
    const current = (
      await db.query<{
        data: { total: number; items: unknown[]; levels: number[] };
      }>("select admin_student_list() data")
    ).rows[0].data;
    assert.deepEqual(current, { total: 0, items: [], levels: [], classrooms: [] });
    assert.equal(
      (
        await db.query<{ data: { total: number } }>(
          "select admin_student_list('10003') data",
        )
      ).rows[0].data.total,
      0,
    );
    assert.deepEqual(
      (
        await db.query<{
          data: { created: number; updated: number; archived: number };
        }>("select admin_student_import_summary(ARRAY['10003','10008']) data")
      ).rows[0].data,
      { created: 0, updated: 2, archived: 2 },
    );
    // Repeating the same outcome does not add revisions or audit entries.
    const repeated = await change([{ id: id(3), revision: 1 }]);
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.notGraduated.length, 1);
    await db.exec("reset role");
    assert.equal((await db.query("select id from auth.users")).rows.length, 9);
    assert.equal(
      (await db.query("select id from grade_records")).rows.length,
      6,
    );
    assert.equal(
      (await db.query("select id from grade_record_history")).rows.length,
      1,
    );
    const audit = (
      await db.query<{ action: string }>(
        "select action from audit_log where action like 'student_status_changed:%'",
      )
    ).rows;
    assert.equal(audit.length, 7);
    assert.equal(
      audit.filter(
        (row) =>
          JSON.parse(row.action.slice("student_status_changed:".length)).to ===
          "not_graduated",
      ).length,
      5,
    );
    await db.query(
      "update grade_records set status='completed',final_grade='1',completed_at=now() where student_id=$1",
      [id(3)],
    );
    await asAdmin();
    assert.deepEqual(await change([{ id: id(3), revision: 1 }]), {
      updated: 1,
      graduated: 1,
      notGraduated: [],
    });
    // Transfers remain explicitly controlled by Admin even if work remains.
    assert.deepEqual(
      await change([{ id: id(4), revision: 1 }], "transferred"),
      { updated: 1, graduated: 0, notGraduated: [] },
    );
    await db.query("select admin_set_student_status($1,'active',null)", [
      JSON.stringify([{ id: id(5), revision: 1 }]),
    ]);
    const restored = (
      await db.query<{ data: { total: number; items: { id: string }[] } }>(
        "select admin_student_list() data",
      )
    ).rows[0].data;
    assert.equal(restored.total, 1);
    assert.deepEqual(
      restored.items.map((row) => row.id),
      [id(5)],
    );
    await assert.rejects(
      () =>
        db.query("select admin_change_student_status('[]','graduated',2569)"),
      /does not exist/,
    );
  } finally {
    await db.close();
  }
});

test("year rollover archives/restores students, retains Auth and grades, and preserves status on reimport", async () => {
  const db = await loadTestDatabase();
  const as = async (n: number) => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{}',false)",
      [id(n)],
    );
    await db.exec("set role authenticated");
  };
  const change = (
    students: { id: string; revision: number }[],
    status: string,
    year: number | null,
  ) =>
    db.query<{ count: number }>(
      "select admin_set_student_status($1,$2,$3) count",
      [JSON.stringify(students), status, year],
    );
  const list = async (
    status = "active",
    page = 1,
    size = 50,
    level: number | null = null,
    room: string | null = null,
    search = "",
  ) =>
    (
      await db.query<{ data: LifecycleList }>(
        "select admin_student_lifecycle_list($1,$2,$3,$4,$5,$6) data",
        [search, status, level, room, page, size],
      )
    ).rows[0].data;
  try {
    await db.exec(
      "update site_schedule set opens_at=now()-interval '1 day',closes_at=now()+interval '1 day' where id=1",
    );
    for (let n = 1; n <= 56; n++) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id(n),
        `user${n}@example.test`,
      ]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code,classroom,roll_number) values($1,$2,$3,$4,$5,$6)",
        [
          id(n),
          n === 1 ? "admin" : n === 2 ? "teacher" : "student",
          `Student ${n}`,
          n > 2 ? String(10000 + n) : null,
          n > 2 ? "ม.6/1" : null,
          n > 2 ? n : null,
        ],
      );
    }
    await db.query("insert into auth.sessions values($1,$2)", [id(100), id(3)]);
    await db.query(
      `insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id)
      values($1,'C1','Course',1,'ม.6/1',ARRAY['Teacher'],'10003','Student 3',3,2569,1,'0',$2,ARRAY[$3]::uuid[])`,
      [id(200), id(3), id(2)],
    );
    await db.exec(
      "update grade_records set status='completed',final_grade='1',completed_at=now()",
    );
    for (const actor of [2, 3]) {
      await as(actor);
      await assert.rejects(() => list(), /STUDENT_LIFECYCLE_FORBIDDEN/);
      await assert.rejects(
        () => change([{ id: id(3), revision: 0 }], "graduated", 2569),
        /STUDENT_LIFECYCLE_FORBIDDEN/,
      );
      await assert.rejects(
        () => db.query("select admin_student_import_summary(ARRAY['10003'])"),
        /STUDENT_LIFECYCLE_FORBIDDEN/,
      );
    }
    await db.exec("reset role;set role anon");
    await assert.rejects(() => list(), /permission denied/);
    await as(1);
    assert.equal((await list()).items.length, 50);
    assert.equal((await list("active", 2)).items.length, 4);
    assert.equal((await list("active", 1, 2000)).items.length, 54);
    assert.equal((await list("all", 1, 50, 5)).total, 0);
    assert.equal((await list("all", 1, 50, 6, "ม.6/1", "10003")).total, 1);
    assert.deepEqual(Object.keys((await list()).items[0]).sort(), [
      "account_revision",
      "classroom",
      "full_name",
      "id",
      "roll_number",
      "student_code",
      "student_status",
      "student_status_year",
    ]);
    await assert.rejects(
      () => change([{ id: id(3), revision: 0 }], "graduated", null),
      /STUDENT_LIFECYCLE_INVALID/,
    );
    await assert.rejects(
      () =>
        change(
          [
            { id: id(3), revision: 0 },
            { id: id(3), revision: 0 },
          ],
          "graduated",
          2569,
        ),
      /STUDENT_LIFECYCLE_INVALID/,
    );
    await change(
      [
        { id: id(3), revision: 0 },
        { id: id(4), revision: 0 },
      ],
      "graduated",
      2569,
    );
    assert.equal((await list()).total, 52);
    assert.equal((await list("graduated")).total, 2);
    assert.deepEqual((await list()).counts, {
      active: 52,
      graduated: 2,
      transferred: 0,
      not_graduated: 0,
    });
    const main = (
      await db.query<{ data: { total: number; items: { id: string }[] } }>(
        "select admin_student_list() data",
      )
    ).rows[0].data;
    assert.equal(main.total, 52);
    assert.equal(
      main.items.some((row) => row.id === id(3)),
      false,
    );
    const summary = (
      await db.query<{
        data: { created: number; updated: number; archived: number };
      }>(
        "select admin_student_import_summary(ARRAY['10003','10005','99999']) data",
      )
    ).rows[0].data;
    assert.deepEqual(summary, { created: 1, updated: 2, archived: 1 });
    await db.query("select admin_save_student($1,$2)", [
      id(3),
      JSON.stringify({
        student_code: "10003",
        name_prefix: "นาย",
        first_name: "ใหม่",
        last_name: "ทดสอบ",
        classroom: "ม.6/2",
        roll_number: 1,
      }),
    ]);
    assert.equal(
      (await list("graduated", 1, 50, null, null, "10003")).items[0]
        .student_status_year,
      2569,
    );
    await change([{ id: id(4), revision: 1 }], "active", null);
    await change([{ id: id(5), revision: 0 }], "transferred", 2569);
    assert.equal((await list("transferred")).total, 1);
    await as(3);
    assert.equal(
      (await db.query<{ role: string }>("select my_role() role")).rows[0].role,
      "student",
    );
    assert.equal(
      (await db.query("select id from grade_records")).rows.length,
      1,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from auth.sessions where user_id=$1", [id(3)]))
        .rows.length,
      1,
    );
    assert.equal((await db.query("select id from auth.users")).rows.length, 56);
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select student_name name from grade_records",
        )
      ).rows[0].name,
      "Student 3",
    );
    assert.equal(
      (
        await db.query(
          "select * from audit_log where action like 'student_status_changed:%'",
        )
      ).rows.length,
      4,
    );
  } finally {
    await db.close();
  }
});

test("stale, missing and nonstudent selections roll back the entire batch including audit", async () => {
  const db = await loadTestDatabase();
  try {
    for (const [n, role] of [
      [1, "admin"],
      [2, "student"],
      [3, "student"],
      [4, "teacher"],
    ] as const) {
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code) values($1,$2,$3,$4)",
        [
          id(n),
          role,
          `Person ${n}`,
          role === "student" ? String(10000 + n) : null,
        ],
      );
    }
    await db.query("update profiles set full_name='Changed' where id=$1", [
      id(3),
    ]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1),
    ]);
    for (const n of [3, 4, 99]) {
      await db.exec("set role authenticated");
      await assert.rejects(
        () =>
          db.query("select admin_set_student_status($1,'graduated',2569)", [
            JSON.stringify([
              { id: id(2), revision: 0 },
              { id: id(n), revision: 0 },
            ]),
          ]),
        /STUDENT_LIFECYCLE_CHANGED/,
      );
      await db.exec("reset role");
      assert.deepEqual(
        (
          await db.query<{ student_status: string; account_revision: number }>(
            "select student_status,account_revision from profiles where id=$1",
            [id(2)],
          )
        ).rows[0],
        { student_status: "active", account_revision: 0 },
      );
      assert.equal(
        (
          await db.query(
            "select * from audit_log where action like 'student_status_changed:%'",
          )
        ).rows.length,
        0,
      );
    }
    assert.equal(
      lifecycleChangeSchema.safeParse({
        students: [{ id: id(2), revision: 0 }],
        status: "active",
        year: 2569,
      }).success,
      false,
    );
    assert.equal(
      lifecycleChangeSchema.safeParse({
        students: [{ id: id(2), revision: 0 }],
        status: "graduated",
        year: 2026,
      }).success,
      false,
    );
  } finally {
    await db.close();
  }
});
