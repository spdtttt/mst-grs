"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { adminContext } from "@/lib/admin-auth";
import { TEACHER_SUBJECT_GROUPS, type TeacherList } from "@/lib/teachers";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { encryptStaffCitizenId, staffCitizenHash } from "@/lib/staff-identity";
import { staffLoginEmails } from "@/lib/role-login";
import {
  teacherRegistrySchema,
  teacherRegistryError,
  type TeacherRegistryPreview,
  type TeacherSaveResult,
} from "@/lib/teacher-registry";

function registryService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret = process.env.LOGIN_HMAC_SECRET;
  if (!url || !key || !secret || secret.length < 32) return null;
  return {
    db: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    secret,
  };
}

export async function previewTeachers(
  input: unknown,
): Promise<{ data?: TeacherRegistryPreview[]; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z.array(teacherRegistrySchema).min(1).max(50).safeParse(input);
  if (!parsed.success) return { error: "ข้อมูลคุณครูไม่ถูกต้อง" };
  const service = registryService();
  if (!service) return { error: "ระบบทะเบียนครูยังไม่พร้อมให้บริการ" };
  const { data, error } = await service.db.rpc("preview_teacher_registry", {
    p_actor: context.user.id,
    p_rows: parsed.data.map((row) => ({
      hash: staffCitizenHash(row.citizen_id, service.secret),
      emails: staffLoginEmails(row.citizen_id, service.secret),
    })),
  });
  if (error || !Array.isArray(data) || data.length !== parsed.data.length)
    return { error: teacherRegistryError(error?.message ?? "unknown") };
  return {
    data: parsed.data.map((row, index) => ({
      ...row,
      id: data[index].id,
      expected_revision: data[index].expected_revision,
    })),
  };
}

