import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { provisionManager, type ManagerStore } from "../src/lib/manager-provisioning";
import { accountNameParts, type AccountList, type AccountRow } from "../src/lib/admin-accounts";
import { loginEmail } from "../src/lib/identity";

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = { name_prefix: "นางสาว", first_name: "ทดสอบ", last_name: "ระบบ" };
const secret = "test-only-secret-at-least-thirty-two-characters";

test("manager provisioning uses the login identity, excludes passwords from profiles, and rolls back only confirmed orphans", async () => {
  const input = { ...names, username: "Manager.Test", password: "secret123" };
  let created = 0, deleted = 0, failSave = false, failRead = false;
  let savedRole: string | null = null;
  const store: ManagerStore = {
    async createAuth(email, password) {
      created++;
      assert.equal(email, loginEmail("manager:manager.test", secret));
      assert.equal(password, input.password);
      return id(10);
    },
    async saveProfile(row) {
      assert.equal(row.full_name, "นางสาวทดสอบ ระบบ");
      assert.equal(row.username, "manager.test");
      assert.equal("password" in row, false);
      if (failSave) throw new Error("save failed");
      savedRole = row.role;
    },
    async findProfile() {
      if (failRead) throw new Error("read failed");
      return savedRole ? { role: savedRole } : null;
    },
    async deleteAuth() { deleted++; },
  };
  assert.equal((await provisionManager(input, store, secret)).success, true);
  failSave = true;
  assert.equal((await provisionManager(input, store, secret)).success, true);
  assert.equal(deleted, 0);
  savedRole = null;
  assert.ok((await provisionManager(input, store, secret)).error);
  assert.equal(deleted, 1);
  failRead = true;
  assert.ok((await provisionManager(input, store, secret)).error);
  assert.equal(deleted, 1);
  failRead = false; savedRole = "teacher";
  assert.ok((await provisionManager(input, store, secret)).error);
  assert.equal(deleted, 1);
  const calls = created;
  for (const bad of [{ password: "short" }, { username: "x" }, { role: "admin" }]) {
    assert.ok((await provisionManager({ ...input, ...bad }, store, secret)).error);
  }
  assert.equal(created, calls);
  assert.deepEqual(accountNameParts({ id: id(1), full_name: "เด็กหญิงสมใจ ใจดี" }), {
    name_prefix: "เด็กหญิง", first_name: "สมใจ", last_name: "ใจดี",
  });
});

