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

// Retain action names for existing callers, with revision-based validation.
export async function resetTeacherAccount(input: unknown) {
  const { resetStaffAuth } = await import("./account-actions");
  const parsed = z
    .object({ id: z.uuid(), expected_revision: z.number().int().nonnegative() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "กรุณาโหลดรายชื่อใหม่ก่อนรีเซ็ต" };
  return resetStaffAuth({ ...parsed.data, role: "teacher" });
}

export async function resetAcademicAccount(input: unknown) {
  const { resetStaffAuth } = await import("./account-actions");
  const parsed = z
    .object({ id: z.uuid(), expected_revision: z.number().int().nonnegative() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "กรุณาโหลดรายชื่อใหม่ก่อนรีเซ็ต" };
  return resetStaffAuth({ ...parsed.data, role: "academic" });
}
