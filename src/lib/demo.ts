import type { ArchivedGradeRecord, GradeRecord, Profile, Role, Schedule, Status } from "./domain";
export const demoProfiles: Record<Role, Profile> = {
  student: {
    id: "student-demo",
    role: "student",
    full_name: "กิตติพัฒน์ ใจดี",
    student_code: "12345",
    classroom: "ม.4/2",
  },
  teacher: {
    id: "teacher-demo",
    role: "teacher",
    full_name: "สุภาวดี ศรีสุข",
    student_code: null,
    classroom: null,
  },
  academic: {
    id: "academic-demo",
    role: "academic",
    full_name: "วิชาการ ตัวอย่าง",
    student_code: null,
    classroom: null,
  },
  manager: {
    id: "manager-demo",
    role: "manager",
    full_name: "ผู้บริหาร ตัวอย่าง",
    student_code: null,
    classroom: null,
  },
};
export const demoSchedule: Schedule = {
  id: 1,
  opens_at: "2026-01-01T00:00:00+07:00",
  closes_at: "2027-12-31T23:59:00+07:00",
  notice: "กรุณาส่งภาระงานภายในกำหนด และติดต่อครูประจำวิชาหากมีข้อสงสัย",
};
const samples: [string, string, number, string, Status][] = [
  ["ค31101", "คณิตศาสตร์พื้นฐาน", 1.5, "0", "pending"],
  ["ว31101", "วิทยาศาสตร์กายภาพ", 1.5, "ร", "requested"],
  ["อ31101", "ภาษาอังกฤษพื้นฐาน", 1.0, "0", "assigned"],
  ["ท31101", "ภาษาไทยพื้นฐาน", 1.0, "ร", "submitted"],
  ["ส31101", "สังคมศึกษา", 1.0, "มส", "teacher_approved"],
  ["พ31101", "สุขศึกษาและพลศึกษา", 0.5, "0", "completed"],
];
export const demoRecords: GradeRecord[] = samples.map(
  ([code, name, credits, grade, status], i) => ({
    id: "demo-" + i,
    course_code: code,
    course_name: name,
    credits,
    classroom: "ม.4/2",
    teacher_name: i === 0
      ? ["สุภาวดี ศรีสุข", "ณัฐพงศ์ นาคน้อย"]
      : ["สุภาวดี ศรีสุข"],
    student_code: "12345",
    student_name: "กิตติพัฒน์ ใจดี",
    roll_number: 12,
    academic_year: 2569,
    semester: 1,
    original_grade: grade,
    status,
    teacher_id: i === 0 ? ["teacher-demo", "teacher-demo-2"] : ["teacher-demo"],
    student_id: "student-demo",
    assignment: [
      "assigned",
      "submitted",
      "teacher_approved",
      "completed",
    ].includes(status)
      ? "1. สรุปเนื้อหาบทที่ 1–3 ลงในสมุด อย่างน้อย 5 หน้า\n2. ทำแบบฝึกหัดท้ายบท พร้อมแสดงวิธีคิดให้ครบถ้วน\n3. นำงานมาส่งด้วยตนเองที่ห้องพักครูกลุ่มสาระฯ"
      : null,
    due_at: "2026-10-15T16:00:00+07:00",
    requested_at: status === "pending" ? null : "2026-09-10T09:00:00+07:00",
    assigned_at: ["pending", "requested"].includes(status)
      ? null
      : "2026-09-12T10:00:00+07:00",
    submitted_at: ["submitted", "teacher_approved", "completed"].includes(
      status,
    )
      ? "2026-09-14T10:00:00+07:00"
      : null,
    teacher_approved_at: ["teacher_approved", "completed"].includes(status)
      ? "2026-09-15T10:00:00+07:00"
      : null,
    completed_at: status === "completed" ? "2026-09-16T10:00:00+07:00" : null,
    final_grade: ["teacher_approved", "completed"].includes(status)
      ? "1"
      : null,
    created_at: "2026-09-01T00:00:00+07:00",
  }),
);

export const demoHistory: ArchivedGradeRecord[] = [{
  ...demoRecords[5],
  id: "demo-history-1",
  academic_year: 2568,
  semester: 2,
  archived_at: "2026-09-17T16:00:10+07:00",
  archived_closes_at: "2026-09-17T16:00:00+07:00",
}];