test("account administration creates managers, enforces active Admin, searches, pages and resets only manager sessions", async () => {
  const db = await loadTestDatabase();
  const as = async (n: number) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{}',false)", [id(n)]);
    await db.exec("set role authenticated");
  };
  const create = (n: number, username = `manager${n}`) => db.query("select admin_create_manager_profile($1,$2)", [id(n), { ...names, username }]);
  const list = async (role = "manager", search = "", page = 1) => (await db.query<{result: AccountList}>("select admin_account_list($1,$2,$3) result", [role, search, page])).rows[0].result;
  try {
    for (let n = 1; n <= 57; n++) await db.query("insert into auth.users(id) values($1)", [id(n)]);
    await db.query("insert into profiles(id,role,full_name) values($1,'admin','Admin'),($2,'teacher','Teacher'),($3,'academic','Academic')", [id(1), id(2), id(3)]);
    await db.query("select set_staff_roles($1,ARRAY['teacher','admin']::app_role[])", [id(2)]);
    for (const n of [2, 3]) {
      await as(n);
      await assert.rejects(() => list(), /ACCOUNT_FORBIDDEN/);
      await assert.rejects(() => create(4), /ACCOUNT_FORBIDDEN/);
      await assert.rejects(() => db.query("select admin_manager_password_target($1,0)", [id(4)]), /ACCOUNT_FORBIDDEN/);
      await assert.rejects(() => db.query("select admin_delete_account($1,'manager',0)", [id(4)]), /ACCOUNT_FORBIDDEN/);
      await assert.rejects(() => db.query("select admin_edit_account($1,'teacher',0,$2)", [id(2), names]), /ACCOUNT_FORBIDDEN/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(() => list(), /permission denied/);
    await assert.rejects(() => create(4), /permission denied/);
    await as(1);
    for (let n = 4; n <= 55; n++) await create(n);
    await assert.rejects(() => create(56, "manager4"), /duplicate key/);
    await assert.rejects(() => create(56, "Invalid Uppercase"), /ACCOUNT_INVALID/);
    await assert.rejects(() => list("student"), /ACCOUNT_INVALID/);
    const first = await list(), second = await list("manager", "", 2);
    assert.equal(first.total, 52);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 2);
    assert.equal(new Set([...first.items,...second.items].map(row => row.id)).size, 52);
    assert.deepEqual(Object.keys(first.items[0]).sort(), ["account_revision","first_name","full_name","has_auth","id","last_name","learning_subject_group","name_prefix","username"]);
    assert.equal((await list("manager", "MANAGER55")).items[0].id, id(55));
    assert.equal((await list("manager", "ทดสอบ")).total, 52);
    assert.equal((await list("manager", "%_")).total, 0);
    await assert.rejects(() => db.query("select admin_manager_password_target($1,0)", [id(2)]), /ACCOUNT_NOT_FOUND/);
    await assert.rejects(() => db.query("select admin_manager_password_target($1,1)", [id(4)]), /ACCOUNT_CHANGED/);
    await db.exec("reset role");
    await db.query("insert into auth.sessions values($1,$2),($3,$4)", [id(100), id(4), id(101), id(5)]);
    await as(1);
    await db.query("select admin_finish_manager_password_reset($1,0)", [id(4)]);
    await db.exec("reset role");
    assert.deepEqual((await db.query("select user_id from auth.sessions")).rows, [{user_id: id(5)}]);
    assert.equal((await db.query("select * from audit_log where action=$1", [`manager_password_changed:${id(4)}`])).rows.length, 1);
    assert.equal((await db.query<{ role: string }>("select role from profiles where id=$1", [id(4)])).rows[0].role, "manager");
  } finally { await db.close(); }
});

