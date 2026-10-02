import { z } from "zod";
export const columns = {
  รหัสวิชา: "course_code",
  ชื่อวิชา: "course_name",
  หน่วยกิต: "credits",
  "ชั้น/ห้อง": "classroom",
  ครูผู้สอน: "teacher_name",
  เลขประจำตัว: "student_code",
  "ชื่อ-นามสกุล": "student_name",
  เลขที่: "roll_number",
  ปีการศึกษา: "academic_year",
  ภาคเรียนที่: "semester",
  ผลการเรียน: "original_grade",
} as const;

function parseTeacherNames(value: unknown) {
  if (typeof value !== "string") return value;
  return value
    .split(",")
    .map((name) => name.trim().replace(/^\d+\s*[.)]\s*/, "").trim());
}

function expandStudentNamePrefix(name: string) {
  // Student profiles join the full prefix directly to the first name.
  // Anchor replacements so abbreviations elsewhere in a name stay untouched.
  return name
    .replace(/^น\s*\.\s*ส\s*\.\s*/, "นางสาว")
    .replace(/^ด\s*\.\s*ช\s*\.\s*/, "เด็กชาย")
    .replace(/^ด\s*\.\s*ญ\s*\.\s*/, "เด็กหญิง");
}

export const importSchema = z.object({
  course_code: z.string().trim().min(1).max(40),
  course_name: z.string().trim().min(1).max(200),
  credits: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.coerce.number().min(0).max(20),
  ),
  classroom: z.string().trim().min(1).max(40),
  teacher_name: z.preprocess(
    parseTeacherNames,
    z.array(z.string().trim().min(1).max(150))
      .min(1)
      .max(20)
      .refine((names) => new Set(names).size === names.length, "ชื่อครูผู้สอนซ้ำกัน")
      .refine(
        (names) => names.every((name) => !/^-[\s]*ครูที่ปรึกษาชุมนุม[\s]*-$/.test(name)),
        "กรุณาระบุชื่อครูจริงแทน -ครูที่ปรึกษาชุมนุม -",
      ),
  ),
  student_code: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/),
  student_name: z.string().trim()
    .transform(expandStudentNamePrefix)
    .pipe(z.string().min(1).max(150)),
  roll_number: z.coerce.number().int().min(1).max(999),
  academic_year: z.coerce.number().int().min(2500).max(2700),
  semester: z.coerce.number().int().min(1).max(3),
  original_grade: z.enum(["0", "ร", "มส", "มผ"]),
});
export type ImportRow = z.infer<typeof importSchema>;
export function parseRows(headers: string[], rows: unknown[][]) {
  const normalized = headers.map((h) =>
    String(h)
      .replace(/^\uFEFF/, "")
      .trim(),
  );
  const missing = Object.keys(columns).filter((h) => !normalized.includes(h));
  if (missing.length) throw new Error("ไม่พบคอลัมน์: " + missing.join(", "));
  if (
    new Set(normalized.filter((h) => h in columns)).size !==
    normalized.filter((h) => h in columns).length
  )
    throw new Error("หัวคอลัมน์ที่จำเป็นซ้ำกัน");
  if (rows.length > 2000) throw new Error("นำเข้าได้ไม่เกิน 2,000 แถวต่อครั้ง");
  const output: ImportRow[] = [];
  const errors: string[] = [];
  const keys = new Set<string>();
  rows.forEach((row, i) => {
    if (
      row.every((c) => c === null || c === undefined || String(c).trim() === "")
    )
      return;
    const raw = Object.fromEntries(
      Object.entries(columns).map(([label, key]) => [
        key,
        String(row[normalized.indexOf(label)] ?? "").trim(),
      ]),
    );
    const result = importSchema.safeParse(raw);
    if (!result.success) {
      errors.push(
        `แถว ${i + 2}: ${result.error.issues.map((x) => x.path.join(".") + " " + x.message).join(", ")}`,
      );
      return;
    }
    const r = result.data,
      key = [r.student_code, r.course_code, r.academic_year, r.semester].join(
        "|",
      );
    if (keys.has(key)) {
      errors.push(`แถว ${i + 2}: รายการนักเรียน/วิชา/ปี/ภาคเรียนซ้ำในไฟล์`);
      return;
    }
    keys.add(key);
    output.push(r);
  });
  return { rows: output, errors };
}
export function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/)[0];
  const delimiter = first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("เครื่องหมายคำพูดใน CSV ไม่สมบูรณ์");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
