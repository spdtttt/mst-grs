import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import {
  completeStaffAuthReset,
  RejectedAuthDelete,
  type ResetOperation,
  type StaffAuthResetStore,
} from "../src/lib/staff-auth-reset";
import {
  encryptStaffCitizenId,
  staffCitizenHash,
} from "../src/lib/staff-identity";
import { staffLoginEmails } from "../src/lib/role-login";

const id = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const secret = "test-only-secret-at-least-thirty-two-characters";
type DB = Awaited<ReturnType<typeof loadTestDatabase>>;
async function fixture() {
  const db = await loadTestDatabase();
  for (const [n, role] of [
    [1, "admin"],
    [2, "teacher"],
    [3, "academic"],
    [4, "student"],
    [5, "manager"],
    [6, "academic"],
  ] as const) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id(n),
      `test${n}@example.test`,
    ]);
    await db.query(
      `insert into profiles(id,role,full_name,student_code,name_prefix,first_name,last_name,staff_citizen_hash)
      values($1,$2,$3,$4,'นาย','First','Last',$5)`,
      [
        id(n),
        role,
        `Person ${n}`,
        role === "student" ? "10001" : null,
        [2, 3, 6].includes(n) ? String(n).repeat(64) : null,
      ],
    );
  }
  await db.query(
    "select set_staff_roles($1,ARRAY['teacher','academic']::app_role[])",
    [id(2)],
  );
  await db.query(
    "select set_staff_roles($1,ARRAY['academic','teacher']::app_role[])",
    [id(3)],
  );
  return db;
}
async function as(db: DB, n: number) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{}',false)",
    [id(n)],
  );
  await db.exec("set role authenticated");
}
async function revision(db: DB, n: number) {
  await db.exec("reset role");
  return (
    await db.query<{ value: number }>(
      "select account_revision value from profiles where id=$1",
      [id(n)],
    )
  ).rows[0].value;
}
async function remove(db: DB, n: number, role: string) {
  const rev = await revision(db, n);
  await as(db, 1);
  return db.query("select admin_delete_account($1,$2,$3)", [id(n), role, rev]);
}
async function grade(db: DB) {
  await db.exec("reset role");
  await db.query(
    `insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,
    roll_number,academic_year,semester,original_grade,student_id,teacher_id)
    values($1,'C1','Course',1,'M4/1',ARRAY['Person 2','Person 3'],'10001','Person 4',1,2569,1,'0',$2,ARRAY[$3,$4]::uuid[])`,
    [id(100), id(4), id(2), id(3)],
  );
}
async function begin(db: DB, n: number, role: string) {
  const rev = await revision(db, n);
  await as(db, 1);
  return (
    await db.query<{ result: ResetOperation }>(
      "select admin_begin_staff_auth_reset($1,$2,$3) result",
      [id(n), role, rev],
    )
  ).rows[0].result;
}

test("deletion removes only the chosen role, including primary roles; manager editing preserves username/Auth", async () => {
  const db = await fixture();
  try {
    await db.query(
      "insert into auth.sessions(id,user_id) values($1,$3),($2,$3)",
      [id(200), id(201), id(2)],
    );
    await db.query("select activate_login_role($1,$2,'teacher')", [
      id(200),
      id(2),
    ]);
    await db.query("select activate_login_role($1,$2,'academic')", [
      id(201),
      id(2),
    ]);
    await remove(db, 2, "teacher");
    await as(db, 2);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ session_id: id(200) }),
    ]);
    assert.equal(
      (await db.query<{ role: string | null }>("select my_role() role")).rows[0]
        .role,
      null,
    );
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ session_id: id(201) }),
    ]);
    assert.equal(
      (await db.query<{ role: string | null }>("select my_role() role")).rows[0]
        .role,
      "academic",
    );
    await remove(db, 3, "teacher");
    await db.exec("reset role");
    for (const n of [2, 3]) {
      const row = (
        await db.query(
          "select role,profile_has_role(id,'teacher') teacher,profile_has_role(id,'academic') academic from profiles where id=$1",
          [id(n)],
        )
      ).rows[0];
      assert.deepEqual(row, {
        role: "academic",
        teacher: false,
        academic: true,
      });
      assert.equal(
        (await db.query("select id from auth.users where id=$1", [id(n)])).rows
          .length,
        1,
      );
    }
    await db.query("update profiles set username='manager5' where id=$1", [
      id(5),
    ]);
    const rev = await revision(db, 5);
    await as(db, 1);
    const edited = await db.query<{
      result: { username: string; full_name: string };
    }>("select admin_edit_account($1,'manager',$2,$3) result", [
      id(5),
      rev,
      { name_prefix: "นาย", first_name: "New", last_name: "Name" },
    ]);
    assert.equal(edited.rows[0].result.username, "manager5");
    assert.equal(edited.rows[0].result.full_name, "นายNew Name");
    await assert.rejects(
      () =>
        db.query("select admin_edit_account($1,'manager',$2,$3)", [
          id(5),
          rev,
          { name_prefix: "นาย", first_name: "Old", last_name: "Name" },
        ]),
      /ACCOUNT_CHANGED/,
    );
    await remove(db, 2, "academic");
    await remove(db, 5, "manager");
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select id from profiles where id in ($1,$2)", [
          id(2),
          id(5),
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select id from auth.users where id in ($1,$2)", [
          id(2),
          id(5),
        ])
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query(
          "select id from profile_identities where id in ($1,$2)",
          [id(2), id(5)],
        )
      ).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});