test("historical combined deletion before role deletion preserved registry identities", async () => {
  const db = await loadTestDatabase({ through: "045" });
  const asAdmin = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(1)]);
    await db.exec("set role authenticated");
  };
  const edit = async (n: number, role: string, revision = 0, changes: object = names) => (await db.query<{result: AccountRow}>("select admin_edit_account($1,$2,$3,$4) result", [id(n), role, revision, changes])).rows[0].result;
  const remove = (n: number, role: string, revision = 0) => db.query("select admin_delete_account($1,$2,$3)", [id(n), role, revision]);
  try {
    for (const [n, role] of [[1,"admin"],[2,"teacher"],[3,"academic"],[4,"student"],[5,"manager"],[6,"teacher"],[7,"student"],[8,"academic"]] as const) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id(n), `identity${n}@example.test`]);
      await db.query("insert into profiles(id,role,full_name,student_code,staff_citizen_hash) values($1,$2,$3,$4,$5)", [id(n),role,`Account ${n}`,role==="student" ? `1000${n}` : null, [2,3,6].includes(n) ? String(n).repeat(64) : null]);
    }
    await db.query("select set_staff_roles($1,ARRAY['teacher','academic']::app_role[])", [id(3)]);
    await db.query("select set_staff_roles($1,ARRAY['teacher','admin']::app_role[])", [id(6)]);
    await db.query(`insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id)
      values($1,'C1','Course',1,'ม.4/1',ARRAY['Account 2','Account 3'],'10004','Account 4',1,2569,1,'0',$2,ARRAY[$3,$4]::uuid[])`, [id(100),id(4),id(2),id(3)]);
    await db.exec("update grade_records set status='completed',final_grade='1',completed_at=now()");
    await db.exec("insert into grade_record_history select g.*,now(),now() from grade_records g");
    await asAdmin();
    const updated = await edit(4,"student",0,{...names,classroom:"ม.5/2",roll_number:20});
    assert.equal(updated.account_revision, 1);
    assert.equal(updated.student_code, "10004");
    assert.equal(updated.classroom,"ม.5/2");
    await assert.rejects(() => edit(4,"student",0,{...names,classroom:"ม.5/2",roll_number:21}), /ACCOUNT_CHANGED/);
    await assert.rejects(() => edit(2,"academic"), /ACCOUNT_NOT_FOUND/);
    await assert.rejects(() => edit(6,"teacher"), /ACCOUNT_PROTECTED/);
    await assert.rejects(() => edit(2,"teacher",0,{...names,role:"admin"}), /ACCOUNT_INVALID/);
    await edit(2,"teacher");
    await edit(3,"academic");
    await assert.rejects(() => remove(4,"student",0), /ACCOUNT_CHANGED/);
    await assert.rejects(() => remove(4,"student",1), /ACCOUNT_REFERENCED/);
    await assert.rejects(() => remove(6,"teacher"), /ACCOUNT_PROTECTED/);
    await assert.rejects(() => remove(1,"admin"), /ACCOUNT_INVALID/);
    await db.exec("reset role");
    const active = (await db.query("select student_name,teacher_name from grade_records")).rows[0];
    assert.deepEqual(active,{student_name:"นางสาวทดสอบ ระบบ",teacher_name:["นางสาวทดสอบ ระบบ","นางสาวทดสอบ ระบบ"]});
    const history = (await db.query("select student_name,teacher_name from grade_record_history")).rows[0];
    assert.deepEqual(history,{student_name:"Account 4",teacher_name:["Account 2","Account 3"]});
    await asAdmin();
    await remove(2,"teacher",1);
    await remove(3,"academic",1); // A shared teacher identity remains permanent from any staff page.
    await db.exec("reset role");
    assert.equal((await db.query("select * from profiles where id=any($1::uuid[])",[[id(2),id(3)]])).rows.length,2);
    assert.equal((await db.query("select * from auth.users where id=any($1::uuid[])",[[id(2),id(3)]])).rows.length,0);
    assert.equal((await db.query<{ email: string | null }>("select email from auth.users where id=$1", [id(4)])).rows[0].email,"identity4@example.test");
    // A remaining historical reference must still block deletion after active grades are removed.
    await db.exec("delete from grade_records");
    await asAdmin();
    await assert.rejects(() => remove(4,"student",1), /ACCOUNT_REFERENCED/);
    await db.exec("reset role");
    await db.query("insert into audit_log(actor_id,action) values($1,'test_actor')",[id(5)]);
    await db.exec("create table account_auth_blocker(id uuid references auth.users(id))");
    await db.query("insert into account_auth_blocker values($1)",[id(5)]);
    await asAdmin();
    await assert.rejects(() => remove(5,"manager"), /foreign key/);
    await db.exec("reset role");
    assert.equal((await db.query("select * from profiles where id=$1",[id(5)])).rows.length,1);
    assert.equal((await db.query<{ actor_id: string | null }>("select actor_id from audit_log where action='test_actor'")).rows[0].actor_id,id(5));
    await db.exec("delete from account_auth_blocker");
    await asAdmin();
    for (const [n,role] of [[5,"manager"],[7,"student"],[8,"academic"]] as const) { await remove(n,role); await remove(n,role); }
    await db.exec("reset role");
    assert.deepEqual((await db.query("select actor_id,deleted_actor_id,deleted_actor_name from audit_log where action='test_actor'")).rows[0],{actor_id:null,deleted_actor_id:id(5),deleted_actor_name:"Account 5"});
    assert.equal((await db.query("select * from auth.users where id=any($1::uuid[])",[[id(5),id(7),id(8)]])).rows.length,0);
  } finally { await db.close(); }
});
