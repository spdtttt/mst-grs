import type { GradeRecord, Status } from "@/lib/domain";

export const outstandingStatuses = [
  "pending",
  "requested",
  "assigned",
  "submitted",
  "teacher_approved",
] as const satisfies readonly Status[];

export type OutstandingStatus = (typeof outstandingStatuses)[number];

export type ManagerStudentRow = {
  student_code: string;
  student_name: string;
  classroom: string;
  roll_number: number;
  academic_year: number;
  semester: number;
  total_records: number;
  incomplete_records: number;
  completed_records: number;
};

export type ManagerStudentList = {
  total: number;
  items: ManagerStudentRow[];
  years: number[];
};

export type ManagerStudentFilters = {
  level?: number | null;
  academicYear?: number | null;
  semester?: number | null;
};

export type ManagerStudentCourse = Pick<
  GradeRecord,
  | "id"
  | "academic_year"
  | "semester"
  | "course_code"
  | "course_name"
  | "credits"
  | "teacher_name"
  | "original_grade"
  | "status"
>;

export const managerStudentPageSize = 20;

export type ManagerStats = {
  total_records: number;
  incomplete_records: number;
  outstanding_by_status?: Record<OutstandingStatus, number>;
  completed_records: number;
  total_students: number;
  completed_students?: number;
  incomplete_students?: number;
  unclassified_students: number;
  by_level: {
    level: number;
    completed_students: number;
    incomplete_students: number;
  }[];
};

function laterRecord(left: GradeRecord, right: GradeRecord) {
  return (
    left.academic_year - right.academic_year ||
    left.semester - right.semester ||
    Date.parse(left.created_at) - Date.parse(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function summarizeManagerStudents(
  records: GradeRecord[],
  completed: boolean,
  query = "",
  page = 1,
  filters: ManagerStudentFilters = {},
): ManagerStudentList {
  const students = new Map<
    string,
    { latest: GradeRecord; total: number; incomplete: number }
  >();
  for (const record of records) {
    const current = students.get(record.student_id);
    if (!current) {
      students.set(record.student_id, {
        latest: record,
        total: 1,
        incomplete: record.status === "completed" ? 0 : 1,
      });
      continue;
    }
    current.total++;
    if (record.status !== "completed") current.incomplete++;
    if (laterRecord(record, current.latest) > 0) current.latest = record;
  }
  const needle = query.trim().toLocaleLowerCase("th-TH");
  const years = [...new Set([...students.values()].map(({ latest }) => latest.academic_year))]
    .sort((a, b) => b - a);
  const matches = [...students.values()]
    .filter((student) =>
      completed ? student.incomplete === 0 : student.incomplete > 0,
    )
    .map(({ latest, total, incomplete }) => ({
      student_code: latest.student_code,
      student_name: latest.student_name,
      classroom: latest.classroom,
      roll_number: latest.roll_number,
      academic_year: latest.academic_year,
      semester: latest.semester,
      total_records: total,
      incomplete_records: incomplete,
      completed_records: total - incomplete,
    }))
    .filter(
      (student) =>
        (!filters.level ||
          Number(student.classroom.match(/^ม[.]?\s*([1-6])(?:\s*\/|$)/)?.[1]) ===
            filters.level) &&
        (!filters.academicYear || student.academic_year === filters.academicYear) &&
        (!filters.semester || student.semester === filters.semester) &&
        (!needle ||
          [student.student_code, student.student_name, student.classroom].some(
            (value) => value.toLocaleLowerCase("th-TH").includes(needle),
          )),
    )
    .sort((a, b) => a.student_code.localeCompare(b.student_code));
  return {
    total: matches.length,
    years,
    items: matches.slice(
      (page - 1) * managerStudentPageSize,
      page * managerStudentPageSize,
    ),
  };
}

export function summarizeManagerStats(records: GradeRecord[]): ManagerStats {
  const outstandingByStatus: Record<OutstandingStatus, number> = {
    pending: 0,
    requested: 0,
    assigned: 0,
    submitted: 0,
    teacher_approved: 0,
  };
  const students = new Map<
    string,
    { latest: GradeRecord; allCompleted: boolean }
  >();
  for (const record of records) {
    if (record.status !== "completed") outstandingByStatus[record.status]++;
    const existing = students.get(record.student_id);
    if (!existing) {
      students.set(record.student_id, {
        latest: record,
        allCompleted: record.status === "completed",
      });
      continue;
    }
    existing.allCompleted &&= record.status === "completed";
    if (laterRecord(record, existing.latest) > 0) existing.latest = record;
  }

  const byLevel = Array.from({ length: 6 }, (_, index) => ({
    level: index + 1,
    completed_students: 0,
    incomplete_students: 0,
  }));
  let unclassifiedStudents = 0;
  let completedStudents = 0;
  for (const student of students.values()) {
    if (student.allCompleted) completedStudents++;
    const level = Number(
      student.latest.classroom.match(/ม[.]\s*([1-6])(?:\s*\/|$)/)?.[1],
    );
    if (!level) {
      unclassifiedStudents++;
      continue;
    }
    const row = byLevel[level - 1];
    if (student.allCompleted) row.completed_students++;
    else row.incomplete_students++;
  }

  const completedRecords = records.filter(
    (record) => record.status === "completed",
  ).length;
  return {
    total_records: records.length,
    incomplete_records: records.length - completedRecords,
    outstanding_by_status: outstandingByStatus,
    completed_records: completedRecords,
    total_students: students.size,
    completed_students: completedStudents,
    incomplete_students: students.size - completedStudents,
    unclassified_students: unclassifiedStudents,
    by_level: byLevel,
  };
}
