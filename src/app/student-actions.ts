"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { studentAdminContext } from "@/lib/student-admin";
import {
  STUDENT_BATCH_SIZE,
  runStudentBatch,
  type StudentBatchResult,
} from "@/lib/student-import";
import {
  studentSchema,
  type StudentInput,
  type StudentList,
} from "@/lib/students";
import {
  provisionStudent,
  prefetchStudentStore,
  StudentProvisionError,
  type StudentAccountStore,
} from "@/lib/student-provisioning";
import { encryptStudentCitizenId } from "@/lib/student-identity";

export async function listStudents(
  input: unknown,
): Promise<{ data?: StudentList; error?: string }> {
  const context = await studentAdminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .object({
      search: z.string().trim().max(150),
      level: z.number().int().min(1).max(6).nullable(),
      page: z.number().int().min(1).max(100000),
      classroom: z.string().trim().min(1).max(40).nullable().default(null),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "ตัวกรองไม่ถูกต้อง" };
  const { data, error } = await context.db.rpc("admin_student_list", {
    p_search: parsed.data.search,
    p_level: parsed.data.level,
    p_page: parsed.data.page,
    p_classroom: parsed.data.classroom,
  });
  if (error)
    return {
      error:
        "ไม่สามารถโหลดรายชื่อนักเรียนได้ กรุณาตรวจสอบว่าได้ติดตั้ง migration 041 แล้ว",
    };
  return { data: data as StudentList };
}

export async function saveStudents(
  input: unknown,
  importId: unknown,
): Promise<Partial<StudentBatchResult> & { error?: string }> {
  const context = await studentAdminContext();
  if ("error" in context) return { error: context.error };
  const run = z.uuid().safeParse(importId);
  if (!run.success) return { error: "รหัสรอบนำเข้าไม่ถูกต้อง" };
  const parsed = z
    .array(studentSchema)
    .min(1)
    .max(STUDENT_BATCH_SIZE)
    .safeParse(input);
  if (
    !parsed.success ||
    new Set(parsed.data?.map((s) => s.student_code)).size !==
      parsed.data?.length
  )
    return { error: "ข้อมูลนักเรียนไม่ถูกต้องหรือมีรหัสนักเรียนซ้ำ" };
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret = process.env.LOGIN_HMAC_SECRET;
  if (!key || !secret || secret.length < 32)
    return {
      error:
        "กรุณาตั้งค่า SUPABASE_SERVICE_ROLE_KEY และ LOGIN_HMAC_SECRET บนเซิร์ฟเวอร์",
    };
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const batchId = randomUUID();
  const control = async (operation: "claim" | "check" | "release") => {
    const { data, error } = await context.db.rpc("student_import_control", {
      p_operation: operation,
      p_import_id: run.data,
      p_batch_id: batchId,
    });
    if (error) throw new Error("import control failed");
    return data as { canContinue: boolean };
  };
  try {
    if (!(await control("claim")).canContinue)
      return { results: [], cancelled: true };
  } catch {
    return {
      error:
        "ไม่สามารถเริ่มชุดนำเข้าได้ กรุณาตรวจสอบรอบนำเข้าและ migration 028",
    };
  }
  let response: StudentBatchResult = { results: [], cancelled: false };
  try {
    const store: StudentAccountStore = {
      async findProfile(code) {
        const { data, error } = await service
          .from("profiles")
          .select("id,role")
          .eq("student_code", code)
          .maybeSingle();
        if (error) throw new Error("profile lookup failed");
        return data;
      },
      async verifyAuth(id, email) {
        const { data, error } = await service.auth.admin.getUserById(id);
        if (error) throw new Error("Auth verification failed");
        return data.user?.email === email;
      },
      async createAuth(email, password) {
        const { data, error } = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { role: "student" },
        });
        if (error || !data.user)
          throw new StudentProvisionError(
            error?.code === "email_exists" || error?.code === "email_conflict"
              ? "มีบัญชีใน Auth อยู่แล้วแต่ไม่พบ profiles กรุณาตรวจสอบบัญชีเดิม"
              : "สร้างบัญชี Auth ไม่สำเร็จ กรุณาลองอีกครั้ง",
          );
        return data.user.id;
      },
      async saveProfile(id, student: StudentInput) {
        const { citizen_id, ...profile } = student;
        const { error } = await context.db.rpc("admin_save_student", {
          p_id: id,
          p_student: {
            ...profile,
            citizen_id_encrypted: encryptStudentCitizenId(
              citizen_id,
              student.student_code,
              secret,
            ),
          },
        });
        if (error) throw new Error("profile save failed");
      },
      async deleteAuth(id) {
        const { error } = await service.auth.admin.deleteUser(id);
        if (error) throw new Error("rollback failed");
      },
    };
    const cachedStore = await prefetchStudentStore(
      parsed.data.map((student) => student.student_code),
      store,
      async (codes) => {
        const { data, error } = await service
          .from("profiles")
          .select("id,role,student_code")
          .in("student_code", codes);
        if (error) throw new Error("bulk profile lookup failed");
        return data ?? [];
      },
    );
    response = await runStudentBatch(
      parsed.data,
      (student) => provisionStudent(student, cachedStore, secret),
      async () => (await control("check")).canContinue,
    );
  } catch {
    response.error =
      "ไม่สามารถค้นหาบัญชีเดิมได้ หยุดชุดนำเข้าแล้ว กรุณาลองอีกครั้ง";
  } finally {
    try {
      await control("release");
    } catch {
      response.error =
        "ไม่สามารถยืนยันการจบชุดนำเข้าได้ กรุณาตรวจสอบสถานะก่อนลองใหม่";
    }
  }
  revalidatePath("/dashboard/admin");
  return response;
}
