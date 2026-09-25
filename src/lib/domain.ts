export type Role = "student" | "teacher" | "academic" | "manager";
export function isRole(value: unknown): value is Role {
  return (
    value === "student" ||
    value === "teacher" ||
    value === "academic" ||
    value === "manager"
  );
}
export type Status =
  | "pending"
  | "requested"
  | "assigned"
  | "submitted"
  | "teacher_approved"
  | "completed";
export type Profile = {
  id: string;
  role: Role;
  full_name: string;
  student_code: string | null;
  classroom: string | null;
};
export type GradeRecord = {
  id: string;
  course_code: string;
  course_name: string;
  credits: number;
  classroom: string;
  teacher_name: string[];
  student_code: string;
  student_name: string;
  roll_number: number;
  academic_year: number;
  semester: number;
  original_grade: string;
  status: Status;
  teacher_id: string[];
  student_id: string;
  assignment: string | null;
  due_at: string | null;
  requested_at: string | null;
  assigned_at: string | null;
  submitted_at: string | null;
  teacher_approved_at: string | null;
  completed_at: string | null;
  final_grade: string | null;
  created_at: string;
};
export type AssignmentFile = {
  id: string;
  record_id: string;
  assignment_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  signed_url?: string;
};
export type GradeAssignment = {
  id: string;
  record_id: string;
  round_number: number;
  assignment: string;
  due_at: string;
  assigned_at: string;
  received_at: string | null;
};
export type Schedule = {
  id: number;
  opens_at: string | null;
  closes_at: string | null;
  notice: string;
};
export const roles: Record<Role, string> = {
  student: "นักเรียน",
  teacher: "ครูประจำวิชา",
  academic: "ฝ่ายวิชาการ",
  manager: "ผู้บริหาร",
};
export const statuses: Record<
  Status,
  { label: string; progress: number; tone: string }
> = {
  pending: { label: "ยังไม่ยื่นคำร้อง", progress: 0, tone: "gray" },
  requested: { label: "รอมอบหมายงาน", progress: 25, tone: "amber" },
  assigned: { label: "อยู่ระหว่างดำเนินการ", progress: 50, tone: "purple" },
  submitted: { label: "ส่งงานแล้ว", progress: 75, tone: "blue" },
  teacher_approved: {
    label: "รอฝ่ายวิชาการอนุมัติ",
    progress: 75,
    tone: "blue",
  },
  completed: { label: "แก้ไขสำเร็จ", progress: 100, tone: "green" },
};
export const nextStatus: Partial<
  Record<Role, Partial<Record<Status, Status>>>
> = {
  student: { pending: "requested" },
  teacher: {
    requested: "assigned",
    assigned: "submitted",
    submitted: "teacher_approved",
  },
  academic: { teacher_approved: "completed" },
};
export function isOpen(s: Schedule, now = Date.now()) {
  return (
    !!s.opens_at &&
    !!s.closes_at &&
    now >= Date.parse(s.opens_at) &&
    now < Date.parse(s.closes_at)
  );
}
export function safeCell(value: unknown) {
  const s = String(value ?? "");
  return /^[\s]*[=+@\-]/.test(s) ? "'" + s : s;
}
export function thaiDate(value: string | null, withTime = false) {
  return value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" as const } : {}),
        timeZone: "Asia/Bangkok",
      }).format(new Date(value))
    : "—";
}