test("every outstanding grade status blocks deleting any role but permits Auth reset with shared roles and files", async () => {
  const db = await fixture();
  try {
    await grade(db);
    for (const status of [
      "pending",
      "requested",
      "assigned",
      "submitted",
      "teacher_approved",
    ]) {
      await db.exec("reset role");
      await db.query(
        "update grade_records set status=$1::grade_status,final_grade=case when $1::text='teacher_approved' then '1' else null end",
        [status],
      );
      await assert.rejects(
        () => remove(db, 2, "teacher"),
        /ACCOUNT_OUTSTANDING/,
      );
      await assert.rejects(
        () => remove(db, 2, "academic"),
        /ACCOUNT_OUTSTANDING/,
      );
      await assert.rejects(
        () => remove(db, 4, "student"),
        /ACCOUNT_OUTSTANDING/,
      );
    }
    await db.exec("reset role");
    await db.exec(
      "alter table storage.objects add column owner_id text, add column owner uuid",
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('assignment-files','preserved.pdf',$1)",
      [id(2)],
    );
    const operation = await begin(db, 2, "teacher");
    assert.equal(operation.stage, "files");
    await assert.rejects(
      () =>
        db.query("select staff_reset_files($1,$2)", [id(2), operation.token]),
      /permission denied/,
    );
    await as(db, 2);
    assert.equal(
      (await db.query<{ role: string | null }>("select my_role() role")).rows[0]
        .role,
      null,
    );
    await assert.rejects(
      () =>
        db.query("select admin_begin_staff_auth_reset($1,'academic',0)", [
          id(6),
        ]),
      /ACCOUNT_FORBIDDEN/,
    );
    await db.exec("reset role");
    const before = (await db.query("select * from grade_records")).rows;
    await assert.rejects(
      () =>
        db.query("update profiles set full_name='Blocked' where id=$1", [
          id(2),
        ]),
      /REGISTRY_BUSY/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into teacher_registration_claims values($1,$2,now())",
          [id(2), id(90)],
        ),
      /REGISTRY_BUSY/,
    );
    await assert.rejects(
      () => db.query("delete from profile_roles where profile_id=$1", [id(2)]),
      /REGISTRY_BUSY/,
    );
    await db.exec("set role service_role");
    const files = (
      await db.query<{ result: unknown[] }>(
        "select staff_reset_files($1,$2) result",
        [id(2), operation.token],
      )
    ).rows[0].result;
    assert.equal(files.length, 1);
    await assert.rejects(
      () =>
        db.query("select claim_staff_auth_delete($1,$2)", [
          id(2),
          operation.token,
        ]),
      /REGISTRY_STORAGE/,
    );
    // Simulates the Storage API changing ownership, never done by application SQL.
    await db.exec("reset role; update storage.objects set owner_id=null");
    await db.exec("set role service_role");
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select claim_staff_auth_delete($1,$2) ok",
          [id(2), operation.token],
        )
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select claim_staff_auth_delete($1,$2) ok",
          [id(2), operation.token],
        )
      ).rows[0].ok,
      false,
    );
    await assert.rejects(
      () =>
        db.query("select finish_staff_auth_reset($1,$2)", [
          id(2),
          operation.token,
        ]),
      /REGISTRY_BUSY/,
    );
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [id(2)]);
    await db.exec("set role service_role");
    await db.query("select finish_staff_auth_reset($1,$2)", [
      id(2),
      operation.token,
    ]);
    await db.query("select finish_staff_auth_reset($1,$2)", [
      id(2),
      operation.token,
    ]);
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select * from grade_records")).rows,
      before,
    );
    assert.equal(
      (await db.query("select id from storage.objects")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select id from profiles where id=$1", [id(2)])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select profile_has_role($1,'academic') ok",
          [id(2)],
        )
      ).rows[0].ok,
      true,
    );
    await as(db, 2);
    assert.equal(
      (await db.query<{ role: string | null }>("select my_role() role")).rows[0]
        .role,
      null,
    );
    // No Auth makes reset idempotent; no grade/history scans are involved.
    assert.equal((await begin(db, 2, "academic")).stage, "complete");
    await as(db, 1);
    for (const rpc of ["admin_reset_teacher", "admin_reset_academic"])
      await assert.rejects(
        () => db.query(`select ${rpc}($1,'Person 2')`, [id(2)]),
        /permission denied/,
      );
    await db.exec("reset role; set role service_role");
    const claimed = await db.query<{ result: { id: string } }>(
      "select claim_teacher_registration($1,'First','Last',$2,$3) result",
      ["2".repeat(64), id(88), staffLoginEmails("1000000000001", secret)],
    );
    assert.equal(claimed.rows[0].result.id, id(2));
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email) values($1,'recreated@test')",
      [id(2)],
    );
    await db.exec("set role service_role");
    await db.query("select finish_teacher_registration($1,$2,true)", [
      id(2),
      id(88),
    ]);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select profile_has_role($1,'teacher') and profile_has_role($1,'academic') ok",
          [id(2)],
        )
      ).rows[0].ok,
      true,
    );
  } finally {
    await db.close();
  }
});

