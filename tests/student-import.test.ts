import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runStudentBatch,
  STUDENT_BATCH_SIZE,
  sameOrigin,
} from "../src/lib/student-import";
import {
  prefetchStudentStore,
  provisionStudent,
  type StudentAccountStore,
} from "../src/lib/student-provisioning";
import { studentSchema, type StudentInput } from "../src/lib/students";
import { readStudentWorkbook } from "../src/lib/student-workbook";
import ExcelJS from "exceljs";
import { studentColumns } from "../src/lib/students";

const template = studentSchema.parse({
  citizen_id: "1000000000001",
  student_code: "10001",
  name_prefix: "เด็กชาย",
  first_name: "ทดสอบ",
  last_name: "ระบบ",
  classroom: "ม.1/1",
  roll_number: 1,
});
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ...template,
    student_code: String(10000 + i),
  }));
const secret = "test-only-secret-with-at-least-32-characters";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("2,005 students use 41 profile lookups, at most five concurrent workers, and preserve existing Auth", async () => {
  const profiles = new Map<
    string,
    { id: string; role: string; student_code: string }
  >();
  let lookup = 0,
    fresh = 0,
    creates = 0,
    verifies = 0,
    saves = 0,
    active = 0,
    peak = 0;
  const store: StudentAccountStore = {
    async findProfile(code) {
      fresh++;
      return profiles.get(code) ?? null;
    },
    async verifyAuth() {
      verifies++;
      await tick();
      return true;
    },
    async createAuth() {
      creates++;
      await tick();
      return `auth-${creates}`;
    },
    async saveProfile(id, student) {
      saves++;
      profiles.set(student.student_code, {
        id,
        role: "student",
        student_code: student.student_code,
      });
      await tick();
    },
    async deleteAuth() {
      assert.fail("Successful imports must not delete Auth");
    },
  };
  const all = rows(2005);
  async function run() {
    const results = [];
    for (let offset = 0; offset < all.length; offset += STUDENT_BATCH_SIZE) {
      const batch = all.slice(offset, offset + STUDENT_BATCH_SIZE);
      const cached = await prefetchStudentStore(
        batch.map((s) => s.student_code),
        store,
        async (codes) => {
          lookup++;
          assert.ok(codes.length <= 50);
          return codes.flatMap((code) =>
            profiles.has(code) ? [profiles.get(code)!] : [],
          );
        },
      );
      const result = await runStudentBatch(
        batch,
        async (student) => {
          active++;
          peak = Math.max(peak, active);
          try {
            return await provisionStudent(student, cached, secret);
          } finally {
            active--;
          }
        },
        async () => true,
      );
      assert.equal(result.cancelled, false);
      results.push(...result.results);
    }
    return results;
  }
  const created = await run();
  assert.equal(created.length, 2005);
  assert.ok(created.every((r) => r.status === "created"));
  assert.equal(lookup, 41);
  assert.equal(creates, 2005);
  assert.equal(fresh, 0);
  assert.equal(peak, 5);
  assert.deepEqual(
    created.map((r) => r.student_code),
    all.map((r) => r.student_code),
  );
  const updated = await run();
  assert.ok(updated.every((r) => r.status === "updated"));
  assert.equal(lookup, 82);
  assert.equal(creates, 2005);
  assert.equal(verifies, 2005);
  assert.equal(saves, 4010);
});

test("Cancel stops before the next wave, finishes only the five started accounts and preserves input order", async () => {
  let cancel = false,
    started = 0;
  let unblock!: () => void, ready!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const fiveStarted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const task = runStudentBatch(
    rows(50),
    async (student) => {
      if (++started === 5) ready();
      await inFlight;
      return { student_code: student.student_code, status: "created" };
    },
    async () => !cancel,
  );
  await fiveStarted;
  cancel = true;
  unblock();
  const result = await task;
  assert.equal(result.cancelled, true);
  assert.equal(started, 5);
  assert.equal(result.results.length, 5);
  assert.deepEqual(
    result.results.map((r) => r.student_code),
    rows(5).map((r) => r.student_code),
  );
  const before = await runStudentBatch(
    rows(50),
    async () => {
      assert.fail("No worker may start");
    },
    async () => false,
  );
  assert.deepEqual(before, { results: [], cancelled: true });
});

test("lost cancellation-state responses fail closed and retain completed results", async () => {
  let checks = 0,
    started = 0;
  const result = await runStudentBatch(
    rows(50),
    async (student) => {
      started++;
      return { student_code: student.student_code, status: "updated" };
    },
    async () => {
      if (++checks > 1) throw new Error("offline");
      return true;
    },
  );
  assert.equal(started, 5);
  assert.equal(result.results.length, 5);
  assert.match(result.error!, /หยุดเริ่มรายการใหม่/);
});

test("prefetched misses never replace fresh rollback checks after a committed profile save", async () => {
  let saved = false,
    fresh = false,
    deleted = false;
  const store: StudentAccountStore = {
    async findProfile(_code, options) {
      fresh = options?.fresh === true;
      return saved ? { id: "auth-new", role: "student" } : null;
    },
    async verifyAuth() {
      return true;
    },
    async createAuth() {
      return "auth-new";
    },
    async saveProfile() {
      saved = true;
      throw new Error("response lost after commit");
    },
    async deleteAuth() {
      deleted = true;
    },
  };
  const cached = await prefetchStudentStore(
    [template.student_code],
    store,
    async () => [],
  );
  const result = await provisionStudent(template, cached, secret);
  assert.equal(result.status, "created");
  assert.equal(fresh, true);
  assert.equal(deleted, false);
});

test("XLSX cancellation stops before checking further sheets and before any preview is returned", async () => {
  const book = new ExcelJS.Workbook();
  for (let n = 1; n <= 6; n++)
    book.addWorksheet(`ม.${n}`).addRow(Object.keys(studentColumns));
  const controller = new AbortController();
  let visited = 0;
  await assert.rejects(
    () =>
      readStudentWorkbook(
        book,
        async () => {
          visited++;
          controller.abort();
        },
        controller.signal,
      ),
    { name: "AbortError" },
  );
  assert.equal(visited, 1);
});

test("import control rejects absent, malformed and cross-origin request origins", () => {
  assert.equal(
    sameOrigin(
      "https://school.example/api/admin/students/import-control",
      "https://school.example",
    ),
    true,
  );
  assert.equal(
    sameOrigin("https://school.example/api", "https://evil.example"),
    false,
  );
  assert.equal(sameOrigin("https://school.example/api", null), false);
  assert.equal(sameOrigin("invalid", "https://school.example"), false);
});
