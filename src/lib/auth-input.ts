import { z } from "zod";

export const citizenIdSchema = z
  .string()
  .trim()
  .transform((value) => value.replaceAll("-", ""))
  .pipe(z.string().regex(/^\d{13}$/, "กรุณากรอกเลขบัตรประชาชน 13 หลัก"));
export const passwordSchema = z
  .string()
  .min(6, "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร")
  .max(128, "รหัสผ่านต้องไม่เกิน 128 ตัวอักษร");
export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{2,39}$/);

export const loginSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("student"),
    identifier: z
      .string()
      .trim()
      .regex(/^\d{5,10}$/),
    password: z.string().regex(/^\d{13}$/),
  }),
  z.object({
    role: z.literal("manager"),
    identifier: usernameSchema,
    password: passwordSchema,
  }),
  z.object({
    role: z.enum(["teacher", "academic", "admin"]),
    identifier: citizenIdSchema,
    password: passwordSchema,
  }),
]);

export const teacherRegistrationSchema = z
  .object({
    citizen_id: citizenIdSchema,
    name_prefix: z.string().trim().min(1, "กรุณากรอกคำนำหน้า").max(40),
    first_name: z.string().trim().min(1, "กรุณากรอกชื่อ").max(80),
    last_name: z.string().trim().min(1, "กรุณากรอกนามสกุล").max(80),
    password: passwordSchema,
  })
  .strict()
  .refine(
    (value) =>
      `${value.name_prefix}${value.first_name} ${value.last_name}`.length <=
      150,
    {
      message: "ชื่อและนามสกุลรวมต้องไม่เกิน 150 ตัวอักษร",
      path: ["first_name"],
    },
  );
export type TeacherRegistration = z.infer<typeof teacherRegistrationSchema>;
