import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { columns, parseRows } from "../src/lib/import";
import { worksheetRows } from "../src/lib/import-excel";
test("XLSX library reads Thai columns and preserves text IDs with patched UUID dependency", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("ข้อมูลตัวอย่าง");
  sheet.addRow([...Object.keys(columns), "รวม", "Q1"]);
  sheet.addRow([
    "ค31101",
    "คณิตศาสตร์",
    1.5,
    "ม.4/2",
    "ครู ทดสอบ",
    "00123",
    "นักเรียน ทดสอบ",
    1,
    2569,
    1,
    "ร",
    40,
    1,
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer);
  const data: unknown[][] = [];
  read.worksheets[0].eachRow((row) => {
    const cells = [];
    for (let i = 1; i <= 13; i++) cells.push(row.getCell(i).text);
    data.push(cells);
  });
  const parsed = parseRows(data[0].map(String), data.slice(1));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].student_code, "00123");
  assert.equal(Object.keys(parsed.rows[0]).length, 11);
  mkdirSync("test-results", { recursive: true });
  await workbook.xlsx.writeFile("test-results/import-fixture.xlsx");
});

test("XLSX ignores unused formula columns and reads cached required values without executing formulas", () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("data");
  sheet.addRow([...Object.keys(columns), "รวม"]);
  sheet.addRow([
    "ค31101",
    "คณิตศาสตร์",
    1,
    "ม.4/2",
    "ครู ทดสอบ",
    "00123",
    "นักเรียน ทดสอบ",
    1,
    2569,
    1,
    { formula: 'IF(1=1,"ร","0")', result: "ร" },
    { formula: "SUM(A2:B2)" },
  ]);
  const table = worksheetRows(sheet);
  const parsed = parseRows(table[0].map(String), table.slice(1));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].original_grade, "ร");
  sheet.getCell("K2").value = { formula: 'IF(1=1,"ร","0")' };
  assert.throws(() => worksheetRows(sheet), /ไม่มีค่าผลลัพธ์/);
});
