"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { supabase, configured } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { signInForRole } from "@/lib/role-login";
import { loginSchema } from "@/lib/auth-input";
import { importSchema } from "@/lib/import";
import { roleReturnPath } from "@/lib/navigation";
import { notifyTeacherOfNewRequest } from "@/lib/push";
import { z } from "zod";
import {
  assignmentFileMimeType, assignmentFileSchema, uploadedAssignmentFileSchema,
  parseAssignmentDetails, validateAssignmentFiles, type AssignmentUpload,
} from "@/lib/assignment-files";
import type { GradeCorrection } from "@/lib/domain";
import { scheduleDates } from "@/lib/schedule-dates";
export async function signIn(_prev: { error: string }, form: FormData) {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.LOGIN_HMAC_SECRET?.length ?? 0) < 32)
    return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล กรุณาติดต่อฝ่ายวัดผล" };
  const parsed = loginSchema.safeParse({ role: form.get("role"), identifier: form.get("identifier"), password: form.get("password") });
  if (!parsed.success)
    return { error: "กรุณาตรวจสอบข้อมูลเข้าสู่ระบบ" };
  const { role, identifier, password: credential } = parsed.data;
  const db = await supabase(),
    secret = process.env.LOGIN_HMAC_SECRET!;
  const bucket = createHmac("sha256", secret)
    .update("rate:" + (["teacher", "academic", "admin"].includes(role) ? "staff" : role) + ":" + identifier.toLowerCase())
    .digest("hex");
  const limit = await db.rpc("consume_login_attempt", { p_bucket: bucket });
  if (limit.error)
    return { error: "ระบบยังไม่พร้อมให้บริการ กรุณาติดต่อฝ่ายวัดผล" };
  if (!limit.data)
    return { error: "พยายามเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที" };
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await signInForRole({ role, identifier, password: credential }, {
    async resolveStaff(emails, selectedRole) {
      const { data, error } = await service.rpc("resolve_staff_login", { p_emails: emails, p_role: selectedRole });
      if (error) {
        console.error("login: resolve staff failed", { code: error.code });
        throw new Error("Staff login lookup failed");
      }
      return data as string | null;
    },
    async signIn(email, password) {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error || !data.user || !data.session) return null;
      return { userId: data.user.id, accessToken: data.session.access_token };
    },
    async activate(sessionId, userId, selectedRole) {
      const { error } = await service.rpc("activate_login_role", {
        p_session_id: sessionId, p_user_id: userId, p_role: selectedRole,
      });
      if (error) {
        console.error("login: activate role failed", { code: error.code });
        throw new Error("Login role activation failed");
      }
    },
    async signOut() { await db.auth.signOut({ scope: "local" }); },
  }, secret);
  if (result.error) return result;
  redirect(roleReturnPath(role, form.get("next")));
}
export async function signOut() {
  if (configured()) {
    const db = await supabase();
    await db.auth.signOut();
  }
  redirect("/");
}

export type AssignmentActionState = { error: string; success?: boolean };

const pushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => value.startsWith("https://")),
  keys: z.object({
    p256dh: z.string().min(20).max(512),
    auth: z.string().min(8).max(256),
  }),
});

export async function savePushSubscription(input: unknown) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "ข้อมูลการแจ้งเตือนไม่ถูกต้อง" };

  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const userAgent = ((await headers()).get("user-agent") ?? "").slice(0, 512);
  const { error } = await db.rpc("upsert_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent,
  });
  return error ? { error: error.message } : { success: true };
}

export async function removePushSubscription(endpoint: string) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  const parsed = z
    .url()
    .max(2048)
    .refine((value) => value.startsWith("https://"))
    .safeParse(endpoint);
  if (!parsed.success) return { error: "ข้อมูลการแจ้งเตือนไม่ถูกต้อง" };
  const db = await supabase();
  const { error } = await db.rpc("delete_push_subscription", {
    p_endpoint: parsed.data,
  });
  return error ? { error: error.message } : { success: true };
}

