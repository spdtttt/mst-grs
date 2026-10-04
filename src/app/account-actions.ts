"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext } from "@/lib/admin-auth";
import {
  accountEditSchema,
  accountTargetSchema,
  managerInputSchema,
  type AccountList,
  type AccountRow,
} from "@/lib/admin-accounts";
import { passwordSchema } from "@/lib/auth-input";
import {
  ManagerAccountError,
  provisionManager,
} from "@/lib/manager-provisioning";
import { teacherRegistryError } from "@/lib/teacher-registry";
import { parseTeacherName } from "@/lib/teacher-registry";
import { decryptStaffCitizenId, staffCitizenHash } from "@/lib/staff-identity";

function accountError(error: { message: string; code?: string }) {
  if (error.message.startsWith("REGISTRY_"))
    return teacherRegistryError(error.message);
  const messages: Record<string, string> = {
    ACCOUNT_FORBIDDEN: "เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการได้",
    ACCOUNT_INVALID: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    ACCOUNT_NOT_FOUND: "ไม่พบบัญชีในบทบาทนี้ กรุณาโหลดรายชื่อใหม่",
    ACCOUNT_PROTECTED: "ไม่สามารถแก้ไขหรือลบบัญชีผู้ดูแลระบบจากหน้านี้ได้",
    ACCOUNT_CHANGED: "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดรายชื่อใหม่ก่อนลองอีกครั้ง",
    ACCOUNT_REFERENCED:
      "ลบบัญชีไม่ได้ เนื่องจากมีผลการเรียน ประวัติ งาน หรือไฟล์อ้างอิงอยู่",
  };
  return (
    messages[error.message] ??
    (error.code === "23503"
      ? "ลบบัญชีไม่ได้ เนื่องจากมีข้อมูลอื่นอ้างอิงอยู่"
      : "ดำเนินการไม่สำเร็จ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง")
  );
}
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function listManagers(
  input: unknown,
): Promise<{ data?: AccountList; error?: string }> {
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
    p_role: "manager",
    p_search: parsed.data.search,
    p_page: parsed.data.page,
  });
  return error ? { error: accountError(error) } : { data: data as AccountList };
}

export async function createManager(
  input: unknown,
): Promise<{ success?: boolean; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = managerInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const service = serviceClient(),
    secret = process.env.LOGIN_HMAC_SECRET;
  if (!service || !secret || secret.length < 32)
    return {
      error: "ระบบสร้างบัญชียังไม่พร้อม กรุณาตรวจสอบการตั้งค่าเซิร์ฟเวอร์",
    };
  const result = await provisionManager(
    parsed.data,
    {
      async createAuth(email, password) {
        const { data, error } = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { role: "manager" },
        });
        if (error || !data.user)
          throw new ManagerAccountError(
            error?.code === "email_exists" || error?.code === "email_conflict"
              ? "ชื่อผู้ใช้งานนี้มีบัญชีอยู่แล้ว"
              : error?.code === "weak_password"
                ? "รหัสผ่านไม่ผ่านข้อกำหนดของระบบ กรุณาเปลี่ยนรหัสผ่าน"
                : "สร้างบัญชีเข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
          );
        return data.user.id;
      },
      async saveProfile(profile) {
        const { error } = await context.db.rpc("admin_create_manager_profile", {
          p_id: profile.id,
          p_profile: {
            name_prefix: profile.name_prefix,
            first_name: profile.first_name,
            last_name: profile.last_name,
            username: profile.username,
          },
        });
        if (error)
          throw new ManagerAccountError(
            error.code === "23505"
              ? "ชื่อผู้ใช้งานนี้มีบัญชีอยู่แล้ว"
              : accountError(error),
          );
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
  );
  if (result.success) revalidatePath("/dashboard/admin");
  return result;
}

export async function editAccount(
  input: unknown,
): Promise<{ data?: AccountRow; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = accountEditSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { id, role, expected_revision, ...changes } = parsed.data;
  const { data, error } = await context.db.rpc("admin_edit_account", {
    p_id: id,
    p_role: role,
    p_expected_revision: expected_revision,
    p_changes: changes,
  });
  if (error) return { error: accountError(error) };
  revalidatePath("/dashboard", "layout");
  return { data: data as AccountRow };
}

