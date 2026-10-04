import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { encryptStaffCitizenId } from "../src/lib/staff-identity";
import { loginEmail } from "../src/lib/identity";
import {
  provisionStaff,
  type StaffRegistrationStore,
} from "../src/lib/teacher-registration";
import type { TeacherList } from "../src/lib/teachers";

const id = (n: number) =>
  `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const secret = "test-only-secret-at-least-thirty-two-characters";
const profile = {
  name_prefix: "นางสาว",
  first_name: "ทดสอบ",
  last_name: "ระบบ",
  citizen_id_encrypted: encryptStaffCitizenId("1000000000001", id(60), secret),
};

test("academic administration preserves teacher roles, requires active Admin and supports names, search and paging", async () => {
  const db = await loadTestDatabase();
  const as = async (n: number, claims = "{}") => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id(n), claims],
    );
    await db.exec("set role authenticated");
  };
  const grant = (n: number, name = `Staff ${n}`) =>
    db.query("select admin_add_academic_teacher($1,$2)", [id(n), name]);
  const create = (n = 60, data = profile) =>
    db.query("select admin_create_academic_profile($1,$2::jsonb)", [
      id(n),
      JSON.stringify(data),
    ]);
  const list = async (search = "", page = 1) =>
    (
      await db.query<{ result: TeacherList }>(
        "select admin_academic_list($1,$2) result",
        [search, page],
      )
    ).rows[0].result;
  try {
    for (let n = 1; n <= 58; n++) {
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2,$3)",
        [
          id(n),
          n === 1
            ? "admin"
            : n === 2
              ? "teacher"
              : n === 3
                ? "manager"
                : "academic",
          `Staff ${n}`,
        ],
      );
    }
    await db.query("insert into auth.users(id) values($1)", [id(60)]);
    await db.query(
      "select set_staff_roles($1,ARRAY['teacher','admin']::app_role[])",
      [id(2)],
    );
    for (const n of [2, 3, 4]) {
      await as(n);
      await assert.rejects(() => list(), /ACADEMIC_FORBIDDEN/);
      await assert.rejects(() => grant(2), /ACADEMIC_FORBIDDEN/);
      await assert.rejects(() => create(), /ACADEMIC_FORBIDDEN/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(() => grant(2), /permission denied/);
    await assert.rejects(() => create(), /permission denied/);
    await assert.rejects(() => list(), /permission denied/);
    await as(1);
    await assert.rejects(
      () =>
        db.query("select set_staff_roles($1,ARRAY['admin']::app_role[])", [
          id(3),
        ]),
      /permission denied/,
    );
    await assert.rejects(() => grant(3), /ACADEMIC_TEACHER_CHANGED/);
    await assert.rejects(
      () => grant(2, "stale name"),
      /ACADEMIC_TEACHER_CHANGED/,
    );
    await grant(2);
    await grant(2); // Safe retry, no duplicate role or audit entries.
    await create();
    await assert.rejects(() => create(2), /duplicate key/);
    await assert.rejects(
      () => create(61, { ...profile, citizen_id_encrypted: "plaintext" }),
      /ACADEMIC_INVALID/,
    );
    const first = await list();
    const second = await list("", 2);
    assert.equal(first.total, 57);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 7);
    assert.deepEqual(Object.keys(first.items[0]).sort(), ["full_name", "id"]);
    assert.equal((await list("ทดสอบ")).items[0].full_name, "นางสาวทดสอบ ระบบ");
    assert.equal((await list("%_")).total, 0);
    await assert.rejects(() => list("", 0), /ACADEMIC_INVALID/);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ role: string }>(
          "select role from profiles where id=$1",
          [id(2)],
        )
      ).rows[0].role,
      "teacher",
    );
    assert.deepEqual(
      (
        await db.query<{ role: string }>(
          "select role from profile_roles where profile_id=$1 order by role::text",
          [id(2)],
        )
      ).rows.map((row) => row.role),
      ["academic", "admin"],
    );
    assert.equal(
      (
        await db.query(
          "select * from profiles where id=$1 and role='academic'",
          [id(60)],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from audit_log where action=$1 and actor_id=$2",
          [`academic_created:${id(60)}`, id(1)],
        )
      ).rows.length,
      1,
    );
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      id(100),
      id(2),
    ]);
    await db.query("select activate_login_role($1,$2,'academic')", [
      id(100),
      id(2),
    ]);
    await as(2, JSON.stringify({ session_id: id(100) }));
    await assert.rejects(() => list(), /ACADEMIC_FORBIDDEN/); // Has admin, but signed in as academic.
  } finally {
    await db.close();
  }
});

test("historical academic reset before the registry deleted shared accounts atomically", async () => {
  const db = await loadTestDatabase({through: "041"});
  const as = async (n: number) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(n),
    ]);
    await db.exec("set role authenticated");
  };
  const reset = (n: number) =>
    db.query("select admin_reset_academic($1,$2)", [id(n), `Staff ${n}`]);
  try {
    for (const [n, role] of [
      [1, "admin"],
      [2, "academic"],
      [3, "teacher"],
    ] as const) {
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2,$3)",
        [id(n), role, `Staff ${n}`],
      );
    }
    await db.query(
      "select set_staff_roles($1,ARRAY['teacher','academic']::app_role[])",
      [id(2)],
    );
    await db.query("insert into audit_log(actor_id,action) values($1,'test')", [
      id(2),
    ]);
    await as(2);
    await assert.rejects(() => reset(3), /TEACHER_RESET_FORBIDDEN/);
    await as(1);
    await assert.rejects(() => reset(1), /TEACHER_RESET_SELF/);
    await assert.rejects(() => reset(3), /TEACHER_RESET_NOT_TEACHER/);
    await assert.rejects(
      () =>
        db.query("select admin_reset_staff($1,'Staff 3','teacher')", [id(3)]),
      /permission denied/,
    );
    // Force Auth deletion to fail; profile/roles/audit updates must roll back too.
    await db.exec(
      "reset role; create table academic_auth_blocker(id uuid references auth.users(id))",
    );
    await db.query("insert into academic_auth_blocker values($1)", [id(2)]);
    await as(1);
    await assert.rejects(() => reset(2), /foreign key/);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from profiles where id=$1", [id(2)])).rows
        .length,
      1,
    );
    await db.exec("delete from academic_auth_blocker");
    await as(1);
    await reset(2);
    await reset(2);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from profiles where id=$1", [id(2)])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select * from auth.users where id=$1", [id(2)])).rows
        .length,
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
    assert.equal(
      (
        await db.query<{ deleted_actor_id: string }>(
          "select deleted_actor_id from audit_log where action='test'",
        )
      ).rows[0].deleted_actor_id,
      id(2),
    );
  } finally {
    await db.close();
  }
});

test("academic provisioning uses academic login identity, six-character password and safe rollback on uncertain saves", async () => {
  const input = {
    name_prefix: "นางสาว",
    first_name: "ทดสอบ",
    last_name: "ระบบ",
    citizen_id: "1-0000-00000-00-1",
    password: "abc123",
  };
  let deleted = 0;
  let savedRole: string | null = null;
  let failSave = false;
  let failRead = false;
  const store: StaffRegistrationStore<"academic"> = {
    async createAuth(email, password) {
      assert.equal(email, loginEmail("academic:1000000000001", secret));
      assert.equal(password, "abc123");
      return id(60);
    },
    async saveProfile(row, citizen) {
      assert.equal(row.role, "academic");
      assert.equal(row.full_name, "นางสาวทดสอบ ระบบ");
      assert.equal(citizen, "1000000000001");
      if (failSave) throw new Error("save");
      savedRole = row.role;
    },
    async findProfile() {
      if (failRead) throw new Error("read");
      return savedRole ? { role: savedRole } : null;
    },
    async deleteAuth() {
      deleted++;
    },
  };
  assert.equal(
    (await provisionStaff(input, store, secret, "academic")).success,
    true,
  );
  failSave = true; // Simulate lost response after a successful commit.
  assert.equal(
    (await provisionStaff(input, store, secret, "academic")).success,
    true,
  );
  assert.equal(deleted, 0);
  savedRole = null;
  assert.ok((await provisionStaff(input, store, secret, "academic")).error);
  assert.equal(deleted, 1);
  failRead = true;
  assert.match(
    (await provisionStaff(input, store, secret, "academic")).error,
    /ไม่สามารถยืนยันสถานะบัญชี/,
  );
  assert.equal(deleted, 1);
  assert.match(
    (
      await provisionStaff(
        { ...input, password: "12345" },
        store,
        secret,
        "academic",
      )
    ).error,
    /อย่างน้อย 6/,
  );
});
