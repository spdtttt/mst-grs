import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  columns,
  importSchema,
  parseDelimited,
  parseRows,
} from "../src/lib/import";
import { worksheetRows } from "../src/lib/import-excel";
import { studentFullName } from "../src/lib/students";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";

const base = {
  course_code: "ค31101",
  course_name: "คณิตศาสตร์",
  credits: 1,
  classroom: "ม.4/2",
  teacher_name: ["ครู ตัวอย่าง"],
  student_code: "00123",
  student_name: "นักเรียน ตัวอย่าง",
  roll_number: 1,
  academic_year: 2569,
  semester: 1,
  original_grade: "ร",
};
const examples = [
  { short: "น.ส.", full: "นางสาว" },
  { short: "ด.ช.", full: "เด็กชาย" },
  { short: "ด.ญ.", full: "เด็กหญิง" },
];

test("student import expands only leading abbreviations and is safe to parse twice", () => {
  for (const { short, full } of examples) {
    const expected = studentFullName({
      name_prefix: full,
      first_name: "ทดสอบ",
      last_name: "ใจดี",
    });
    for (const name of [
      `${short}ทดสอบ ใจดี`,
      `${short} ทดสอบ ใจดี`,
      `  ${short}  ทดสอบ ใจดี  `,
      `${short.replaceAll(".", ". ")}ทดสอบ ใจดี`,
      `${short}\u00a0ทดสอบ ใจดี`,
    ]) {
      const parsed = importSchema.parse({ ...base, student_name: name });
      assert.equal(parsed.student_name, expected);
      assert.deepEqual(importSchema.parse(parsed), parsed);
    }
  }
  for (const name of [
    "นางสาวทดสอบ ใจดี",
    "เด็กชายทดสอบ ใจดี",
    "เด็กหญิงทดสอบ ใจดี",
    "นายทดสอบ ใจดี",
    "ทดสอบ น.ส.ใจดี",
    "ด.ญาติ ใจดี",
  ]) {
    assert.equal(
      importSchema.parse({ ...base, student_name: name }).student_name,
      name,
    );
  }
  const teacher = "น.ส.ทดสอบ ใจดี";
  assert.deepEqual(
    importSchema.parse({ ...base, teacher_name: [teacher] }).teacher_name,
    [teacher],
  );
  assert.equal(
    importSchema.safeParse({ ...base, student_name: null }).success,
    false,
  );
  // Validate the expanded name's length, even when the abbreviated input fits.
  assert.equal(
    importSchema.safeParse({ ...base, student_name: "น.ส." + "ก".repeat(146) })
      .success,
    false,
  );
});

test("CSV, TSV and XLSX previews all contain full student prefixes", async () => {
  const headers = Object.keys(columns);
  const rows = examples.map(({ short }, i) => {
    const row = {
      ...base,
      teacher_name: "ครู ตัวอย่าง",
      student_code: `0012${i}`,
      student_name: `${short} ทดสอบ ใจดี`,
    };
    return Object.values(columns).map((key) => row[key]);
  });
  const tables: unknown[][][] = [",", "\t"].map((delimiter) =>
    parseDelimited(
      [headers, ...rows].map((row) => row.join(delimiter)).join("\n"),
    ),
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("ข้อมูล");
  sheet.addRows([headers, ...rows]);
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(await workbook.xlsx.writeBuffer());
  tables.push(worksheetRows(read.worksheets[0]));
  for (const table of tables) {
    const result = parseRows(table[0].map(String), table.slice(1));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.rows.map((row) => row.student_name),
      examples.map(({ full }) => `${full}ทดสอบ ใจดี`),
    );
  }
});

test("normalized imports match full profile names in PostgreSQL and still reject different names", async () => {
  const db = await loadTestDatabase();
  const uuid = (n: number) =>
    `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  try {
    for (const [id, role, name] of [
      [uuid(1), "admin", "Admin"],
      [uuid(2), "teacher", "ครู ตัวอย่าง"],
    ]) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2,$3)",
        [id, role, name],
      );
    }
    for (const [i, { full }] of examples.entries()) {
      await db.query("insert into auth.users(id) values($1)", [uuid(i + 3)]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code) values($1,'student',$2,$3)",
        [uuid(i + 3), `${full}ทดสอบ ใจดี`, `0012${i}`],
      );
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uuid(1),
    ]);
    await db.exec("set role authenticated");
    await db.exec(
      "select update_schedule(now()-interval '1 day',now()+interval '2 days','test')",
    );
    const rows = examples.map(({ short }, i) =>
      importSchema.parse({
        ...base,
        student_code: `0012${i}`,
        student_name: `${short} ทดสอบ ใจดี`,
      }),
    );
    const result = await db.query<{
      result: { inserted: number; updated: number; skipped: number };
    }>("select import_grades_overwrite($1::jsonb) result", [
      JSON.stringify(rows),
    ]);
    assert.deepEqual(result.rows[0].result, {
      inserted: 3,
      updated: 0,
      skipped: 0,
    });
    await assert.rejects(
      () =>
        db.query("select import_grades_overwrite($1::jsonb)", [
          JSON.stringify([
            importSchema.parse({
              ...base,
              student_code: "00120",
              student_name: "น.ส. คนอื่น ใจดี",
            }),
          ]),
        ]),
      /ชื่อนักเรียนไม่ตรงกับบัญชี/,
    );
    await db.exec("reset role");
    const saved = await db.query<{ student_name: string }>(
      "select student_name from grade_records order by student_code",
    );
    assert.deepEqual(
      saved.rows.map((row) => row.student_name),
      examples.map(({ full }) => `${full}ทดสอบ ใจดี`),
    );
  } finally {
    await db.close();
  }
});
