import { z } from "zod";

export const studentStatusSchema = z.enum([
  "active",
  "graduated",
  "transferred",
  "not_graduated",
]);
export type StudentStatus = z.infer<typeof studentStatusSchema>;
export const studentStatusLabels: Record<StudentStatus, string> = {
  active: "กำลังศึกษา",
  graduated: "จบการศึกษา",
  transferred: "ย้ายออก",
  not_graduated: "ไม่จบการศึกษา",
};
export type LifecycleStudent = {
  id: string;
  student_code: string;
  full_name: string;
  classroom: string | null;
  roll_number: number | null;
  account_revision: number;
  student_status: StudentStatus;
  student_status_year: number | null;
};
export type LifecycleList = {
  items: LifecycleStudent[];
  total: number;
  classrooms: string[];
  counts: Record<StudentStatus, number>;
};
export const lifecycleChangeResultSchema = z.object({
  updated: z.number().int().nonnegative(),
  graduated: z.number().int().nonnegative(),
  notGraduated: z.array(
    z.object({
      id: z.uuid(),
      student_code: z.string(),
      full_name: z.string(),
      outstanding_count: z.number().int().positive(),
    }),
  ),
});
export type LifecycleChangeResult = z.infer<typeof lifecycleChangeResultSchema>;
export const lifecycleFilterSchema = z
  .object({
    search: z.string().trim().max(150),
    status: z.enum([
      "all",
      "active",
      "graduated",
      "transferred",
      "not_graduated",
    ]),
    level: z.number().int().min(1).max(6).nullable(),
    classroom: z.string().max(40).nullable(),
    page: z.number().int().min(1).max(100000),
    pageSize: z.union([z.literal(50), z.literal(2000)]),
  })
  .strict();
export const lifecycleChangeSchema = z
  .object({
    students: z
      .array(
        z
          .object({ id: z.uuid(), revision: z.number().int().nonnegative() })
          .strict(),
      )
      .min(1)
      .max(2000),
    status: studentStatusSchema,
    year: z.number().int().min(2500).max(2800).nullable(),
  })
  .strict()
  .refine(
    (v) => new Set(v.students.map((s) => s.id)).size === v.students.length,
    { message: "มีนักเรียนซ้ำในรายการ" },
  )
  .refine((v) => (v.status === "active" ? v.year === null : v.year !== null), {
    message: "กรุณาระบุปีการศึกษา พ.ศ. ที่บันทึกสถานะ",
  });
