"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { supabase, configured } from "@/lib/supabase";
import { loginEmail, identityPassword } from "@/lib/identity";
import { importSchema } from "@/lib/import";
import { safeReturnPath } from "@/lib/navigation";
import { notifyTeacherOfNewRequest } from "@/lib/push";
import { z } from "zod";
import { isRole } from "@/lib/domain";
export async function signIn(_prev: { error: string }, form: FormData) {
  if (!configured())
    return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล กรุณาติดต่อฝ่ายวิชาการ" };
  const role = String(form.get("role")),
    identifier = String(form.get("identifier") ?? "").trim(),
    credential = String(form.get("password") ?? "");
  if (!isRole(role)) return { error: "กรุณาเลือกประเภทผู้ใช้งาน" };
  const valid =
    role === "student"
      ? /^\d{1,20}$/.test(identifier) && /^\d{13}$/.test(credential)
      : role === "manager"
        ? /^[A-Za-z][A-Za-z0-9_.-]{2,39}$/.test(identifier) &&
          credential.length >= 6
        : /^\d{13}$/.test(identifier);
  if (!valid || credential.length > 128)
    return { error: "กรุณาตรวจสอบข้อมูลเข้าสู่ระบบ" };
  const db = await supabase(),
    secret = process.env.LOGIN_HMAC_SECRET!;
  const bucket = createHmac("sha256", secret)
    .update("rate:" + role + ":" + identifier.toLowerCase())
    .digest("hex");
  const limit = await db.rpc("consume_login_attempt", { p_bucket: bucket });
  if (limit.error)
    return { error: "ระบบยังไม่พร้อมให้บริการ กรุณาติดต่อฝ่ายวิชาการ" };
  if (!limit.data)
    return { error: "พยายามเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที" };
  const password =
    role === "manager"
      ? credential
      : identityPassword(
          role,
          role === "student" ? credential : identifier,
          secret,
        );
  const { error } = await db.auth.signInWithPassword({
    email: loginEmail(role + ":" + identifier, secret),
    password,
  });
  if (error) return { error: "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง" };
  const { data: profile } = await db.from("profiles").select("role").single();
  if (profile?.role !== role) {
    await db.auth.signOut();
    return { error: "ประเภทบัญชีไม่ตรงกัน กรุณาติดต่อฝ่ายวิชาการ" };
  }
  redirect(safeReturnPath(form.get("next")));
}
export async function signOut() {
  if (configured()) {
    const db = await supabase();
    await db.auth.signOut();
  }
  redirect("/");
}

export type AssignmentActionState = { error: string };

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

const assignmentFileTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  txt: "text/plain",
};

export async function assignGrade(
  recordId: string,
  _prev: AssignmentActionState,
  form: FormData,
): Promise<AssignmentActionState> {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  if (!z.uuid().safeParse(recordId).success)
    return { error: "ไม่พบรายการผลการเรียน" };

  const assignment = String(form.get("assignment") ?? "").trim();
  const due = String(form.get("due_at") ?? "");
  const dueAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)
    ? new Date(`${due}+07:00`)
    : null;
  if (
    assignment.length < 10 ||
    assignment.length > 10000 ||
    !dueAt ||
    !Number.isFinite(dueAt.getTime()) ||
    dueAt.getTime() <= Date.now()
  )
    return {
      error: "กรุณาระบุรายละเอียดงานอย่างน้อย 10 ตัวอักษร และกำหนดส่งในอนาคต",
    };

  const files = form
    .getAll("attachments")
    .filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length > 5) return { error: "แนบไฟล์ได้ไม่เกิน 5 ไฟล์" };
  if (files.some((file) => file.size > 4 * 1024 * 1024))
    return { error: "ไฟล์แต่ละไฟล์ต้องมีขนาดไม่เกิน 4 MB" };
  if (files.reduce((total, file) => total + file.size, 0) > 4 * 1024 * 1024)
    return { error: "ไฟล์แนบทั้งหมดต้องมีขนาดรวมไม่เกิน 4 MB" };

  const prepared = files.map((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = assignmentFileTypes[extension];
    return {
      file,
      extension,
      mimeType,
      storage_path: `${recordId}/${randomUUID()}.${extension}`,
    };
  });
  if (prepared.some((item) => !item.mimeType))
    return {
      error: "รองรับเฉพาะ PDF, Word, Excel, PowerPoint, JPG, PNG และ TXT",
    };

  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const { data: record } = await db
    .from("grade_records")
    .select("id,teacher_id,status")
    .eq("id", recordId)
    .single();
  if (!record || record.teacher_id !== user.id || record.status !== "requested")
    return { error: "ไม่มีสิทธิ์มอบหมายงานหรือข้อมูลเปลี่ยนแปลงแล้ว" };

  const uploaded: string[] = [];
  for (const item of prepared) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const { error } = await db.storage
      .from("assignment-files")
      .upload(item.storage_path, bytes, {
        contentType: item.mimeType,
        upsert: false,
      });
    if (error) {
      if (uploaded.length)
        await db.storage.from("assignment-files").remove(uploaded);
      return { error: "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    uploaded.push(item.storage_path);
  }

  const attachmentRows = prepared.map((item) => ({
    storage_path: item.storage_path,
    original_name: item.file.name.slice(0, 180),
    mime_type: item.mimeType,
    size_bytes: item.file.size,
  }));
  const { error } = await db.rpc("assign_grade", {
    p_id: recordId,
    p_assignment: assignment,
    p_due_at: dueAt.toISOString(),
    p_files: attachmentRows,
  });
  if (error) {
    if (uploaded.length)
      await db.storage.from("assignment-files").remove(uploaded);
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/assignments/${recordId}`);
  redirect("/dashboard");
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
  if (requestedRecord)
    await notifyTeacherOfNewRequest({
      recordId: requestedRecord.id,
      teacherId: requestedRecord.teacher_id,
    });
  revalidatePath("/dashboard");
  return { success: true };
}
export async function saveSchedule(input: {
  opens_at: string;
  closes_at: string;
  notice: string;
}) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  if (
    !Number.isFinite(Date.parse(input.opens_at)) ||
    !Number.isFinite(Date.parse(input.closes_at))
  )
    return { error: "กรุณาระบุช่วงเวลาให้ครบ" };
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "academic")
    return { error: "เฉพาะฝ่ายวิชาการเท่านั้นที่ตั้งเวลาเปิด–ปิดระบบได้" };
  const { error } = await db.rpc("update_schedule", {
    p_opens_at: input.opens_at,
    p_closes_at: input.closes_at,
    p_notice: input.notice,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}
export async function importGrades(input: unknown) {
  if (!configured()) return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล" };
  const parsed = z.array(importSchema).min(1).max(2000).safeParse(input);
  if (!parsed.success) return { error: "ข้อมูลนำเข้าไม่ถูกต้อง" };
  const db = await supabase();
  const { data, error } = await db.rpc("import_grades", {
    p_rows: parsed.data,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return {
    success: true,
    inserted: data.inserted as number,
    skipped: data.skipped as number,
  };
}
