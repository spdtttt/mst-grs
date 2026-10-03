import { z } from "zod";

export const studentColumns = {
  เลขประจำตัวประชาชน: "citizen_id",
  รหัสนักเรียน: "student_code",
  คำนำหน้าชื่อ: "name_prefix",
  ชื่อ: "first_name",
  นามสกุล: "last_name",
  "ชั้น/ห้อง": "classroom",
  เลขที่: "roll_number",
} as const;

export const studentSchema = z
  .object({
    citizen_id: z
      .string()
      .trim()
      .transform((v) => v.replaceAll("-", ""))
      .pipe(z.string().regex(/^\d{13}$/, "เลขบัตรต้องมี 13 หลัก")),
    student_code: z
      .string()
      .trim()
      .regex(/^\d{5,10}$/, "รหัสนักเรียนต้องมี 5–10 หลัก"),
    name_prefix: z.string().trim().min(1).max(40),
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    classroom: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, ""))
      .pipe(
        z
          .string()
          .regex(/^ม\.[1-6]\/[1-9]\d{0,2}$/, "ระบุชั้น/ห้อง เช่น ม.4/9"),
      ),
    roll_number: z.preprocess(
      (v) => (typeof v === "string" && !v.trim() ? undefined : v),
      z.coerce.number().int().min(1).max(999),
    ),
  })
  .refine((v) => studentFullName(v).length <= 150, {
    message: "ชื่อรวมยาวเกิน 150 ตัวอักษร",
    path: ["first_name"],
  });

export type StudentInput = z.infer<typeof studentSchema>;
export function studentFullName(v: {
  name_prefix: string;
  first_name: string;
  last_name: string;
}) {
  return `${v.name_prefix}${v.first_name} ${v.last_name}`;
}
export type StudentRow = {
  account_revision?: number;
  id: string;
  student_code: string;
  full_name: string;
  classroom: string | null;
  name_prefix: string | null;
  first_name: string | null;
  last_name: string | null;
  roll_number: number | null;
};
export type StudentList = {
  total: number;
  items: StudentRow[];
  levels: number[];
  classrooms: string[];
};
export type StudentSaveResult = {
  student_code: string;
  status: "created" | "updated" | "failed";
  message?: string;
};

export function parseStudentRows(headers: string[], rows: unknown[][]) {
  const normalized = headers.map((h) =>
    String(h)
      .replace(/^\uFEFF/, "")
      .trim(),
  );
  const labels = Object.keys(studentColumns);
  const missing = labels.filter((h) => !normalized.includes(h));
  if (missing.length) throw new Error("ไม่พบคอลัมน์: " + missing.join(", "));
  if (labels.some((h) => normalized.filter((v) => v === h).length !== 1))
    throw new Error("หัวคอลัมน์ที่จำเป็นซ้ำกัน");
  if (rows.length > 2000) throw new Error("นำเข้าได้ไม่เกิน 2,000 แถวต่อครั้ง");
  const output: StudentInput[] = [],
    errors: string[] = [],
    seen = new Set<string>();
  rows.forEach((cells, i) => {
    const raw = Object.fromEntries(
      Object.entries(studentColumns).map(([h, key]) => [
        key,
        String(cells[normalized.indexOf(h)] ?? "").trim(),
      ]),
    );
    if (Object.values(raw).every((v) => !v)) return;
    const parsed = studentSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = [
        ...new Set(
          parsed.error.issues.map(
            (issue) =>
              Object.entries(studentColumns).find(
                ([, key]) => key === issue.path[0],
              )?.[0] ?? "ข้อมูล",
          ),
        ),
      ];
      errors.push(`แถว ${i + 2}: ตรวจสอบ ${fields.join(", ")}`);
    } else if (seen.has(parsed.data.student_code)) {
      errors.push(`แถว ${i + 2}: รหัสนักเรียนซ้ำในไฟล์`);
    } else {
      seen.add(parsed.data.student_code);
      output.push(parsed.data);
    }
  });
  return { rows: output, errors };
}

export function studentLevel(classroom: string | null) {
  const match = classroom?.match(/^(?:ม\.\s*)?([1-6])(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

export function compareStudents(
  a: {
    classroom: string | null;
    roll_number: number | null;
    student_code: string;
    id?: string;
  },
  b: {
    classroom: string | null;
    roll_number: number | null;
    student_code: string;
    id?: string;
  },
) {
  const levelA = studentLevel(a.classroom),
    levelB = studentLevel(b.classroom);
  const room = (s: string | null) => {
    const match = s?.match(/^(?:ม\.\s*)?[1-6]\/(\d+)$/);
    return match ? Number(match[1]) : null;
  };
  const roomA = room(a.classroom),
    roomB = room(b.classroom);
  return (
    (levelA ?? Infinity) - (levelB ?? Infinity) ||
    (roomA ?? Infinity) - (roomB ?? Infinity) ||
    ((levelA === null || roomA === null) && (levelB === null || roomB === null)
      ? Number(a.classroom === null) - Number(b.classroom === null) ||
        (a.classroom ?? "").localeCompare(b.classroom ?? "")
      : 0) ||
    (a.roll_number ?? Infinity) - (b.roll_number ?? Infinity) ||
    a.student_code.localeCompare(b.student_code) ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}