async function assignmentContext(recordId: string, form: FormData) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  if (!z.uuid().safeParse(recordId).success)
    return { error: "ไม่พบรายการผลการเรียน" };

  const details = parseAssignmentDetails(form);
  if (details.error) return { error: details.error };
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const { data: record, error } = await db
    .from("grade_records")
    .select("id,teacher_id,status")
    .eq("id", recordId)
    .single();
  if (error) return { error: "ไม่สามารถตรวจสอบสิทธิ์มอบหมายงานได้ กรุณาลองใหม่" };
  if (
    !record ||
    !record.teacher_id?.includes(user.id) ||
    record.status !== details.expectedStatus
  )
    return { error: "ไม่มีสิทธิ์แก้ไขหรือมอบหมายงานเพิ่มแล้ว กรุณาโหลดหน้าใหม่" };

  return { db, ...details };
}

export async function prepareAssignmentUploads(
  recordId: string,
  form: FormData,
  input: unknown,
): Promise<{ error: string; uploads?: AssignmentUpload[] }> {
  const parsed = z.array(assignmentFileSchema).safeParse(input);
  if (!parsed.success) return { error: "ข้อมูลไฟล์แนบไม่ถูกต้อง" };
  const fileError = validateAssignmentFiles(parsed.data);
  if (fileError) return { error: fileError };
  const context = await assignmentContext(recordId, form);
  if (!("db" in context)) return { error: context.error };
  const uploads: AssignmentUpload[] = [];
  for (const file of parsed.data) {
    const extension = file.name.split(".").pop()!.toLowerCase();
    const path = `${recordId}/${randomUUID()}.${extension}`;
    const { data, error } = await context.db.storage.from("assignment-files")
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data) {
      console.error("assignment: prepare upload failed", { recordId, code: error?.name });
      return { error: "ไม่สามารถเตรียมอัปโหลดได้ กรุณาตรวจสอบสิทธิ์และช่วงเวลาให้บริการ" };
    }
    uploads.push({ ...file, storage_path: path, token: data.token, mime_type: assignmentFileMimeType(file.name)! });
  }
  return { error: "", uploads };
}

export async function cleanupAssignmentUploads(recordId: string, paths: string[]) {
  const parsed = z.array(z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]+$/)).safeParse(paths);
  if (!configured() || !z.uuid().safeParse(recordId).success || !parsed.success ||
    parsed.data.some((path) => !path.startsWith(`${recordId}/`))) return;
  const db = await supabase();
  // RLS permits only the owning teachers to remove files not linked to a task.
  await db.storage.from("assignment-files").remove(parsed.data);
}

