import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  studentSchema,
  studentColumns,
  studentFullName,
  parseStudentRows,
  studentLevel,
  type StudentInput,
} from "../src/lib/students";
import { worksheetRows } from "../src/lib/import-excel";
import {
  provisionStudent,
  StudentProvisionError,
  type StudentAccountStore,
} from "../src/lib/student-provisioning";
import { loginEmail, identityPassword } from "../src/lib/identity";
import { readStudentWorkbook } from "../src/lib/student-workbook";
import { encryptStudentCitizenId } from "../src/lib/student-identity";
import { createDecipheriv, createHmac } from "node:crypto";

const sample = [
  "1-0000-00000-00-1",
  "10001",
  "เด็กชาย",
  "ศุภพล",
  "แดงประทีป",
  "ม.4/9",
  "9",
];
const student = studentSchema.parse(
  Object.fromEntries(
    Object.values(studentColumns).map((key, i) => [key, sample[i]]),
  ),
);
const secret = "test-only-secret-with-at-least-32-characters";

test("student imports normalize citizen IDs, join names and preserve leading zero codes", () => {
  assert.equal(student.citizen_id, "1000000000001");
  assert.equal(studentFullName(student), "เด็กชายศุภพล แดงประทีป");
  const result = parseStudentRows(Object.keys(studentColumns), [
    [...sample.slice(0, 1), "00123", ...sample.slice(2)],
    [],
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].student_code, "00123");
  assert.equal(studentLevel("ม.4/9"), 4);
  assert.equal(studentLevel("4/9"), 4);
  assert.equal(studentLevel("unknown"), null);
});

test("student imports reject malformed identities, names, rooms, rolls and duplicate rows without leaking IDs", () => {
  for (const change of [
    { citizen_id: "short" },
    { student_code: "1234" },
    { first_name: "" },
    { classroom: "ม.7/1" },
    { roll_number: "" },
    { roll_number: "1.5" },
  ])
    assert.equal(
      studentSchema.safeParse({ ...student, ...change }).success,
      false,
    );
  assert.throws(
    () => parseStudentRows(["รหัสนักเรียน"], [sample]),
    /ไม่พบคอลัมน์/,
  );
  assert.throws(
    () => parseStudentRows([...Object.keys(studentColumns), "ชื่อ"], [sample]),
    /หัวคอลัมน์/,
  );
  const invalid = parseStudentRows(Object.keys(studentColumns), [
    ["sensitive-invalid-id", ...sample.slice(1)],
    sample,
    sample,
  ]);
  assert.equal(invalid.errors.length, 2);
  assert.equal(invalid.rows.length, 1);
  assert.ok(!invalid.errors.join(" ").includes("sensitive-invalid-id"));
  assert.throws(
    () =>
      parseStudentRows(Object.keys(studentColumns), Array(2001).fill(sample)),
    /2,000/,
  );
});

test("XLSX student reading uses the specified columns, cached formulas and formatted string IDs", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("students");
  sheet.addRow([...Object.keys(studentColumns), "unused"]);
  sheet.addRow(sample);
  sheet.getCell("B2").value = "00123";
  sheet.getCell("D2").value = { formula: '"ศุภพล"', result: "ศุภพล" };
  sheet.getCell("H2").value = { formula: "1+1" }; // Unused formulas are ignored.
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const table = worksheetRows(
    reloaded.worksheets[0],
    Object.keys(studentColumns),
  );
  const result = parseStudentRows((table.shift() ?? []).map(String), table);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].student_code, "00123");
  assert.equal(studentFullName(result.rows[0]), "เด็กชายศุภพล แดงประทีป");
  sheet.getCell("D2").value = { formula: '"ศุภพล"' };
  assert.throws(
    () => worksheetRows(sheet, Object.keys(studentColumns)),
    /ไม่มีค่าผลลัพธ์/,
  );
});

test("student workbook reads all six grade sheets and detects duplicates and errors across sheets", async () => {
  const book = new ExcelJS.Workbook();
  for (let n = 1; n <= 6; n++) {
    const sheet = book.addWorksheet(`ม.${n}`);
    sheet.addRow(Object.keys(studentColumns));
    sheet.addRow([sample[0], `1000${n}`, ...sample.slice(2, 5), `ม.${n}/1`, n]);
  }
  const visited: string[] = [];
  const parsed = await readStudentWorkbook(
    book,
    async (name, completed, total) => {
      visited.push(name);
      assert.equal(completed, visited.length - 1);
      assert.equal(total, 6);
    },
  );
  assert.deepEqual(visited, ["ม.1", "ม.2", "ม.3", "ม.4", "ม.5", "ม.6"]);
  assert.equal(parsed.rows.length, 6);
  assert.equal(parsed.sheets, 6);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.rows.map((s) => s.classroom),
    ["ม.1/1", "ม.2/1", "ม.3/1", "ม.4/1", "ม.5/1", "ม.6/1"],
  );
  book.worksheets[5].getCell("B2").value = "10001";
  book.worksheets[4].getCell("D2").value = "";
  const invalid = await readStudentWorkbook(book);
  assert.equal(invalid.errors.length, 2);
  assert.ok(
    invalid.errors.some(
      (e) => e.includes("ม.6") && e.includes("ซ้ำกับชีท ม.1"),
    ),
  );
  assert.ok(
    invalid.errors.some((e) => e.includes("ม.5") && e.includes("ชื่อ")),
  );
  assert.ok(!invalid.errors.join(" ").includes(sample[0]));
});

