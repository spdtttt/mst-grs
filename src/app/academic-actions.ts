"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext } from "@/lib/admin-auth";
import { teacherRegistrationSchema } from "@/lib/auth-input";
import { randomUUID } from "node:crypto";
import { encryptStaffCitizenId } from "@/lib/staff-identity";
import {
  provisionRegisteredTeacher,
  RegistryRegistrationError,
} from "@/lib/registered-teacher";
import type { TeacherList } from "@/lib/teachers";

export async function listAcademics(
  input: unknown,
): Promise<{ data?: TeacherList; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .object({
      search: z.string().trim().max(150),
      page: z.number().int().min(1).max(100000),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "ตัวกรองไม่ถูกต้อง" };
  const { data, error } = await context.db.rpc("admin_account_list", {
    p_role: "academic",
    p_search: parsed.data.search,
    p_page: parsed.data.page,
  });
  if (error)
    return { error: "ไม่สามารถโหลดรายชื่อฝ่ายวัดผลได้ กรุณาลองอีกครั้ง" };
  return { data: data as TeacherList };
}

export async function addAcademicTeacher(
  input: unknown,
): Promise<{ error?: string; success?: boolean }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .object({ id: z.uuid(), full_name: z.string().min(1).max(150) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "กรุณาเลือกบัญชีคุณครูจากรายชื่อ" };
  const { error } = await context.db.rpc("admin_add_academic_teacher", {
    p_id: parsed.data.id,
    p_expected_name: parsed.data.full_name,
  });
  if (error)
    return {
      error:
        error.message === "ACADEMIC_TEACHER_CHANGED"
          ? "ข้อมูลครูเปลี่ยนแปลงแล้ว กรุณาค้นหาและเลือกบัญชีใหม่"
          : "เพิ่มสิทธิ์ไม่สำเร็จ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง",
    };
  revalidatePath("/dashboard/admin");
  return { success: true };
}

export async function createAcademic(
  input: unknown,
): Promise<{ error?: string; success?: boolean }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = teacherRegistrationSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message || "กรุณาตรวจสอบข้อมูล" };
  const secret = process.env.LOGIN_HMAC_SECRET;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !secret || secret.length < 32)
    return { error: "ระบบสร้างบัญชียังไม่พร้อม กรุณาตรวจสอบการตั้งค่า" };
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const proposedId = randomUUID();
  const result = await provisionRegisteredTeacher(
    parsed.data,
    {
      async consume() {
        return true;
      }, // This form already requires an active Admin session.
      async claim(hash, first, last, token, emails) {
        const claimed = await service.rpc("claim_academic_registration", {
          p_actor: context.user.id,
          p_token: token,
          p_row: {
            id: proposedId,
            hash,
            emails,
            name_prefix: parsed.data.name_prefix,
            first_name: first,
            last_name: last,
            citizen_id_encrypted: encryptStaffCitizenId(
              parsed.data.citizen_id,
              proposedId,
              secret,
            ),
          },
        });
        if (claimed.error)
          throw new RegistryRegistrationError(claimed.error.message);
        return claimed.data;
      },
      async create(id, email, password, token) {
        const created = await service.auth.admin.createUser({
          id,
          email,
          password,
          email_confirm: true,
          app_metadata: { role: "academic", teacher_registration_token: token },
        });
        if (created.error || created.data.user?.id !== id)
          throw new RegistryRegistrationError(created.error?.code ?? "unknown");
      },
      async authToken(id) {
        const found = await service.auth.admin.getUserById(id);
        if (found.error) {
          if (
            found.error.status === 404 ||
            found.error.code === "user_not_found"
          )
            return null;
          throw new Error("Auth lookup not confirmed");
        }
        return typeof found.data.user?.app_metadata
          .teacher_registration_token === "string"
          ? found.data.user.app_metadata.teacher_registration_token
          : "unowned";
      },
      async finish(id, token, success) {
        const finished = await service.rpc("finish_teacher_registration", {
          p_id: id,
          p_token: token,
          p_success: success,
        });
        if (finished.error)
          throw new RegistryRegistrationError(finished.error.message);
      },
    },
    secret,
    "admin-academic",
    "academic",
  );
  if (result.body.success) revalidatePath("/dashboard", "layout");
  return {
    success: result.body.success,
    error: result.body.error?.replaceAll("คุณครู", "ฝ่ายวัดผล"),
  };
}