export async function assignGrade(
  recordId: string,
  _prev: AssignmentActionState,
  form: FormData,
): Promise<AssignmentActionState> {
  const context = await assignmentContext(recordId, form);
  if (!("db" in context)) return { error: context.error };
  const { db, expectedStatus, assignment, dueAt } = context;
  let input: unknown;
  try { input = JSON.parse(String(form.get("attachments_metadata") ?? "[]")); }
  catch { return { error: "ข้อมูลไฟล์แนบไม่ถูกต้อง" }; }
  const parsed = z.array(uploadedAssignmentFileSchema).safeParse(input);
  if (!parsed.success || parsed.data.some((file) => !file.storage_path.startsWith(`${recordId}/`)))
    return { error: "ข้อมูลไฟล์แนบไม่ถูกต้อง" };
  const fileError = validateAssignmentFiles(parsed.data);
  if (fileError) return { error: fileError };
  if (form.getAll("attachments").some((item) => item instanceof File && item.size > 0))
    return { error: "กรุณาโหลดหน้าใหม่ก่อนอัปโหลดไฟล์" };
  const attachmentRows = parsed.data.map((file) => ({
    storage_path: file.storage_path,
    original_name: file.name,
    mime_type: assignmentFileMimeType(file.name),
    size_bytes: file.size,
  }));
  const { error } = await db.rpc("assign_grade", {
    p_id: recordId,
    p_expected: expectedStatus,
    p_assignment: assignment,
    p_due_at: dueAt.toISOString(),
    p_files: attachmentRows,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/assignments/${recordId}`);
  return { error: "", success: true };
}

export async function advance(input: {
  id: string;
  expected: string;
  assignment?: string;
  due_at?: string;
  final_grade?: string;
}) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  const db = await supabase();
  const { data: requestedRecord } =
    input.expected === "pending" && z.uuid().safeParse(input.id).success
      ? await db
          .from("grade_records")
          .select("id,teacher_id")
          .eq("id", input.id)
          .eq("status", "pending")
          .maybeSingle()
      : { data: null };
  const { error } = await db.rpc("advance_grade", {
    p_id: input.id,
    p_expected: input.expected,
    p_assignment: input.assignment ?? null,
    p_due_at: input.due_at ?? null,
    p_final_grade: input.final_grade ?? null,
  });
  if (error) return { error: error.message };
  if (requestedRecord) {
    const teacherIds = Array.isArray(requestedRecord.teacher_id)
      ? requestedRecord.teacher_id
      : typeof requestedRecord.teacher_id === "string"
        ? [requestedRecord.teacher_id]
        : [];
    after(async () => {
      try {
        await notifyTeacherOfNewRequest({
          recordId: requestedRecord.id,
          teacherIds,
        });
      } catch (notificationError) {
        console.error(
          "Unable to notify teachers after grade request:",
          notificationError,
        );
      }
    });
  }
  revalidatePath("/dashboard");
  return { success: true };
}
export async function correctFinalGrade(input: {
  id: string;
  expectedGrade: string;
  newGrade: string;
}): Promise<{ error?: string; correction?: GradeCorrection }> {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  if (!z.uuid().safeParse(input.id).success ||
    !["0", "ร", "มผ", "1", "1.5", "2", "2.5", "3", "3.5", "4", "ผ"].includes(input.newGrade))
    return { error: "ข้อมูลผลการเรียนไม่ถูกต้อง" };
  const db = await supabase();
  const { data, error } = await db.rpc("correct_final_grade", {
    p_id: input.id,
    p_expected: input.expectedGrade,
    p_new: input.newGrade,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { correction: data as GradeCorrection };
}
export async function saveSchedule(input: {
  opens_on: string;
  closes_on: string;
  notice: string;
}) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  const range = scheduleDates(input.opens_on, input.closes_on);
  if (!range)
    return { error: "กรุณาระบุวันที่ให้ครบ โดยวันปิดต้องเป็นวันเดียวกับหรือหลังวันเปิดระบบ" };
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const { data: role, error: roleError } = await db.rpc("my_role");
  if (roleError || role !== "admin")
    return { error: "เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งเวลาเปิด–ปิดระบบได้" };
  const { error } = await db.rpc("update_schedule", {
    p_opens_at: range.opens_at,
    p_closes_at: range.closes_at,
    p_notice: input.notice,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/admin");
  return { success: true };
}
export async function importGrades(input: unknown) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  const parsed = z.array(importSchema).min(1).max(2000).safeParse(input);
  if (!parsed.success) return { error: "ข้อมูลนำเข้าไม่ถูกต้อง" };
  const db = await supabase();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const { data: role, error: roleError } = await db.rpc("my_role");
  if (roleError || role !== "admin")
    return { error: "เฉพาะผู้ดูแลระบบเท่านั้นที่นำเข้าข้อมูลได้" };
  const { data, error } = await db.rpc("import_grades_overwrite", {
    p_rows: parsed.data,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/admin");
  return {
    success: true,
    inserted: data.inserted as number,
    updated: data.updated as number,
    skipped: data.skipped as number,
  };
}
