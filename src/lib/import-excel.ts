import type { Worksheet } from "exceljs";
import { columns } from "./import";

/** Reads cached values only. Formulas are never evaluated or executed. */
export function worksheetRows(sheet: Worksheet): unknown[][] {
  if (sheet.rowCount > 2001 || sheet.columnCount > 100)
    throw new Error("รองรับไม่เกิน 2,000 แถว และ 100 คอลัมน์");
  const table: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: unknown[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const header = sheet.getRow(1).getCell(c).text.trim();
      if (rowNumber > 1 && !(header in columns)) {
        cells.push("");
        continue;
      }
      const cell = row.getCell(c);
      if (cell.formula && cell.result === undefined)
        throw new Error(
          `แถว ${rowNumber}: ${header} มีสูตรที่ไม่มีค่าผลลัพธ์ กรุณาบันทึกไฟล์ใหม่ใน Excel หรือแปลงเป็นค่าก่อน`,
        );
      cells.push(cell.text);
    }
    table.push(cells);
  });
  return table;
}