export async function saveTeachers(
  input: unknown,
): Promise<{ results?: TeacherSaveResult[]; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .array(
      teacherRegistrySchema.safeExtend({
        id: z.uuid().nullable(),
        expected_revision: z.number().int().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(50)
    .safeParse(input);
  if (!parsed.success)
    return { error: "ข้อมูลคุณครูไม่ถูกต้อง กรุณาตรวจสอบตัวอย่างใหม่" };
  if (
    new Set(parsed.data.map((row) => row.citizen_id)).size !==
    parsed.data.length
  )
    return { error: "เลขบัตรประชาชนซ้ำในชุดข้อมูล" };
  const service = registryService();
  if (!service) return { error: "ระบบทะเบียนครูยังไม่พร้อมให้บริการ" };
  const results: TeacherSaveResult[] = [];
  for (const row of parsed.data) {
    const id = row.id ?? randomUUID();
    try {
      const { data, error } = await service.db.rpc("save_teacher_registry", {
        p_actor: context.user.id,
        p_row: {
          id,
          expected_revision: row.expected_revision,
          name_prefix: row.name_prefix,
          first_name: row.first_name,
          last_name: row.last_name,
          learning_subject_group: row.learning_subject_group,
          hash: staffCitizenHash(row.citizen_id, service.secret),
          citizen_id_encrypted: encryptStaffCitizenId(
            row.citizen_id,
            id,
            service.secret,
          ),
          emails: staffLoginEmails(row.citizen_id, service.secret),
        },
      });
      if (error || !["created", "updated"].includes(data?.status))
        results.push({
          citizen_id: row.citizen_id,
          status: "failed",
          message: teacherRegistryError(error?.message ?? "unknown"),
        });
      else results.push({ citizen_id: row.citizen_id, status: data.status });
    } catch {
      results.push({
        citizen_id: row.citizen_id,
        status: "failed",
        message: "ไม่สามารถยืนยันผลได้ กรุณาตรวจสอบตัวอย่างใหม่ก่อนลองอีกครั้ง",
      });
    }
  }
  revalidatePath("/dashboard", "layout");
  return { results };
}

export async function listTeachers(
  input: unknown,
): Promise<{ data?: TeacherList; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .object({
      search: z.string().trim().max(150),
      page: z.number().int().min(1).max(100000),
      subject_group: z.enum(["", ...TEACHER_SUBJECT_GROUPS]).default(""),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "ตัวกรองไม่ถูกต้อง" };
  const { data, error } = await context.db.rpc("admin_teacher_registry_list", {
    p_search: parsed.data.search,
    p_page: parsed.data.page,
    p_subject_group: parsed.data.subject_group,
  });
  if (error) {
    console.error("teachers: list failed", { code: error.code });
    return {
      error:
        "ไม่สามารถโหลดรายชื่อคุณครูได้ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ",
    };
  }
  return { data: data as TeacherList };
}

export async function resetTeacherAccount(
  input: unknown,
): Promise<{ success?: boolean; error?: string }> {
  return resetStaffAccount(input, "teacher");
}

export async function resetAcademicAccount(
  input: unknown,
): Promise<{ success?: boolean; error?: string }> {
  const result = await resetStaffAccount(input, "academic");
  return result.error
    ? {
        error: result.error
          .replaceAll("คุณครู", "ฝ่ายวัดผล")
          .replaceAll("สิทธิ์ครู", "สิทธิ์ฝ่ายวัดผล"),
      }
    : result;
}

async function resetStaffAccount(
  input: unknown,
  role: "teacher" | "academic",
): Promise<{ success?: boolean; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .object({ id: z.uuid(), full_name: z.string().min(1).max(150) })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { error: "ข้อมูลคุณครูไม่ถูกต้อง กรุณาโหลดรายชื่อใหม่" };
  if (parsed.data.id === context.user.id)
    return { error: "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้" };
  const { data, error } = await context.db.rpc(
    role === "teacher" ? "admin_reset_teacher" : "admin_reset_academic",
    {
      p_id: parsed.data.id,
      p_expected_name: parsed.data.full_name,
    },
  );
  if (error) {
    const messages: Record<string, string> = {
      TEACHER_RESET_FORBIDDEN:
        "เฉพาะผู้ดูแลระบบเท่านั้นที่รีเซ็ตบัญชีคุณครูได้",
      TEACHER_RESET_SELF: "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้",
      TEACHER_RESET_INVALID: "ข้อมูลคุณครูไม่ถูกต้อง กรุณาโหลดรายชื่อใหม่",
      TEACHER_RESET_NOT_FOUND:
        "ข้อมูลบัญชีไม่ครบถ้วน กรุณาตรวจสอบบัญชีก่อนดำเนินการ",
      TEACHER_RESET_NOT_TEACHER: "บัญชีนี้ไม่มีสิทธิ์ครู กรุณาโหลดรายชื่อใหม่",
      TEACHER_RESET_CHANGED:
        "ข้อมูลคุณครูเปลี่ยนแปลงแล้ว กรุณาโหลดรายชื่อใหม่ก่อนยืนยัน",
      TEACHER_RESET_REFERENCED:
        "ไม่สามารถลบบัญชีนี้ได้ เนื่องจากมีผลการเรียน งาน หรือประวัติที่อ้างถึงคุณครูอยู่",
      TEACHER_RESET_STORAGE:
        "ไม่สามารถลบบัญชีนี้ได้ เนื่องจากคุณครูยังเป็นเจ้าของไฟล์ในระบบ",
      REGISTRY_STORAGE: "รีเซ็ตไม่ได้ เนื่องจากบัญชียังเป็นเจ้าของไฟล์ในระบบ",
      REGISTRY_IDENTITY_MISSING:
        "กรุณานำเข้าหรือ backfill เลขบัตรประชาชนก่อนรีเซ็ต เพื่อให้คุณครูสมัครใหม่ได้",
      REGISTRY_BUSY: "บัญชีนี้กำลังสมัครสมาชิก กรุณาตรวจสอบสถานะก่อนรีเซ็ต",
      ACCOUNT_PROTECTED: "ไม่สามารถรีเซ็ตบัญชีผู้ดูแลระบบได้",
    };
    console.error("teachers: reset failed", { code: error.code });
    return {
      error:
        messages[error.message] ??
        (error.code === "23503"
          ? "ไม่สามารถลบบัญชีนี้ได้ เนื่องจากมีข้อมูลอื่นอ้างอิงอยู่ ข้อมูลบัญชียังอยู่ครบ"
          : "ไม่สามารถยืนยันผลการรีเซ็ตได้ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง"),
    };
  }
  if (data?.deleted !== true)
    return {
      error: "ไม่สามารถยืนยันผลการรีเซ็ตได้ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบ",
    };
  revalidatePath("/dashboard/admin");
  return { success: true };
}