test("completed grades, history, attachments and audits survive deletion of the last profile role", async () => {
  const db = await fixture();
  try {
    await grade(db);
    await db.exec(
      "update grade_records set status='completed',final_grade='1',completed_at=now()",
    );
    await db.exec(
      "insert into grade_record_history select g.*,now(),now() from grade_records g",
    );
    await db.query(
      "insert into grade_assignments(id,record_id,round_number,assignment,due_at) values($1,$2,1,'Assignment description',now())",
      [id(101), id(100)],
    );
    await db.query(
      `insert into assignment_files(record_id,assignment_id,storage_path,original_name,mime_type,size_bytes,uploaded_by)
      values($1,$2,$3,'history.pdf','application/pdf',100,$4)`,
      [id(100), id(101), `${id(100)}/${id(102)}.pdf`, id(2)],
    );
    await db.query(
      "insert into audit_log(actor_id,record_id,action) values($1,$2,'historical-event')",
      [id(2), id(100)],
    );
    await remove(db, 2, "teacher");
    await remove(db, 2, "academic");
    await remove(db, 4, "student");
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select id from profiles where id in ($1,$2)", [
          id(2),
          id(4),
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from assignment_files")).rows.length,
      1,
    );
    const audit = (
      await db.query(
        "select actor_id,deleted_actor_id,deleted_actor_name from audit_log where action='historical-event'",
      )
    ).rows[0];
    assert.deepEqual(audit, {
      actor_id: null,
      deleted_actor_id: id(2),
      deleted_actor_name: "Person 2",
    });
    await as(db, 6);
    const history = (
      await db.query(
        "select student_name,teacher_name from grade_record_history",
      )
    ).rows[0];
    assert.deepEqual(history, {
      student_name: "Person 4",
      teacher_name: ["Person 2", "Person 3"],
    });
    await db.exec("reset role");
    // Even though a historical identity exists, a new assignment is rejected.
    await assert.rejects(
      () =>
        db.query(
          "update grade_records set teacher_id=ARRAY[$1]::uuid[],teacher_name=ARRAY['Deleted']",
          [id(2)],
        ),
      /ACCOUNT_NOT_FOUND/,
    );
  } finally {
    await db.close();
  }
});