test("empty grade sheets with headers are allowed, and a malformed later sheet prevents confirmation", async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("ม.1").addRow(Object.keys(studentColumns));
  const populated = book.addWorksheet("ม.2");
  populated.addRow(Object.keys(studentColumns));
  populated.addRow(sample);
  assert.equal((await readStudentWorkbook(book)).rows.length, 1);
  const bad = book.addWorksheet("ม.3");
  bad.addRow(["wrong header"]);
  assert.match(
    (await readStudentWorkbook(book)).errors[0],
    /ชีท ม.3: ไม่พบคอลัมน์/,
  );
  await assert.rejects(
    () => readStudentWorkbook(new ExcelJS.Workbook()),
    /ไม่พบแผ่นงาน/,
  );
});

test("stored citizen IDs use authenticated encryption tied to the student, with fresh nonces", () => {
  const one = encryptStudentCitizenId(
    student.citizen_id,
    student.student_code,
    secret,
  );
  const two = encryptStudentCitizenId(
    student.citizen_id,
    student.student_code,
    secret,
  );
  assert.notEqual(one, two);
  assert.ok(!one.includes(student.citizen_id));
  const [, nonce, tag, ciphertext] = one.split(":");
  const key = createHmac("sha256", secret)
    .update("mst-grs:student-citizen:v1")
    .digest();
  const decrypt = (code: string) => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonce, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    decipher.setAAD(Buffer.from(`student:${code}`));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
  };
  assert.equal(decrypt(student.student_code), "1000000000001");
  assert.throws(() => decrypt("10002"));
  assert.throws(() =>
    encryptStudentCitizenId("invalid", student.student_code, secret),
  );
});

function fakeStore(overrides: Partial<StudentAccountStore> = {}) {
  const calls: string[] = [];
  const store: StudentAccountStore = {
    async findProfile() {
      calls.push("find");
      return null;
    },
    async verifyAuth() {
      calls.push("verify");
      return true;
    },
    async createAuth(email, password) {
      calls.push("create");
      assert.equal(email, loginEmail("student:10001", secret));
      assert.equal(
        password,
        identityPassword("student", "1000000000001", secret),
      );
      assert.notEqual(password, student.citizen_id);
      return "new-id";
    },
    async saveProfile(id, value: StudentInput) {
      calls.push(`save:${id}`);
      assert.equal(studentFullName(value), "เด็กชายศุภพล แดงประทีป");
    },
    async deleteAuth(id) {
      calls.push(`delete:${id}`);
    },
    ...overrides,
  };
  return { store, calls };
}

test("new students create compatible Auth credentials before their profiles", async () => {
  const { store, calls } = fakeStore();
  assert.deepEqual(await provisionStudent(student, store, secret), {
    student_code: "10001",
    status: "created",
  });
  assert.deepEqual(calls, ["find", "create", "save:new-id"]);
});

test("existing students update names only, retaining their Auth identity and password", async () => {
  const { store, calls } = fakeStore({
    async findProfile() {
      return { id: "existing-id", role: "student" };
    },
    async verifyAuth(id, email) {
      calls.push("verify");
      assert.equal(id, "existing-id");
      assert.equal(email, loginEmail("student:10001", secret));
      return true;
    },
  });
  assert.equal(
    (
      await provisionStudent(
        { ...student, citizen_id: "9999999999999" },
        store,
        secret,
      )
    ).status,
    "updated",
  );
  assert.deepEqual(calls, ["verify", "save:existing-id"]);
});

test("Auth creation failure never creates a profile or prints credential errors", async () => {
  const { store, calls } = fakeStore({
    async createAuth() {
      throw new Error("sensitive upstream payload");
    },
  });
  const result = await provisionStudent(student, store, secret);
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, ["find"]);
  assert.ok(!result.message?.includes("sensitive"));
});

test("failed profile saves roll back only the newly created Auth account", async () => {
  const { store, calls } = fakeStore({
    async saveProfile() {
      throw new Error("failed");
    },
  });
  assert.equal(
    (await provisionStudent(student, store, secret)).status,
    "failed",
  );
  assert.deepEqual(calls, ["find", "create", "find", "delete:new-id"]);
  const existing = fakeStore({
    async findProfile() {
      return { id: "old-id", role: "student" };
    },
    async saveProfile() {
      throw new Error("failed");
    },
  });
  assert.equal(
    (await provisionStudent(student, existing.store, secret)).status,
    "failed",
  );
  assert.deepEqual(existing.calls, ["verify"]);
});

test("lost profile-save responses preserve an Auth account when the save already committed", async () => {
  let lookup = 0;
  const { store, calls } = fakeStore({
    async findProfile() {
      return ++lookup === 1 ? null : { id: "new-id", role: "student" };
    },
    async saveProfile() {
      throw new Error("network timeout after commit");
    },
  });
  assert.equal(
    (await provisionStudent(student, store, secret)).status,
    "created",
  );
  assert.deepEqual(calls, ["create"]);
});

test("mismatched Auth and failed rollback produce reviewable errors and leave existing accounts intact", async () => {
  const mismatch = fakeStore({
    async findProfile() {
      return { id: "old-id", role: "student" };
    },
    async verifyAuth() {
      return false;
    },
  });
  assert.equal(
    (await provisionStudent(student, mismatch.store, secret)).status,
    "failed",
  );
  assert.deepEqual(mismatch.calls, []);
  const rollback = fakeStore({
    async saveProfile() {
      throw new Error("failed");
    },
    async deleteAuth() {
      throw new Error("failed");
    },
  });
  assert.match(
    (await provisionStudent(student, rollback.store, secret)).message!,
    /ไม่สามารถยืนยัน/,
  );
  const duplicate = fakeStore({
    async createAuth() {
      throw new StudentProvisionError("Auth already exists; review profile");
    },
  });
  assert.equal(
    (await provisionStudent(student, duplicate.store, secret)).message,
    "Auth already exists; review profile",
  );
});
