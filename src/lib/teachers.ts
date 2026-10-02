export type TeacherRow = { id: string; full_name: string };
export type TeacherList = { total: number; items: TeacherRow[] };
export const TEACHER_PAGE_SIZE = 50;