test("academic form recovery reuses the same identity and reservation without adding a teacher role", async () => {
  const db = await fixture();
  try {
    const citizen = "1000000000001",
      hash = staffCitizenHash(citizen, secret),
      emails = staffLoginEmails(citizen, secret);
    await db.query("update profiles set staff_citizen_hash=$1 where id=$2", [
      hash,
      id(6),
    ]);
    const operation = await begin(db, 6, "academic");
    await db.exec("reset role; set role service_role");
    await db.query("select claim_staff_auth_delete($1,$2)", [
      id(6),
      operation.token,
    ]);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [id(6)]);
    await db.exec("set role service_role");
    await db.query("select finish_staff_auth_reset($1,$2)", [
      id(6),
      operation.token,
    ]);
    const input = {
      id: id(50),
      hash,
      emails,
      name_prefix: "นาย",
      first_name: "First",
      last_name: "Last",
      citizen_id_encrypted: encryptStaffCitizenId(citizen, id(50), secret),
    };
    const claim = (actor = id(1), row = input, token = id(80)) =>
      db.query<{ result: { id: string; token: string; pending: boolean } }>(
        "select claim_academic_registration($1,$2,$3) result",
        [actor, row, token],
      );
    await assert.rejects(() => claim(id(3)), /ACCOUNT_FORBIDDEN/);
    const result = (await claim()).rows[0].result;
    assert.equal(result.id, id(6));
    assert.equal(result.pending, false);
    assert.equal(
      (await claim(id(1), input, id(81))).rows[0].result.token,
      id(80),
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select id from profiles where staff_citizen_hash=$1", [
          hash,
        ])
      ).rows.length,
      1,
    );
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id(6),
      emails[1],
    ]);
    await db.exec("set role service_role");
    await db.query("select finish_teacher_registration($1,$2,true)", [
      id(6),
      id(80),
    ]);
    await assert.rejects(() => claim(), /REGISTRATION_EXISTS/);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select profile_has_role($1,'teacher') ok",
          [id(6)],
        )
      ).rows[0].ok,
      false,
    );
    // Old reset receipt may not finalize against the new account.
    await assert.rejects(
      () =>
        db.query("select finish_staff_auth_reset($1,$2)", [
          id(6),
          operation.token,
        ]),
      /REGISTRY_BUSY/,
    );
  } finally {
    await db.close();
  }
});

test("reset orchestration retains files, bounds work and never repeats an ambiguous Auth delete", async () => {
  let files = Array.from({ length: 23 }, (_, n) => ({
    bucket: "assignment-files",
    name: `file${n}`,
    version: null,
    metadata: { size: 10 },
  }));
  let deletes = 0,
    exists = true,
    claimed = false,
    finished = 0,
    concurrent = 0,
    maxConcurrent = 0;
  const store: StaffAuthResetStore = {
    async files() {
      return files.slice(0, 20);
    },
    async preserve(file) {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      files = files.filter((f) => f.name !== file.name);
      concurrent--;
    },
    async claimDelete() {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    async deleteAuth() {
      deletes++;
      exists = false;
      throw new Error("Lost response after commit");
    },
    async retryAfterRejectedDelete() {
      claimed = false;
    },
    async authExists() {
      return exists;
    },
    async finish() {
      finished++;
      return { account_revision: 2 };
    },
  };
  const operation: ResetOperation = {
    token: id(90),
    stage: "files",
    account_revision: 1,
  };
  assert.equal((await completeStaffAuthReset(operation, store)).pending, true);
  assert.equal(deletes, 0);
  assert.equal(files.length, 3);
  assert.equal((await completeStaffAuthReset(operation, store)).success, true);
  assert.equal(deletes, 1);
  assert.equal(finished, 1);
  assert.ok(maxConcurrent <= 4);
  exists = true;
  assert.ok(
    (await completeStaffAuthReset({ ...operation, stage: "deleting" }, store))
      .error,
  );
  assert.equal(deletes, 1);
  files = [
    {
      bucket: "assignment-files",
      name: "keep",
      version: null,
      metadata: { size: 10 },
    },
  ];
  await assert.rejects(
    () =>
      completeStaffAuthReset(operation, {
        ...store,
        async preserve() {
          throw new Error("Storage failed");
        },
      }),
    /Storage failed/,
  );
  assert.equal(files.length, 1);
  assert.equal(deletes, 1);
  claimed = false;
  files = [];
  const rejected = await completeStaffAuthReset(operation, {
    ...store,
    async deleteAuth() {
      throw new RejectedAuthDelete("Rejected");
    },
  });
  assert.ok(rejected.error);
  assert.equal(claimed, false);
  files = [
    {
      bucket: "assignment-files",
      name: "unchanged",
      version: null,
      metadata: { size: 10 },
    },
  ];
  await assert.rejects(
    () => completeStaffAuthReset(operation, { ...store, async preserve() {} }),
    /ownership change could not be verified/,
  );
});
