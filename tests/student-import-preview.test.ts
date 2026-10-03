import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { studentColumns } from "../src/lib/students";
import { readStudentWorkbook } from "../src/lib/student-workbook";
import {
  summarizeStudentImport,
  type StudentImportSummary,
} from "../src/lib/student-import-preview";

const codes = (count: number) =>
  Array.from({ length: count }, (_, i) => String(30000 + i));

test("2250 students across XLSX sheets are summarized through bounded database requests", async () => {
  const workbook = new ExcelJS.Workbook();
  const ids = codes(2250);
  for (let n = 0; n < 2; n++) {
    const sheet = workbook.addWorksheet(`Sheet ${n + 1}`);
    sheet.addRow(Object.keys(studentColumns));
    ids
      .slice(n * 1125, (n + 1) * 1125)
      .forEach((code, i) =>
        sheet.addRow([
          "1000000000001",
          code,
          "นาย",
          "ทดสอบ",
          "ระบบ",
          `ม.${n + 1}/1`,
          (i % 40) + 1,
        ]),
      );
  }
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const parsed = await readStudentWorkbook(loaded);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 2250);
  const db = await loadTestDatabase();
  try {
    const id = (n: number) =>
      `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    for (let n = 1; n <= 3; n++)
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
    await db.query(
      "insert into profiles(id,role,full_name) values($1,'admin','Admin')",
      [id(1)],
    );
    await db.query(
      "insert into profiles(id,role,full_name,student_code) values($1,'student','Existing',$2)",
      [id(2), ids[0]],
    );
    await db.query(
      "insert into profiles(id,role,full_name,student_code,student_status,student_status_year) values($1,'student','Archived',$2,'not_graduated',2569)",
      [id(3), ids.at(-1)],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1),
    ]);
    await db.exec("set role authenticated");
    const batches: string[][] = [];
    const result = await summarizeStudentImport(
      parsed.rows.map((row) => row.student_code),
      async (batch) => {
        batches.push(batch);
        const { rows } = await db.query<{ data: StudentImportSummary }>(
          "select admin_student_import_summary($1) data",
          [batch],
        );
        return { data: rows[0].data };
      },
    );
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [2000, 250],
    );
    assert.deepEqual(batches.flat(), ids);
    assert.deepEqual(result, {
      data: { created: 2248, updated: 2, archived: 1 },
    });
  } finally {
    await db.close();
  }
});

test("preview covers exact boundaries and trailing batches without dropping or double counting students", async () => {
  for (const [count, sizes] of [
    [1, [1]],
    [2000, [2000]],
    [4000, [2000, 2000]],
    [4001, [2000, 2000, 1]],
  ] as const) {
    const ids = codes(count);
    const batches: string[][] = [];
    const result = await summarizeStudentImport(ids, async (batch) => {
      batches.push(batch);
      return { data: { created: batch.length, updated: 0, archived: 0 } };
    });
    assert.deepEqual(
      batches.map((batch) => batch.length),
      sizes,
    );
    assert.deepEqual(batches.flat(), ids);
    assert.equal(result.data?.created, count);
  }
});

test("preview never returns partial totals after an error, invalid response or cancellation", async () => {
  let calls = 0;
  const failed = await summarizeStudentImport(codes(4001), async (batch) => {
    calls++;
    return calls === 2
      ? { error: "Database unavailable" }
      : { data: { created: batch.length, updated: 0, archived: 0 } };
  });
  assert.deepEqual(failed, { error: "Database unavailable" });
  assert.equal(calls, 2);
  const invalid = await summarizeStudentImport(codes(1), async () => ({
    data: { created: 0, updated: 0, archived: 0 },
  }));
  assert.ok(invalid.error);
  assert.equal(invalid.data, undefined);
  let cancelled = false;
  calls = 0;
  const stopped = await summarizeStudentImport(
    codes(2250),
    async (batch) => {
      calls++;
      cancelled = true;
      return { data: { created: batch.length, updated: 0, archived: 0 } };
    },
    () => !cancelled,
  );
  assert.deepEqual(stopped, { cancelled: true });
  assert.equal(calls, 1);
  const duplicate = await summarizeStudentImport(
    [...codes(2000), "30000"],
    async () => {
      throw new Error("must not call the server");
    },
  );
  assert.ok(duplicate.error);
});
