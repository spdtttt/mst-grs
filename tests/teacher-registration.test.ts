import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { loginSchema, teacherRegistrationSchema } from "../src/lib/auth-input";
import {
  identityPassword,
  loginEmail,
  loginPassword,
} from "../src/lib/identity";
import { encryptStaffCitizenId } from "../src/lib/staff-identity";
import {
  migrateStaffLogins,
  type StaffMigrationStore,
} from "../src/lib/staff-login-migration";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";

const secret = "test-only-secret-at-least-thirty-two-characters";
const id = "00000000-0000-4000-8000-000000000001";
const teacher = {
  citizen_id: "1-0000-00000-00-1",
  name_prefix: " นางสาว ",
  first_name: " ทดสอบ ",
  last_name: " ระบบ ",
  password: "abc123",
};

test("historical repair migration restores the legacy registration schema without removing profiles", async () => {
  const db = await loadTestDatabase({ through: "041" });
  const repair = readFileSync(
    "supabase/migrations/030_restore_profile_citizen_id_encrypted.sql",
    "utf8",
  );
  const existingId = "00000000-0000-4000-8000-000000000002";
  const profile = {
    name_prefix: "นาย",
    first_name: "ทดสอบ",
    last_name: "ระบบ",
    citizen_id_encrypted: encryptStaffCitizenId("1000000000001", id, secret),
  };
  const register = () =>
    db.query("select public.register_teacher_profile($1,$2::jsonb)", [
      id,
      JSON.stringify(profile),
    ]);
  try {
    await db.query("insert into auth.users values($1),($2)", [id, existingId]);
    await db.query(
      "insert into profiles(id,role,full_name) values($1,'teacher','Existing teacher')",
      [existingId],
    );
    await db.exec(
      "alter table profiles drop column citizen_id_encrypted; set role service_role",
    );
    await assert.rejects(register, /citizen_id_encrypted/);
    await db.exec("reset role");
    await db.exec(repair);
    await db.exec(repair);
    await db.exec("set role service_role");
    await register();
    await db.exec("reset role");
    assert.equal((await db.query("select * from profiles")).rows.length, 2);
    assert.equal(
      (await db.query("select * from audit_log where actor_id=$1", [id])).rows
        .length,
      1,
    );
    await assert.rejects(
      () =>
        db.query(
          "update profiles set citizen_id_encrypted='plaintext' where id=$1",
          [id],
        ),
      /check constraint/,
    );
  } finally {
    await db.close();
  }
});

test("staff login requires citizen ID and chosen password; student and manager logins remain compatible", () => {
  for (const role of ["teacher", "academic", "admin"] as const) {
    const input = { role, identifier: teacher.citizen_id, password: "abc123" };
    const parsed = loginSchema.parse(input);
    assert.equal(parsed.identifier, "1000000000001");
    assert.equal(loginPassword(role, parsed.password, secret), "abc123");
    for (const password of ["", "12345", "x".repeat(129)])
      assert.equal(
        loginSchema.safeParse({ ...input, password }).success,
        false,
      );
    assert.equal(
      loginSchema.safeParse({ ...input, identifier: "warunya" }).success,
      false,
    );
  }
  const student = loginSchema.parse({
    role: "student",
    identifier: "10001",
    password: "1000000000001",
  });
  assert.equal(
    loginPassword(student.role, student.password, secret),
    identityPassword("student", student.password, secret),
  );
  assert.ok(
    loginSchema.safeParse({
      role: "manager",
      identifier: "school_manager",
      password: "abc123",
    }).success,
  );
  assert.equal(
    loginSchema.safeParse({
      role: "owner",
      identifier: "1000000000001",
      password: "abc123",
    }).success,
    false,
  );
});

