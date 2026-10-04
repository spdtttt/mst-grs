import type { AccountRow } from "./admin-accounts";
export type TeacherRow = AccountRow;
export type TeacherList = { total: number; items: TeacherRow[] };
export const TEACHER_PAGE_SIZE = 50;
export const TEACHER_SUBJECT_GROUPS = [
  "กลุ่มสาระการเรียนรู้ภาษาไทย",
  "กลุ่มสาระการเรียนรู้คณิตศาสตร์",
  "กลุ่มสาระการเรียนรู้วิทยาศาสตร์ และเทคโนโลยี",
  "กลุ่มสาระสังคมศึกษา ศาสนา และวัฒนธรรม",
  "กลุ่มสาระสุขศึกษาและพลศึกษา",
  "กลุ่มสาระศิลปศึกษา",
  "กลุ่มสาระการงานอาชีพ",
  "กลุ่มสาระภาษาต่างประเทศ",
  "แนะแนว",
] as const;