export async function deleteAccount(
  input: unknown,
): Promise<{ success?: boolean; error?: string; account_revision?: number }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = accountTargetSchema.safeParse(input);
  if (!parsed.success)
    return { error: "ข้อมูลบัญชีไม่ถูกต้อง กรุณาโหลดรายชื่อใหม่" };
  const { id, role } = parsed.data;
  let revision = parsed.data.expected_revision;
  let result = await context.db.rpc("admin_delete_account", {
    p_id: id,
    p_role: role,
    p_expected_revision: revision,
  });
  if (result.error?.message === "REGISTRY_IDENTITY_MISSING") {
    const service = serviceClient(),
      secret = process.env.LOGIN_HMAC_SECRET;
    if (!service || !secret || secret.length < 32)
      return {
        error:
          "ระบบอ่านเลขบัตรเดิมยังไม่พร้อม กรุณาตรวจสอบการตั้งค่าเซิร์ฟเวอร์",
      };
    const found = await service
      .from("profiles")
      .select("citizen_id_encrypted,full_name,name_prefix,first_name,last_name")
      .eq("id", id)
      .maybeSingle();
    if (found.error) return { error: "อ่านทะเบียนไม่สำเร็จ กรุณาลองใหม่" };
    const profile = found.data;
    if (!profile?.citizen_id_encrypted)
      return {
        error:
          "มีโปรไฟล์แล้ว แต่ยังไม่มีเลขบัตรประชาชนที่ใช้สมัครใหม่ กรุณานำเข้าทะเบียนครูด้วยเลขบัตรเดิมก่อนรีเซ็ต",
      };
    let hash: string,
      names: { name_prefix: string; first_name: string; last_name: string };
    try {
      hash = staffCitizenHash(
        decryptStaffCitizenId(profile.citizen_id_encrypted, id, secret),
        secret,
      );
      names =
        profile.first_name?.trim() && profile.last_name?.trim()
          ? {
              name_prefix: profile.name_prefix ?? "",
              first_name: profile.first_name,
              last_name: profile.last_name,
            }
          : parseTeacherName(profile.full_name);
    } catch {
      return {
        error:
          "อ่านเลขบัตรหรือชื่อจากทะเบียนเดิมไม่ได้ กรุณาตรวจสอบคีย์เข้ารหัสและข้อมูลทะเบียนก่อนรีเซ็ต",
      };
    }
    const prepared = await service.rpc("prepare_teacher_reset_identity", {
      p_actor: context.user.id,
      p_id: id,
      p_expected_revision: revision,
      p_ciphertext: profile.citizen_id_encrypted,
      p_hash: hash,
      p_names: names,
    });
    if (prepared.error) return { error: accountError(prepared.error) };
    if (!Number.isInteger(prepared.data))
      return { error: "ยืนยันข้อมูลทะเบียนไม่ได้ กรุณาโหลดรายชื่อใหม่" };
    revision = prepared.data;
    result = await context.db.rpc("admin_delete_account", {
      p_id: id,
      p_role: role,
      p_expected_revision: revision,
    });
  }
  const { data, error } = result;
  if (error) return { error: accountError(error) };
  if (data?.deleted !== true)
    return { error: "ยังยืนยันการลบไม่ได้ กรุณาโหลดรายชื่อใหม่" };
  revalidatePath("/dashboard/admin");
  return { success: true, account_revision: data.account_revision ?? revision };
}

export async function resetManagerPassword(
  input: unknown,
): Promise<{ success?: boolean; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = accountTargetSchema
    .extend({ role: z.literal("manager"), password: passwordSchema })
    .safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { id, expected_revision, password } = parsed.data;
  const target = { p_id: id, p_expected_revision: expected_revision };
  const checked = await context.db.rpc("admin_manager_password_target", target);
  if (checked.error) return { error: accountError(checked.error) };
  const service = serviceClient();
  if (!service)
    return {
      error: "ระบบตั้งรหัสผ่านยังไม่พร้อม กรุณาตรวจสอบการตั้งค่าเซิร์ฟเวอร์",
    };
  const { error } = await service.auth.admin.updateUserById(id, { password });
  if (error)
    return {
      error:
        error.code === "weak_password"
          ? "รหัสผ่านไม่ผ่านข้อกำหนดของระบบ"
          : "ตั้งรหัสผ่านไม่สำเร็จ กรุณาลองอีกครั้ง",
    };
  const finished = await context.db.rpc(
    "admin_finish_manager_password_reset",
    target,
  );
  if (finished.error)
    return {
      error:
        "เปลี่ยนรหัสผ่านแล้ว แต่ยกเลิกเซสชันเดิมไม่สำเร็จ กรุณาลองตั้งรหัสผ่านอีกครั้ง",
    };
  return { success: true };
}
