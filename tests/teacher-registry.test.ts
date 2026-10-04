import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import {
  readTeacherWorkbook,
  parseTeacherName,
  teacherColumns,
  teacherRegistrySchema,
} from "../src/lib/teacher-registry";
import {
  encryptStaffCitizenId,
  decryptStaffCitizenId,
  staffCitizenHash,
} from "../src/lib/staff-identity";
import {
  provisionRegisteredTeacher,
  RegistryRegistrationError,
  type RegisteredTeacherStore,
} from "../src/lib/registered-teacher";
import { staffLoginEmails } from "../src/lib/role-login";

const secret = "test-only-secret-at-least-thirty-two-characters";
const uuid = (n: number) =>
  `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = {
  citizen_id: "1000000000001",
  name_prefix: "นาย",
  first_name: "ศุภพล",
  last_name: "แดงประทีป",
  learning_subject_group: "กลุ่มสาระการเรียนรู้คณิตศาสตร์",
};
const registration = { ...input, password: "abc123" };
const { learning_subject_group: _group, ...signup } = registration;

test("reset recovers an existing encrypted identity with revision checks and retains registry roles", async () => {
  const db = await loadTestDatabase();
  const actor = uuid(91),
    teacher = uuid(92);
  const ciphertext = encryptStaffCitizenId(input.citizen_id, teacher, secret);
  const hash = staffCitizenHash(
    decryptStaffCitizenId(ciphertext, teacher, secret),
    secret,
  );
  const names = parseTeacherName(
    `101 ${input.name_prefix}${input.first_name} ${input.last_name}`,
  );
  const prepare = (revision: number, who = actor, cipher = ciphertext) =>
    db.query<{ revision: number }>(
      "select prepare_teacher_reset_identity($1,$2,$3,$4,$5,$6) revision",
      [who, teacher, revision, cipher, hash, names],
    );
  try {
    await db.query(
      "insert into auth.users(id,email) values($1,'admin@test'),($2,'teacher@test')",
      [actor, teacher],
    );
    await db.query(
      "insert into profiles(id,role,full_name,citizen_id_encrypted) values($1,'admin','Admin',null),($2,'teacher',$3,$4)",
      [
        actor,
        teacher,
        `${input.name_prefix}${input.first_name} ${input.last_name}`,
        ciphertext,
      ],
    );
    await db.query(
      "select set_staff_roles($1,ARRAY['teacher','academic']::app_role[])",
      [teacher],
    );
    const initial = (
      await db.query<{ revision: number }>(
        "select account_revision revision from profiles where id=$1",
        [teacher],
      )
    ).rows[0].revision;
    await db.exec("set role authenticated");
    await assert.rejects(() => prepare(initial), /permission denied/);
    await db.exec("reset role; set role service_role");
    await assert.rejects(() => prepare(initial, teacher), /ACCOUNT_FORBIDDEN/);
    await assert.rejects(() => prepare(initial + 1), /ACCOUNT_CHANGED/);
    await assert.rejects(
      () => prepare(initial, actor, "wrong"),
      /REGISTRY_IDENTITY_MISSING/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into teacher_registration_claims(profile_id,token) values($1,$2)",
      [teacher, uuid(94)],
    );
    await db.exec("set role service_role");
    await assert.rejects(() => prepare(initial), /REGISTRY_BUSY/);
    await db.exec("reset role");
    await db.query(
      "delete from teacher_registration_claims where profile_id=$1",
      [teacher],
    );
    await db.exec("set role service_role");
    const revision = (await prepare(initial)).rows[0].revision;
    assert.equal(revision, initial + 1);
    await assert.rejects(() => prepare(initial), /ACCOUNT_CHANGED/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(
      () =>
        db.query("select admin_delete_account($1,'teacher',$2)", [
          teacher,
          initial,
        ]),
      /ACCOUNT_CHANGED/,
    );
    const result = (
      await db.query<{
        result: { deleted: boolean; account_revision: number };
      }>("select admin_delete_account($1,'teacher',$2) result", [
        teacher,
        revision,
      ])
    ).rows[0].result;
    assert.equal(result.deleted, true);
    assert.equal(result.account_revision, revision + 1);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select id from auth.users where id=$1", [teacher])).rows
        .length,
      0,
    );
    const profile = (
      await db.query<{ staff_citizen_hash: string; first_name: string }>(
        "select staff_citizen_hash,first_name from profiles where id=$1",
        [teacher],
      )
    ).rows[0];
    assert.equal(profile.staff_citizen_hash, hash);
    assert.equal(profile.first_name, input.first_name);
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select profile_has_role($1,'academic') ok",
          [teacher],
        )
      ).rows[0].ok,
      true,
    );
    await db.exec("set role service_role");
    const claim = (
      await db.query<{ result: { id: string } }>(
        "select claim_teacher_registration($1,$2,$3,$4,$5) result",
        [
          hash,
          input.first_name,
          input.last_name,
          uuid(93),
          staffLoginEmails(input.citizen_id, secret),
        ],
      )
    ).rows[0].result;
    assert.equal(claim.id, teacher);
  } finally {
    await db.close();
  }
});

test("teacher workbook cleans leading digits, retains zeroes, validates all sheets, and uses last duplicate", async () => {
  assert.deepEqual(parseTeacherName("  101  22 นายศุภพล  แดงประทีป "), {
    name_prefix: "นาย",
    first_name: "ศุภพล",
    last_name: "แดงประทีป",
  });
  assert.deepEqual(parseTeacherName("001 นางสาว ทดสอบ ระบบ"), {
    name_prefix: "นางสาว",
    first_name: "ทดสอบ",
    last_name: "ระบบ",
  });
  assert.equal(parseTeacherName(" ๑๐๑ นายศุภพล แดงประทีป").first_name, "ศุภพล");
  assert.throws(() => parseTeacherName("101 นายชื่อเดียว"), /นามสกุล/);
  const book = new ExcelJS.Workbook();
  const first = book.addWorksheet("แรก"),
    last = book.addWorksheet("สุดท้าย");
  first.addRow([...teacherColumns]);
  last.addRow([...teacherColumns]);
  first.addRow(["0000000000001", "101 นายศุภพล แดงประทีป", "คณิตศาสตร์"]);
  last.addRow(["0000000000001", "222 นายศุภพล แดงประทีป", "วิทยาศาสตร์"]);
  const roundtrip = new ExcelJS.Workbook();
  await roundtrip.xlsx.load(
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  const parsed = readTeacherWorkbook(roundtrip);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.rows[0].citizen_id, "0000000000001");
  assert.equal(parsed.rows[0].learning_subject_group, "วิทยาศาสตร์");
  last.addRow([123, "101 นายศุภพล แดงประทีป", "คณิตศาสตร์"]);
  last.addRow(["1000000000002", "101 แยกไม่ได้", "คณิตศาสตร์"]);
  const bad = readTeacherWorkbook(book);
  assert.equal(bad.errors.length, 2);
  assert.ok(bad.errors.every((value) => value.includes("ชีท สุดท้าย แถว")));
  const missing = book.addWorksheet("หัวผิด");
  missing.addRow(["รหัสผู้ใช้", "ผู้ใช้"]);
  assert.ok(
    readTeacherWorkbook(book).errors.some((value) => value.includes("หัวผิด")),
  );
  assert.equal(
    teacherRegistrySchema
      .safeExtend({})
      .safeParse({ ...input, first_name: "x".repeat(150) }).success,
    false,
  );
});

test("staff identity hash is stable while encryption is randomized and bound to UUID", () => {
  assert.equal(
    staffCitizenHash(input.citizen_id, secret),
    staffCitizenHash(input.citizen_id, secret),
  );
  assert.notEqual(
    staffCitizenHash(input.citizen_id, secret),
    staffCitizenHash("1000000000002", secret),
  );
  const first = encryptStaffCitizenId(input.citizen_id, uuid(2), secret);
  assert.notEqual(
    first,
    encryptStaffCitizenId(input.citizen_id, uuid(2), secret),
  );
  assert.equal(decryptStaffCitizenId(first, uuid(2), secret), input.citizen_id);
  assert.throws(() => decryptStaffCitizenId(first, uuid(3), secret));
});

function mockStore() {
  let token: string | null = null;
  let attemptedToken = "";
  const calls: string[] = [];
  const store: RegisteredTeacherStore = {
    async consume() {
      calls.push("limit");
      return true;
    },
    async claim(_hash, _first, _last, attempt) {
      calls.push("claim");
      attemptedToken = attempt;
      return { id: uuid(2), token: attempt, pending: false };
    },
    async create(id, _email, _password, attempt) {
      assert.equal(id, uuid(2));
      calls.push("create");
      token = attempt;
    },
    async authToken() {
      calls.push("verify");
      return token;
    },
    async finish(_id, attempt, success) {
      assert.equal(attempt, attemptedToken);
      calls.push(success ? "finish" : "release");
    },
  };
  return {
    store,
    calls,
    setToken(value: string | null) {
      token = value;
    },
    getToken() {
      return attemptedToken;
    },
  };
}

test("registration rejects invalid, absent, mismatched and existing identities before creating Auth; rate limits", async () => {
  const fixture = mockStore();
  assert.equal(
    (
      await provisionRegisteredTeacher(
        { ...signup, citizen_id: "bad" },
        fixture.store,
        secret,
        "local",
      )
    ).status,
    400,
  );
  assert.equal(fixture.calls.length, 0);
  fixture.store.claim = async () => {
    throw new RegistryRegistrationError("REGISTRATION_DENIED");
  };
  assert.equal(
    (await provisionRegisteredTeacher(signup, fixture.store, secret, "local"))
      .status,
    403,
  );
  assert.ok(!fixture.calls.includes("create"));
  fixture.store.claim = async () => {
    throw new RegistryRegistrationError("REGISTRATION_EXISTS");
  };
  assert.equal(
    (await provisionRegisteredTeacher(signup, fixture.store, secret, "local"))
      .status,
    409,
  );
  fixture.store.consume = async () => false;
  assert.equal(
    (await provisionRegisteredTeacher(signup, fixture.store, secret, "local"))
      .status,
    429,
  );
});

test("registration verifies Auth attempt ownership, reconciles lost create responses and retains uncertain reservations", async () => {
  const normal = mockStore();
  assert.deepEqual(
    await provisionRegisteredTeacher(signup, normal.store, secret, "local"),
    { status: 200, body: { success: true } },
  );
  assert.deepEqual(normal.calls, [
    "limit",
    "claim",
    "create",
    "verify",
    "finish",
  ]);
  const lost = mockStore(),
    original = lost.store.create;
  lost.store.create = async (...args) => {
    await original(...args);
    throw new Error("lost response after commit");
  };
  assert.equal(
    (await provisionRegisteredTeacher(signup, lost.store, secret, "local"))
      .status,
    200,
  );
  const uncertain = mockStore();
  uncertain.store.create = async () => {
    throw new Error("timeout");
  };
  assert.equal(
    (await provisionRegisteredTeacher(signup, uncertain.store, secret, "local"))
      .status,
    503,
  );
  assert.ok(!uncertain.calls.includes("release"));
  const rejected = mockStore();
  rejected.store.create = async () => {
    throw new RegistryRegistrationError("weak_password");
  };
  assert.equal(
    (await provisionRegisteredTeacher(signup, rejected.store, secret, "local"))
      .status,
    400,
  );
  assert.ok(rejected.calls.includes("release"));
  const other = mockStore();
  other.store.authToken = async () => "another-attempt";
  assert.equal(
    (await provisionRegisteredTeacher(signup, other.store, secret, "local"))
      .status,
    503,
  );
  assert.ok(
    !other.calls.includes("release") && !other.calls.includes("finish"),
  );
});

test("registry import, reservation, reset and re-registration preserve identity, roles, history and reject old sessions", async () => {
  const db = await loadTestDatabase();
  const actor = uuid(1),
    teacher = uuid(2),
    student = uuid(3),
    grade = uuid(4),
    session = uuid(5),
    claimToken = uuid(6);
  const hash = staffCitizenHash(input.citizen_id, secret),
    emails = staffLoginEmails(input.citizen_id, secret);
  const as = async (role = "service_role", id = actor, sessionId?: string) => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id, JSON.stringify(sessionId ? { session_id: sessionId } : {})],
    );
    await db.exec(`set role ${role}`);
  };
  const row = (
    revision: number | null,
    group = input.learning_subject_group,
  ) => ({
    id: teacher,
    expected_revision: revision,
    name_prefix: input.name_prefix,
    first_name: input.first_name,
    last_name: input.last_name,
    learning_subject_group: group,
    hash,
    emails,
    citizen_id_encrypted: encryptStaffCitizenId(
      input.citizen_id,
      teacher,
      secret,
    ),
  });
  const save = (value: object) =>
    db.query("select save_teacher_registry($1,$2) result", [actor, value]);
  const claim = (
    token = claimToken,
    first = input.first_name,
    last = input.last_name,
  ) =>
    db.query<{ result: { id: string; token: string; pending: boolean } }>(
      "select claim_teacher_registration($1,$2,$3,$4,$5) result",
      [hash, first, last, token, emails],
    );
  try {
    await db.query("insert into auth.users(id) values($1),($2)", [
      actor,
      student,
    ]);
    await db.query(
      "insert into profiles(id,role,full_name,student_code) values($1,'admin','Admin',null),($2,'student','Student','10001')",
      [actor, student],
    );
    await as("anon");
    await assert.rejects(() => save(row(null)), /permission denied/);
    await as("authenticated", student);
    await assert.rejects(() => save(row(null)), /permission denied/);
    await as();
    const preview = (
      await db.query<{
        result: { id: string | null; expected_revision: number | null }[];
      }>("select preview_teacher_registry($1,$2) result", [
        actor,
        [{ hash, emails }],
      ])
    ).rows[0].result;
    assert.equal(preview[0].id, null);
    await save(row(null));
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from auth.users where id=$1", [teacher])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      1,
    );
    await db.query(
      "select set_staff_roles($1,ARRAY['teacher','academic']::app_role[])",
      [teacher],
    );
    const revision = Number(
      (
        await db.query<{ account_revision: number }>(
          "select account_revision from profiles where id=$1",
          [teacher],
        )
      ).rows[0].account_revision,
    );
    await as();
    await save(row(revision, "วิทยาศาสตร์"));
    await assert.rejects(
      () => save(row(revision, "ภาษาไทย")),
      /ACCOUNT_CHANGED/,
    );
    await assert.rejects(() => claim(claimToken, "ผิด"), /REGISTRATION_DENIED/);
    const reservation = (await claim(claimToken, `  ${input.first_name}  `))
      .rows[0].result;
    assert.equal(reservation.id, teacher);
    assert.equal(reservation.pending, false);
    const concurrent = (await claim(uuid(7))).rows[0].result;
    assert.equal(concurrent.pending, true);
    assert.equal(concurrent.token, claimToken);
    await assert.rejects(() => save(row(revision + 1)), /REGISTRY_BUSY/);
    await as("authenticated");
    await assert.rejects(
      () =>
        db.query("select admin_delete_account($1,'teacher',$2)", [
          teacher,
          revision + 1,
        ]),
      /REGISTRY_BUSY/,
    );
    await db.exec("reset role");
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      teacher,
      emails[0],
    ]);
    await as();
    await db.query("select finish_teacher_registration($1,$2,true)", [
      teacher,
      claimToken,
    ]);
    await assert.rejects(() => claim(uuid(8)), /REGISTRATION_EXISTS/);
    await db.exec("reset role");
    await db.query("insert into auth.sessions values($1,$2)", [
      session,
      teacher,
    ]);
    await db.query("select activate_login_role($1,$2,'teacher')", [
      session,
      teacher,
    ]);
    await db.query(
      `insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id)
      values($1,'C1','Course',1,'ม.4/1',ARRAY['Teacher'],'10001','Student',1,2569,1,'0',$2,ARRAY[$3]::uuid[])`,
      [grade, student, teacher],
    );
    await db.query(
      "insert into grade_reset_history(record_id,student_id,teacher_id,record_snapshot,reset_reason) values($1,$2,ARRAY[$3]::uuid[],'{}','import_overwrite')",
      [grade, student, teacher],
    );
    await as("authenticated", teacher, session);
    assert.equal(
      (await db.query<{ role: string }>("select my_role() role")).rows[0].role,
      "teacher",
    );
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      1,
    );
    await db.exec("reset role");
    const before = (
      await db.query<{ account_revision: number }>(
        "select account_revision from profiles where id=$1",
        [teacher],
      )
    ).rows[0].account_revision;
    await as("authenticated");
    await assert.rejects(
      () => db.query("select admin_delete_account($1,'teacher',0)", [teacher]),
      /ACCOUNT_CHANGED/,
    );
    await db.query("select admin_delete_account($1,'teacher',$2)", [
      teacher,
      before,
    ]);
    const list = (
      await db.query<{
        result: {
          items: {
            id: string;
            has_auth: boolean;
            learning_subject_group: string;
          }[];
        };
      }>("select admin_account_list('teacher') result")
    ).rows[0].result;
    assert.equal(list.items[0].has_auth, false);
    assert.equal(list.items[0].learning_subject_group, "วิทยาศาสตร์");
    await as("authenticated", teacher, session);
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      0,
    );
    await assert.rejects(
      () =>
        db.query(
          "select delete_push_subscription('https://example.invalid/old')",
        ),
      /ACCOUNT_FORBIDDEN/,
    );
    assert.equal(
      (await db.query<{ role: null }>("select my_role() role")).rows[0].role,
      null,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select * from profile_roles where profile_id=$1", [
          teacher,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from grade_records where id=$1", [grade])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query("select * from grade_reset_history where record_id=$1", [
          grade,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from audit_log where actor_id=$1 and action='teacher_registered'",
          [teacher],
        )
      ).rows.length,
      1,
    );
    await as();
    await claim(uuid(9));
    await db.exec("reset role");
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      teacher,
      emails[0],
    ]);
    await as();
    await db.query("select finish_teacher_registration($1,$2,true)", [
      teacher,
      uuid(9),
    ]);
    await as("authenticated", teacher, session);
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query<{ role: null }>("select my_role() role")).rows[0].role,
      null,
    );
    await as("authenticated", teacher); // Legacy no-session tokens must also stay revoked.
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      0,
    );
    await db.exec("reset role");
    await db.query("insert into auth.sessions values($1,$2)", [
      uuid(10),
      teacher,
    ]);
    await db.query("select activate_login_role($1,$2,'academic')", [
      uuid(10),
      teacher,
    ]);
    await as("authenticated", teacher, uuid(10));
    assert.equal(
      (await db.query<{ role: string }>("select my_role() role")).rows[0].role,
      "academic",
    );
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      1,
    );
    await as("authenticated");
    await db.query("select admin_reset_academic($1,$2)", [
      teacher,
      "นายศุภพล แดงประทีป",
    ]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from profiles where id=$1", [teacher])).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("select * from auth.users where id=$1", [teacher])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from profile_roles where profile_id=$1", [
          teacher,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});

test("registry matches legacy accounts by identity only, rejects ambiguity and protects storage/admin; reset failures are atomic", async () => {
  const db = await loadTestDatabase();
  const actor = uuid(11),
    teacher = uuid(12),
    hash = staffCitizenHash(input.citizen_id, secret),
    emails = staffLoginEmails(input.citizen_id, secret);
  const asAdmin = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
    await db.exec("set role authenticated");
  };
  try {
    await db.query(
      "insert into auth.users(id,email) values($1,'admin@example.test'),($2,$3)",
      [actor, teacher, emails[0]],
    );
    await db.query(
      "insert into profiles(id,role,full_name) values($1,'admin','Admin'),($2,'teacher','Teacher')",
      [actor, teacher],
    );
    await db.exec("set role service_role");
    const preview = (
      await db.query<{ result: { id: string }[] }>(
        "select preview_teacher_registry($1,$2) result",
        [actor, [{ hash, emails }]],
      )
    ).rows[0].result;
    assert.equal(preview[0].id, teacher);
    await asAdmin();
    await assert.rejects(
      () => db.query("select admin_delete_account($1,'teacher',0)", [teacher]),
      /REGISTRY_IDENTITY_MISSING/,
    );
    await db.exec("reset role; set role service_role");
    await assert.rejects(
      () => db.query("select register_teacher_profile($1,'{}')", [uuid(13)]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into profiles(id,role,full_name,staff_citizen_hash) values($1,'teacher','Same name is irrelevant',$2)",
      [uuid(13), hash],
    );
    await db.exec("set role service_role");
    await assert.rejects(
      () =>
        db.query("select preview_teacher_registry($1,$2)", [
          actor,
          [{ hash, emails }],
        ]),
      /REGISTRY_AMBIGUOUS/,
    );
    await db.exec("reset role");
    await db.exec("alter table storage.objects add column owner_id text");
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('assignment-files','owned',$1)",
      [teacher],
    );
    await asAdmin();
    await assert.rejects(
      () => db.query("select admin_delete_account($1,'teacher',0)", [teacher]),
      /REGISTRY_STORAGE/,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from auth.users where id=$1", [teacher])).rows
        .length,
      1,
    );
    await db.query("delete from profiles where id=$1", [uuid(13)]);
    await db.exec("set role service_role");
    await db.query("select backfill_staff_identity($1,$2,$3)", [
      teacher,
      hash,
      {
        name_prefix: "นาย",
        first_name: "ศุภพล",
        last_name: "แดงประทีป",
        citizen_id_encrypted: encryptStaffCitizenId(
          input.citizen_id,
          teacher,
          secret,
        ),
      },
    ]);
    await db.exec("reset role");
    await db.exec(
      "delete from storage.objects; create table reset_blocker(id uuid references auth.users(id))",
    );
    await db.query("insert into reset_blocker values($1)", [teacher]);
    await asAdmin();
    await assert.rejects(
      () => db.query("select admin_delete_account($1,'teacher',1)", [teacher]),
      /foreign key/,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ account_revision: number }>(
          "select account_revision from profiles where id=$1",
          [teacher],
        )
      ).rows[0].account_revision,
      1,
    );
    await db.exec("delete from reset_blocker");
    await db.query(
      "select set_staff_roles($1,ARRAY['teacher','admin']::app_role[])",
      [teacher],
    );
    await asAdmin();
    await assert.rejects(
      () => db.query("select admin_delete_account($1,'teacher',2)", [teacher]),
      /ACCOUNT_PROTECTED/,
    );
    await assert.rejects(
      () => db.query("select admin_delete_account($1,'teacher',0)", [actor]),
      /ACCOUNT_PROTECTED/,
    );
    await assert.rejects(
      () =>
        db.query("select claim_teacher_registration($1,'a','b',$2,$3)", [
          hash,
          uuid(14),
          emails,
        ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
