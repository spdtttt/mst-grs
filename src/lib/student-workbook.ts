import type { Workbook } from "exceljs";
import { worksheetRows } from "./import-excel";
import {
  parseStudentRows,
  studentColumns,
  type StudentInput,
} from "./students";

/** Validate every sheet before any account is created, including cross-sheet IDs. */
export async function readStudentWorkbook(
  book: Workbook,
  onSheet?: (name: string, completed: number, total: number) => Promise<void>,
  signal?: AbortSignal,
) {
  if (!book.worksheets.length) throw new Error("ไม่พบแผ่นงานในไฟล์");
  const rows: StudentInput[] = [],
    errors: string[] = [],
    seen = new Map<string, string>();
  for (const [index, sheet] of book.worksheets.entries()) {
    signal?.throwIfAborted();
    await onSheet?.(sheet.name, index, book.worksheets.length);
    signal?.throwIfAborted();
    try {
      const table = worksheetRows(sheet, Object.keys(studentColumns));
      const parsed = parseStudentRows((table.shift() ?? []).map(String), table);
      errors.push(
        ...parsed.errors.map((error) => `ชีท ${sheet.name}: ${error}`),
      );
      for (const student of parsed.rows) {
        const previousSheet = seen.get(student.student_code);
        if (previousSheet)
          errors.push(
            `ชีท ${sheet.name}: รหัสนักเรียน ${student.student_code} ซ้ำกับชีท ${previousSheet}`,
          );
        else {
          seen.set(student.student_code, sheet.name);
          rows.push(student);
        }
      }
    } catch (error) {
      errors.push(
        `ชีท ${sheet.name}: ${
          error instanceof Error &&
          /^(รองรับ|ไม่พบ|แถว|หัวคอลัมน์|นำเข้า)/.test(error.message)
            ? error.message
            : "ตรวจข้อมูลไม่สำเร็จ กรุณาตรวจสอบชีทนี้"
        }`,
      );
    }
  }
  if (!rows.length && !errors.length) errors.push("ไม่พบข้อมูลนักเรียนในไฟล์");
  return { rows, errors, sheets: book.worksheets.length };
}
