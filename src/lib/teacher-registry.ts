import { z } from "zod";
import type { Workbook } from "exceljs";
import { citizenIdSchema } from "./auth-input";
import { accountFullName, accountNameFields } from "./admin-accounts";
import { worksheetRows } from "./import-excel";

export const TEACHER_BATCH_SIZE = 50;
export const teacherColumns = [
  "รหัสผู้ใช้",
  "ผู้ใช้",
  "กลุ่มสาระการเรียนรู้",
] as const;
export const teacherRegistrySchema = z
  .object({
    citizen_id: citizenIdSchema,
    ...accountNameFields,
    learning_subject_group: z
      .string()
      .trim()
      .min(1, "กรุณากรอกกลุ่มสาระการเรียนรู้")
      .max(200),
  })
  .strict()
  .refine((value) => accountFullName(value).length <= 150, {
    message: "ชื่อรวมต้องไม่เกิน 150 ตัวอักษร",
    path: ["first_name"],
  });
export type TeacherRegistryInput = z.infer<typeof teacherRegistrySchema>;
export type TeacherRegistryPreview = TeacherRegistryInput & {
  id: string | null;
  expected_revision: number | null;
};
export type TeacherSaveResult = {
  citizen_id: string;
  status: "created" | "updated" | "failed";
  message?: string;
};

// Longest first: นาย must not consume the beginning of a longer prefix.
const prefixes = [
  "ว่าที่ร้อยตรีหญิง",
  "ว่าที่ร้อยตรี",
  "นางสาว",
  "นาง",
  "นาย",
  "ดร.",
];
export function parseTeacherName(value: string) {
  const full = value
    .replace(/^[\p{Decimal_Number}\s]+/u, "")
    .trim()
    .replace(/\s+/gu, " ");
  const name_prefix = prefixes.find((prefix) => full.startsWith(prefix));
  if (!name_prefix)
    throw new Error("ไม่สามารถแยกคำนำหน้าชื่อ กรุณาตรวจสอบคอลัมน์ ผู้ใช้");
  const [first_name, ...last] = full
    .slice(name_prefix.length)
    .trim()
    .split(" ");
  const last_name = last.join(" ");
  if (!first_name || !last_name)
    throw new Error("กรุณาระบุชื่อและนามสกุลในคอลัมน์ ผู้ใช้");
  return { name_prefix, first_name, last_name };
}

export function readTeacherWorkbook(book: Workbook) {
  const rows = new Map<string, TeacherRegistryInput>();
  const locations = new Map<string, string>();
  const errors: string[] = [],
    warnings: string[] = [];
  if (!book.worksheets.length) errors.push("ไม่พบแผ่นงานในไฟล์");
  for (const sheet of book.worksheets) {
    try {
      const table = worksheetRows(sheet, teacherColumns);
      const headers = (table.shift() ?? []).map((value) =>
        String(value)
          .replace(/^\uFEFF/, "")
          .trim(),
      );
      for (const label of teacherColumns) {
        if (headers.filter((value) => value === label).length !== 1)
          throw new Error(`หัวคอลัมน์ ${label} ต้องมีหนึ่งคอลัมน์`);
      }
      table.forEach((cells, index) => {
        const location = `ชีท ${sheet.name} แถว ${index + 2}`;
        const [citizen_id, name, learning_subject_group] = teacherColumns.map(
          (label) => String(cells[headers.indexOf(label)] ?? "").trim(),
        );
        if (![citizen_id, name, learning_subject_group].some(Boolean)) return;
        try {
          const parsed = teacherRegistrySchema.parse({
            citizen_id,
            ...parseTeacherName(name),
            learning_subject_group,
          });
          if (rows.has(parsed.citizen_id))
            warnings.push(
              `${location}: เลขบัตรซ้ำกับ ${locations.get(parsed.citizen_id)} ใช้ข้อมูลรายการสุดท้าย`,
            );
          rows.set(parsed.citizen_id, parsed);
          locations.set(parsed.citizen_id, location);
        } catch (error) {
          errors.push(
            `${location}: ${error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "ข้อมูลไม่ถูกต้อง"}`,
          );
        }
      });
    } catch (error) {
      errors.push(
        `ชีท ${sheet.name}: ${error instanceof Error ? error.message : "อ่านข้อมูลไม่สำเร็จ"}`,
      );
    }
  }
  if (!rows.size && !errors.length) errors.push("ไม่พบข้อมูลคุณครูในไฟล์");
  if (rows.size > 2000) errors.push("นำเข้าได้ไม่เกิน 2,000 รายการต่อครั้ง");
  return { rows: [...rows.values()], errors, warnings };
}

export function teacherRegistryError(code: string) {
  const messages: Record<string, string> = {
    ACCOUNT_FORBIDDEN: "เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการได้",
    ACCOUNT_CHANGED: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาตรวจสอบตัวอย่างใหม่ก่อนบันทึก",
    ACCOUNT_PROTECTED: "ไม่สามารถแก้ไขหรือรีเซ็ตบัญชีผู้ดูแลระบบได้",
    REGISTRY_AMBIGUOUS:
      "ข้อมูลเลขบัตรตรงกับหลายบัญชีหรือบัญชีที่ไม่ใช่บุคลากร กรุณาติดต่อผู้ดูแลระบบ",
    REGISTRY_BUSY:
      "บัญชีนี้กำลังสมัครสมาชิก กรุณารอหรือติดต่อผู้ดูแลระบบเพื่อตรวจสอบสถานะ",
    REGISTRY_STORAGE:
      "รีเซ็ตไม่ได้ เนื่องจากบัญชียังเป็นเจ้าของไฟล์ในระบบ ข้อมูลทั้งหมดคงอยู่",
    REGISTRY_IDENTITY_MISSING:
      "กรุณานำเข้าหรือ backfill เลขบัตรประชาชนในทะเบียนก่อนรีเซ็ต เพื่อให้คุณครูสมัครใหม่ได้",
  };
  return (
    messages[code] ?? "ดำเนินการไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง"
  );
}