test("staff citizen ID encryption is randomized and bound to the profile", () => {
  const cipherText = encryptStaffCitizenId("1000000000001", id, secret);
  assert.notEqual(
    cipherText,
    encryptStaffCitizenId("1000000000001", id, secret),
  );
  assert.match(cipherText, /^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]{26}$/);
  const [, nonce, tag, encrypted] = cipherText.split(":");
  const key = createHmac("sha256", secret)
    .update("mst-grs:staff-citizen:v1")
    .digest();
  const decrypt = (profileId: string) => {
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonce, "hex"),
    );
    cipher.setAAD(Buffer.from(`staff:${profileId}`));
    cipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([
      cipher.update(Buffer.from(encrypted, "hex")),
      cipher.final(),
    ]).toString();
  };
  assert.equal(decrypt(id), "1000000000001");
  assert.throws(() => decrypt("other-profile"));
});

test("staff login migration preserves account IDs, checks roles and refuses conflicting mappings before updates", async () => {
  const oldEmail = loginEmail("admin:warunya", secret);
  const updates: unknown[] = [];
  const store: StaffMigrationStore = {
    async listUsers() {
      return [{ id, email: oldEmail }];
    },
    async profileRole() {
      return "admin";
    },
    async updateUser(...args) {
      updates.push(args);
    },
  };
  const account = {
    role: "admin" as const,
    identifier: "1000000000001",
    legacy_identifier: "warunya",
    password: "abc123",
  };
  assert.equal(await migrateStaffLogins([account], store, secret), 1);
  assert.deepEqual(updates, [
    [id, loginEmail("admin:1000000000001", secret), "abc123"],
  ]);
  updates.length = 0;
  await assert.rejects(
    () => migrateStaffLogins([account, account], store, secret),
    /conflicting/,
  );
  assert.equal(updates.length, 0);
  await assert.rejects(
    () =>
      migrateStaffLogins(
        [account],
        { ...store, profileRole: async () => "teacher" },
        secret,
      ),
    /requested role/,
  );
  assert.equal(updates.length, 0);
  await assert.rejects(
    () =>
      migrateStaffLogins(
        [account],
        {
          ...store,
          listUsers: async () => [
            { id, email: oldEmail },
            { id: "other", email: loginEmail("admin:1000000000001", secret) },
          ],
        },
        secret,
      ),
    /conflicting/,
  );
  assert.equal(updates.length, 0);
});

test("historical registration functions allow only service_role, fix role to teacher, and enforce limits", async () => {
  const db = await loadTestDatabase({ through: "041" });
  const profile = {
    name_prefix: "นาย",
    first_name: "ทดสอบ",
    last_name: "ระบบ",
    role: "admin",
    citizen_id_encrypted: encryptStaffCitizenId("1000000000001", id, secret),
  };
  const register = () =>
    db.query("select register_teacher_profile($1,$2::jsonb)", [
      id,
      JSON.stringify(profile),
    ]);
  try {
    await db.query("insert into auth.users values($1)", [id]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(register, /permission denied/);
      await assert.rejects(
        () =>
          db.query("select consume_teacher_registration($1,$2)", [
            "a".repeat(64),
            "b".repeat(64),
          ]),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await register();
    await assert.rejects(register, /duplicate key/);
    const limit = async (bucket = "a".repeat(64)) =>
      (
        await db.query<{ allowed: boolean }>(
          "select consume_teacher_registration($1,$2) allowed",
          [bucket, "b".repeat(64)],
        )
      ).rows[0].allowed;
    for (let i = 0; i < 5; i++) assert.equal(await limit(), true);
    assert.equal(await limit(), false);
    for (let i = 0; i < 54; i++)
      assert.equal(await limit(i.toString(16).padStart(64, "0")), true);
    assert.equal(await limit("c".repeat(64)), false);
    await db.exec("reset role");
    const saved = (
      await db.query<{ role: string; full_name: string }>(
        "select role,full_name from profiles where id=$1",
        [id],
      )
    ).rows[0];
    assert.deepEqual(saved, { role: "teacher", full_name: "นายทดสอบ ระบบ" });
    assert.equal(
      (await db.query("select * from audit_log where actor_id=$1", [id])).rows
        .length,
      1,
    );
    await db.exec(
      "update login_attempts set window_start=now()-interval '16 minutes'; set role service_role",
    );
    assert.equal(await limit(), true);
  } finally {
    await db.close();
  }
});
