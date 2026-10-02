"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext } from "@/lib/admin-auth";
import { teacherRegistrationSchema } from "@/lib/auth-input";
import { staffLoginEmails } from "@/lib/role-login";
import { encryptStaffCitizenId } from "@/lib/staff-identity";
import { provisionStaff, RegistrationError } from "@/lib/teacher-registration";
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
  const { data, error } = await context.db.rpc("admin_academic_list", {
    p_search: parsed.data.search,
    p_page: parsed.data.page,
  });
  if (error)
    return { error: "ไม่สามารถโหลดรายชื่อฝ่ายวิชาการได้ กรุณาลองอีกครั้ง" };
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
  const result = await provisionStaff(
    parsed.data,
    {
      async createAuth(email, password) {
        const existing = await service.rpc("staff_identity_exists", {
          p_emails: staffLoginEmails(parsed.data.citizen_id, secret),
        });
        if (existing.error)
          throw new RegistrationError(
            "ตรวจสอบบัญชีเดิมไม่สำเร็จ กรุณาลองอีกครั้ง",
          );
        if (existing.data)
          throw new RegistrationError(
            "มีบัญชีบุคลากรนี้อยู่แล้ว หากเป็นคุณครูให้เลือกเพิ่มสิทธิ์จากบัญชีครูเดิม",
          );
        const { data, error } = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { role: "academic" },
        });
        if (error || !data.user) {
          console.error("academics: create auth failed", { code: error?.code });
          throw new RegistrationError(
            error?.code === "weak_password"
              ? "รหัสผ่านไม่ผ่านข้อกำหนดของระบบ กรุณาเปลี่ยนรหัสผ่าน"
              : "สร้างบัญชีไม่สำเร็จ กรุณาตรวจสอบว่ามีบัญชีนี้อยู่แล้วหรือลองอีกครั้ง",
          );
        }
        return data.user.id;
      },
      async saveProfile(profile, citizenId) {
        // Use the signed-in Admin session so the database checks the active role again.
        const { error } = await context.db.rpc(
          "admin_create_academic_profile",
          {
            p_id: profile.id,
            p_profile: {
              name_prefix: profile.name_prefix,
              first_name: profile.first_name,
              last_name: profile.last_name,
              citizen_id_encrypted: encryptStaffCitizenId(
                citizenId,
                profile.id,
                secret,
              ),
            },
          },
        );
        if (error) {
          console.error("academics: save profile failed", { code: error.code });
          throw new Error("Profile save failed");
        }
      },
      async findProfile(id) {
        const { data, error } = await service
          .from("profiles")
          .select("role")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("Profile verification failed");
        return data;
      },
      async deleteAuth(id) {
        const { error } = await service.auth.admin.deleteUser(id);
        if (error) throw new Error("Auth rollback failed");
      },
    },
    secret,
    "academic",
  );
  if (result.success) revalidatePath("/dashboard/admin");
  return result;
}
