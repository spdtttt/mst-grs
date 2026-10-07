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

async function importTables(names: string[]) {
  const headers = Object.keys(columns);
  const rows = names.map((student_name, i) => {
    const row = {
      ...base,
      teacher_name: "ครู ตัวอย่าง",
      student_code: `0012${i}`,
      student_name,
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
  return tables;
}

test("CSV, TSV and XLSX previews all contain full student prefixes", async () => {
  const tables = await importTables(examples.map(({ short }) => `${short} ทดสอบ ใจดี`));
  for (const table of tables) {
    const result = parseRows(table[0].map(String), table.slice(1));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.rows.map((row) => row.student_name),
      examples.map(({ full }) => `${full}ทดสอบ ใจดี`),
    );
  }
});

test("CSV, TSV and XLSX imports match student codes and store registered names", async () => {
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
    const names = ["ทดสอบ ใจดี", "ด.ช. ทดสอบ ใจดี", "คนอื่น นามสกุลอื่น"];
    const tables = await importTables(names);
    const expected = examples.map(({ full }, i) => ({
      student_id: uuid(i + 3),
      student_code: `0012${i}`,
      student_name: `${full}ทดสอบ ใจดี`,
    }));
    for (const [i, table] of tables.entries()) {
      const parsed = parseRows(table[0].map(String), table.slice(1));
      assert.deepEqual(parsed.errors, []);
      assert.equal(parsed.rows[0].student_name, names[0]);
      assert.deepEqual(parsed.rows.map(row => row.student_code), ["00120", "00121", "00122"]);
      // Exercise both the current RPC and its compatibility wrapper.
      const rpc = i === 1 ? "import_grades" : "import_grades_overwrite";
      const result = await db.query<{
        result: { inserted: number; updated: number; skipped: number };
      }>(`select ${rpc}($1::jsonb) result`, [JSON.stringify(parsed.rows)]);
      assert.deepEqual(result.rows[0].result, {
        inserted: i === 0 ? 3 : 0,
        updated: i === 0 ? 0 : 3,
        skipped: 0,
      });
      await db.exec("reset role");
      assert.deepEqual((await db.query(
        "select student_id,student_code,student_name from grade_records order by student_code",
      )).rows, expected);
      await db.exec("set role authenticated");
    }

    // Refresh the current record from the account, retaining the original snapshot.
    await db.exec("reset role");
    const renamed = "นางสาวชื่อใหม่ ใจดี";
    await db.query("update profiles set full_name=$1 where id=$2", [renamed, uuid(3)]);
    const profilesBefore = (await db.query("select * from profiles order by id")).rows;
    await db.exec("set role authenticated");
    const replacement = importSchema.parse({ ...base, student_code: "00120", student_name: "ชื่อเก่า ใจดี" });
    await db.query("select import_grades_overwrite($1::jsonb)", [JSON.stringify([replacement])]);
    await db.exec("reset role");
    assert.equal((await db.query<{ student_name: string }>(
      "select student_name from grade_records where student_code='00120'",
    )).rows[0].student_name, renamed);
    const history = (await db.query<{ student_name: string }>(
      "select record_snapshot->>'student_name' student_name from grade_reset_history where student_id=$1",
      [uuid(3)],
    )).rows;
    assert.equal(history.length, 3);
    assert.ok(history.every(row => row.student_name === expected[0].student_name));
    assert.deepEqual((await db.query("select * from profiles order by id")).rows, profilesBefore);

    // Missing codes (including a code with its leading zeroes removed) roll back
    // prior inserts, overwrites, snapshots and audit entries in the same batch.
    async function snapshot() {
      return {
        records: (await db.query("select * from grade_records order by id")).rows,
        history: (await db.query("select * from grade_reset_history order by id")).rows,
        audit: (await db.query("select * from audit_log order by id")).rows,
      };
    }
    const before = await snapshot();
    for (const missingCode of ["99999", "120"]) {
      await db.exec("set role authenticated");
      await assert.rejects(() => db.query("select import_grades_overwrite($1::jsonb)", [
        JSON.stringify([
          { ...replacement, course_name: "ชื่อวิชาที่ไม่ควรบันทึก" },
          { ...replacement, course_code: "NEW" },
          { ...replacement, student_code: missingCode },
        ]),
      ]), /ไม่พบบัญชีนักเรียนเลขประจำตัว/);
      await db.exec("reset role");
      assert.deepEqual(await snapshot(), before);
    }
  } finally {
    await db.close();
  }
});
