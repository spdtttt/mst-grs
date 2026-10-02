import type { AccountRow } from "./admin-accounts";
export type TeacherRow = AccountRow;
export type TeacherList = { total: number; items: TeacherRow[] };
export const TEACHER_PAGE_SIZE = 50;
