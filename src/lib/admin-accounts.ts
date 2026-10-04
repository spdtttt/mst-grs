import { z } from "zod";
import { passwordSchema, usernameSchema } from "./auth-input";

export const accountRoleSchema = z.enum(["student", "teacher", "academic", "manager"]);
export type AccountRole = z.infer<typeof accountRoleSchema>;
export type AccountRow = {
  id: string;
  full_name: string;
  name_prefix?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  account_revision?: number;
  username?: string | null;
  student_code?: string;
  classroom?: string | null;
  roll_number?: number | null;
  learning_subject_group?: string | null;
  has_auth?: boolean;
};
export type AccountList = { total: number; items: AccountRow[] };
export const accountNameFields = {
  name_prefix: z.string().trim().min(1, "กรุณากรอกคำนำหน้าชื่อ").max(40),
  first_name: z.string().trim().min(1, "กรุณากรอกชื่อ").max(80),
  last_name: z.string().trim().min(1, "กรุณากรอกนามสกุล").max(80),
};
export function accountFullName(value: { name_prefix: string; first_name: string; last_name: string }) {
  return `${value.name_prefix}${value.first_name} ${value.last_name}`;
}
export const managerInputSchema = z.object({
  ...accountNameFields,
  username: usernameSchema.transform((value) => value.toLowerCase()),
  password: passwordSchema,
}).strict().refine((value) => accountFullName(value).length <= 150, {
  message: "ชื่อรวมต้องไม่เกิน 150 ตัวอักษร", path: ["first_name"],
});
export type ManagerInput = z.infer<typeof managerInputSchema>;
export const accountTargetSchema = z.object({
  id: z.uuid(), role: accountRoleSchema,
  expected_revision: z.number().int().nonnegative(),
}).strict();
export const accountEditSchema = accountTargetSchema.extend({
  ...accountNameFields,
  classroom: z.string().trim().regex(/^ม\.[1-6]\/[1-9]\d{0,2}$/, "ระบุชั้น/ห้อง เช่น ม.4/9").optional(),
  roll_number: z.number().int().min(1).max(999).optional(),
  learning_subject_group: z.string().trim().min(1, "กรุณากรอกกลุ่มสาระการเรียนรู้").max(200).optional(),
}).refine((value) => accountFullName(value).length <= 150, {
  message: "ชื่อรวมต้องไม่เกิน 150 ตัวอักษร", path: ["first_name"],
}).refine((value) => value.role !== "student" || (value.classroom !== undefined && value.roll_number !== undefined), {
  message: "กรุณากรอกชั้น/ห้องและเลขที่", path: ["classroom"],
});

// Older accounts may have only full_name. Split once for editing, then persist
// explicit name fields when the administrator saves the row.
export function accountNameParts(row: AccountRow) {
  if (row.name_prefix && row.first_name && row.last_name) return {
    name_prefix: row.name_prefix, first_name: row.first_name, last_name: row.last_name,
  };
  const name = row.full_name.trim();
  const prefix = ["เด็กหญิง", "เด็กชาย", "นางสาว", "นาย", "นาง"].find((p) => name.startsWith(p)) ?? "";
  const [first = "", ...last] = name.slice(prefix.length).trim().split(/\s+/);
  return { name_prefix: prefix, first_name: first, last_name: last.join(" ") };
}
