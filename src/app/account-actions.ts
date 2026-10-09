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
import { deleteAuthUserAfterRoleDelete } from "@/lib/account-auth-cleanup";
import { passwordSchema } from "@/lib/auth-input";
import {
  ManagerAccountError,
  provisionManager,
} from "@/lib/manager-provisioning";
import { teacherRegistryError } from "@/lib/teacher-registry";
import { parseTeacherName } from "@/lib/teacher-registry";
import { decryptStaffCitizenId, staffCitizenHash } from "@/lib/staff-identity";
import {
  completeStaffAuthReset,
  RejectedAuthDelete,
  type ResetOperation,
  type ResetFile,
  type ResetResult,
} from "@/lib/staff-auth-reset";

function accountError(error: { message: string; code?: string }) {
  if (error.message.startsWith("REGISTRY_"))
    return teacherRegistryError(error.message);
  const messages: Record<string, string> = {
    ACCOUNT_FORBIDDEN: "เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการได้",
    ACCOUNT_INVALID: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    ACCOUNT_NOT_FOUND: "ไม่พบบัญชีในบทบาทนี้ กรุณาโหลดรายชื่อใหม่",
    ACCOUNT_PROTECTED: "ไม่สามารถแก้ไขหรือลบบัญชีผู้ดูแลระบบจากหน้านี้ได้",
    ACCOUNT_CHANGED: "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดรายชื่อใหม่ก่อนลองอีกครั้ง",
    ACCOUNT_OUTSTANDING:
      "ลบไม่ได้ เนื่องจากยังมีผลการเรียนคงค้าง สามารถรีเซ็ทรหัสผ่านได้โดยข้อมูลเดิมยังอยู่",
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
): Promise<{
  success?: boolean;
  error?: string;
  profile_retained?: boolean;
  auth_deleted?: boolean;
  auth_user_id?: string;
}> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = accountTargetSchema.safeParse(input);
  if (!parsed.success)
    return { error: "ข้อมูลบัญชีไม่ถูกต้อง กรุณาโหลดรายชื่อใหม่" };
  const { id, role, expected_revision } = parsed.data;
  const { data, error } = await context.db.rpc("admin_delete_account", {
    p_id: id,
    p_role: role,
    p_expected_revision: expected_revision,
  });
  if (error) return { error: accountError(error) };
  if (data?.deleted !== true)
    return { error: "ยังยืนยันการลบไม่ได้ กรุณาโหลดรายชื่อใหม่" };
  revalidatePath("/dashboard", "layout");
  if (data.profile_retained === true)
    return { success: true, profile_retained: true };
  // Last role removed: the profile is gone, so also remove the Auth account.
  const service = serviceClient();
  const cleanup = service
    ? await deleteAuthUserAfterRoleDelete(service, id)
    : { ok: false };
  return cleanup.ok
    ? { success: true, profile_retained: false, auth_deleted: true }
    : {
        success: true,
        profile_retained: false,
        auth_deleted: false,
        auth_user_id: id,
      };
}

export async function resetStaffAuth(input: unknown): Promise<ResetResult> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = accountTargetSchema
    .extend({ role: z.enum(["teacher", "academic"]) })
    .safeParse(input);
  if (!parsed.success)
    return { error: "ข้อมูลบัญชีไม่ถูกต้อง กรุณาโหลดรายชื่อใหม่" };
  const { id, role } = parsed.data;
  const service = serviceClient();
  if (!service) return { error: "ระบบรีเซ็ตบัญชียังไม่พร้อมให้บริการ" };
  let revision = parsed.data.expected_revision;
  let result = await context.db.rpc("admin_begin_staff_auth_reset", {
    p_id: id,
    p_role: role,
    p_expected_revision: revision,
  });
  if (result.error?.message === "REGISTRY_IDENTITY_MISSING") {
    const secret = process.env.LOGIN_HMAC_SECRET;
    if (!secret || secret.length < 32)
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
          "มีโปรไฟล์แล้ว แต่ยังไม่มีเลขบัตรประชาชนที่ใช้สร้างบัญชีกลับ กรุณาเตรียมข้อมูลทะเบียนก่อนรีเซ็ต",
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
    result = await context.db.rpc("admin_begin_staff_auth_reset", {
      p_id: id,
      p_role: role,
      p_expected_revision: revision,
    });
  }
  const { data, error } = result;
  if (error) return { error: accountError(error) };
  if (!data || !["files", "deleting", "complete"].includes(data.stage))
    return { error: "ยังยืนยันการรีเซ็ตไม่ได้ กรุณาโหลดรายชื่อใหม่" };
  const rpc = async (name: string, token: string) => {
    const response = await service.rpc(name, { p_id: id, p_token: token });
    if (response.error) throw new Error(response.error.message);
    return response.data;
  };
  try {
    const reset = await completeStaffAuthReset(data as ResetOperation, {
      async files(token) {
        return (await rpc("staff_reset_files", token)) as ResetFile[];
      },
      async preserve(file) {
        // Copy inside Storage instead of downloading/re-uploading large files.
        // The service credential has no user owner; the path remains unchanged.
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/copy`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              "Content-Type": "application/json",
              "x-upsert": "true",
            },
            body: JSON.stringify({
              bucketId: file.bucket,
              sourceKey: file.name,
              destinationKey: file.name,
              ...(file.version ? { sourceVersionId: file.version } : {}),
              copyMetadata: true,
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) throw new Error("Storage preservation failed");
        const copied = await response.json();
        if (
          copied.owner_id === id ||
          copied.owner === id ||
          (file.metadata?.size !== undefined &&
            copied.metadata?.size !== file.metadata.size)
        )
          throw new Error("Storage preservation could not be verified");
      },
      async claimDelete(token) {
        return (await rpc("claim_staff_auth_delete", token)) === true;
      },
      async deleteAuth() {
        const deleted = await service.auth.admin.deleteUser(id);
        if (deleted.error) {
          if (
            deleted.error.status &&
            deleted.error.status >= 400 &&
            deleted.error.status < 500 &&
            deleted.error.status !== 408
          )
            throw new RejectedAuthDelete("Auth rejected deletion");
          throw new Error("Auth deletion not confirmed");
        }
      },
      async retryAfterRejectedDelete(token) {
        await rpc("retry_staff_auth_reset", token);
      },
      async authExists() {
        const found = await service.auth.admin.getUserById(id);
        if (found.error) {
          if (
            found.error.status === 404 ||
            found.error.code === "user_not_found"
          )
            return false;
          throw new Error("Auth lookup not confirmed");
        }
        return Boolean(found.data.user);
      },
      async finish(token) {
        return await rpc("finish_staff_auth_reset", token);
      },
    });
    revalidatePath("/dashboard", "layout");
    return reset;
  } catch {
    return {
      error:
        "รีเซ็ตยังไม่เสร็จ ข้อมูลและไฟล์ยังอยู่ กรุณาโหลดรายชื่อใหม่แล้วลองรีเซ็ตอีกครั้ง",
      account_revision: data.account_revision,
    };
  }
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
