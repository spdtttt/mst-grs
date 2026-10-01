import type { GradeRecord, Profile, Status } from "./domain";
import type { ImportRow } from "./import";

export const syntheticCounts = { student: 2300, teacher: 200, academic: 15, manager: 5, admin: 1 } as const;
type SyntheticRole = keyof typeof syntheticCounts;
export type SyntheticAccount = Profile & { identifier: string; citizen_id: string };
const states: Status[] = ["pending", "requested", "assigned", "submitted", "teacher_approved", "completed"];
const labels: Record<SyntheticRole, string> = { student: "นักเรียนจำลอง", teacher: "ครูจำลอง", academic: "วิชาการจำลอง", manager: "ผู้บริหารจำลอง", admin: "ผู้ดูแลระบบจำลอง" };
const uuid = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Synthetic identities start with 0; these are not real national identifiers.
// Pure generator: no environment credentials, external calls or database writes.
export function syntheticSchool(recordCount = 1200) {
  if (!Number.isInteger(recordCount) || recordCount < 600 || recordCount > 12000)
    throw new Error("recordCount must be 600–12000");
  const accounts: SyntheticAccount[] = [];
  for (const role of Object.keys(syntheticCounts) as SyntheticRole[]) {
    for (let i = 0; i < syntheticCounts[role]; i++) {
      const serial = accounts.length + 1;
      const citizen = `0${String(serial).padStart(12, "0")}`;
      const code = String(99000001 + i);
      accounts.push({
        id: uuid(serial), role, full_name: `${labels[role]} ${String(i + 1).padStart(4, "0")}`,
        student_code: role === "student" ? code : null,
        classroom: role === "student" ? `ม.${1 + Math.floor(i / 400)}/${1 + Math.floor((i % 400) / 40)}` : null,
        identifier: role === "student" ? code : role === "manager" ? `loadtest_mgr_${i + 1}` : role === "admin" ? `loadtest_admin_${i + 1}` : citizen,
        citizen_id: role === "manager" || role === "admin" ? "" : citizen,
      });
    }
  }
  const students = accounts.filter(a => a.role === "student");
  const teachers = accounts.filter(a => a.role === "teacher");
  const records: GradeRecord[] = [];
  const imports: ImportRow[] = [];
  for (let i = 0; i < recordCount; i++) {
    const student = students[i % students.length];
    const instructors = [teachers[i % teachers.length]];
    if (i % 7 === 0) instructors.push(teachers[(i + 1) % teachers.length]);
    const row: ImportRow = {
      course_code: `MOCK-${String(1 + Math.floor(i / students.length)).padStart(3, "0")}`,
      course_name: `วิชาทดสอบ ${1 + Math.floor(i / students.length)}`,
      credits: 1.5, classroom: student.classroom!, teacher_name: instructors.map(t => t.full_name),
      student_code: student.student_code!, student_name: student.full_name,
      roll_number: 1 + (i % students.length) % 40, academic_year: 2569, semester: 1,
      original_grade: (["0", "ร", "มส", "มผ"] as const)[i % 4],
    };
    imports.push(row);
    const step = i % states.length;
    records.push({
      ...row, id: uuid(100000 + i), status: states[step], student_id: student.id,
      teacher_id: instructors.map(t => t.id),
      assignment: step >= 2 ? "ภาระงานจำลอง: ทำแบบฝึกหัดและส่งให้ครูตรวจ" : null,
      due_at: step >= 2 ? "2099-12-01T09:00:00Z" : null,
      requested_at: step >= 1 ? "2026-09-01T09:00:00Z" : null,
      assigned_at: step >= 2 ? "2026-09-02T09:00:00Z" : null,
      submitted_at: step >= 3 ? "2026-09-03T09:00:00Z" : null,
      teacher_approved_at: step >= 4 ? "2026-09-04T09:00:00Z" : null,
      completed_at: step >= 5 ? "2026-09-05T09:00:00Z" : null,
      final_grade: step >= 4 ? "1" : null, created_at: "2026-08-01T00:00:00Z",
    });
  }
  const actors = Object.fromEntries((Object.keys(syntheticCounts) as SyntheticRole[]).map(role => {
    const account = accounts.find(a => a.role === role)!;
    const { identifier, citizen_id, ...profile } = account;
    return [role, profile];
  })) as Record<SyntheticRole, Profile>;
  return { accounts, imports, records, actors };
}
