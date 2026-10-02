import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHmac } from "node:crypto";
import { loginSchema, teacherRegistrationSchema } from "../src/lib/auth-input";
import {
  identityPassword,
  loginEmail,
  loginPassword,
} from "../src/lib/identity";
import {
  provisionTeacher,
  RegistrationError,
  type TeacherRegistrationStore,
  type TeacherProfile,
} from "../src/lib/teacher-registration";
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

function registrationStore() {
  const profiles = new Map<string, TeacherProfile>();
  const calls: string[] = [];
  const store: TeacherRegistrationStore = {
    async createAuth(email, password) {
      calls.push("create");
      assert.equal(email, loginEmail("teacher:1000000000001", secret));
      assert.equal(password, "abc123");
      return id;
    },
    async saveProfile(profile, citizenId) {
      calls.push("save");
      assert.equal(citizenId, "1000000000001");
      assert.equal("password" in profile, false);
      assert.equal("citizen_id" in profile, false);
      profiles.set(profile.id, profile);
    },
    async findProfile(profileId) {
      calls.push("verify");
      return profiles.get(profileId) ?? null;
    },
    async deleteAuth() {
      calls.push("delete");
    },
  };
  return { store, profiles, calls };
}

test("teacher registration creates Auth first, joins names, and rejects invalid input before any writes", async () => {
  const { store, profiles, calls } = registrationStore();
  assert.deepEqual(await provisionTeacher(teacher, store, secret), {
    error: "",
    success: true,
  });
  assert.deepEqual(calls, ["create", "save"]);
  assert.equal(profiles.get(id)?.role, "teacher");
  assert.equal(profiles.get(id)?.full_name, "นางสาวทดสอบ ระบบ");
  calls.length = 0;
  for (const input of [
    { ...teacher, password: "12345" },
    { ...teacher, citizen_id: "123" },
    { ...teacher, first_name: " " },
    { ...teacher, role: "admin" },
    { ...teacher, first_name: "ก".repeat(80), last_name: "ก".repeat(80) },
  ])
    assert.ok((await provisionTeacher(input, store, secret)).error);
  assert.deepEqual(calls, []);
  assert.equal(
    teacherRegistrationSchema.parse({ ...teacher, password: " a123 " })
      .password,
    " a123 ",
  );
});

test("duplicate signup never updates an existing account or password", async () => {
  const { store, calls } = registrationStore();
  store.createAuth = async () => {
    throw new RegistrationError("มีบัญชีครูนี้อยู่แล้ว");
  };
  const result = await provisionTeacher(teacher, store, secret);
  assert.equal(result.error, "มีบัญชีครูนี้อยู่แล้ว");
  assert.deepEqual(calls, []);
});

test("registration rolls Auth back only after confirming profile did not commit", async () => {
  const failed = registrationStore();
  failed.store.saveProfile = async () => {
    throw new Error("database failed");
  };
  assert.ok((await provisionTeacher(teacher, failed.store, secret)).error);
  assert.deepEqual(failed.calls, ["create", "verify", "delete"]);

  const committed = registrationStore();
  const save = committed.store.saveProfile;
  committed.store.saveProfile = async (profile, citizenId) => {
    await save(profile, citizenId);
    throw new Error("response lost");
  };
  assert.equal(
    (await provisionTeacher(teacher, committed.store, secret)).success,
    true,
  );
  assert.deepEqual(committed.calls, ["create", "save", "verify"]);

  const unknown = registrationStore();
  unknown.store.saveProfile = async () => {
    throw new Error("request lost");
  };
  unknown.store.findProfile = async () => {
    throw new Error("connection lost");
  };
  assert.match(
    (await provisionTeacher(teacher, unknown.store, secret)).error,
    /ไม่สามารถยืนยัน/,
  );
  assert.deepEqual(unknown.calls, ["create"]);
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

test("registration database functions allow only service_role, fix role to teacher, and enforce limits", async () => {
  const db = await loadTestDatabase();
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
