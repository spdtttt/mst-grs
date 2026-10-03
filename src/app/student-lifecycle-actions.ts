"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext } from "@/lib/admin-auth";
import {
  STUDENT_PREVIEW_BATCH_SIZE,
  type StudentImportSummary,
} from "@/lib/student-import-preview";
import {
  lifecycleChangeSchema,
  lifecycleChangeResultSchema,
  type LifecycleChangeResult,
  lifecycleFilterSchema,
  type LifecycleList,
} from "@/lib/student-lifecycle";

function message(error: { message: string }) {
  if (error.message === "STUDENT_LIFECYCLE_CHANGED")
    return "ข้อมูลนักเรียนบางคนเปลี่ยนไปแล้ว กรุณาโหลดรายชื่อใหม่และเลือกอีกครั้ง ยังไม่มีการบันทึกชุดนี้";
  if (error.message === "STUDENT_LIFECYCLE_FORBIDDEN")
    return "เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการได้";
  if (error.message === "STUDENT_LIFECYCLE_INVALID")
    return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบรายการและปีการศึกษา";
  return "ดำเนินการไม่สำเร็จ กรุณาโหลดรายชื่อใหม่ หากยังใช้งานไม่ได้ให้ตรวจสอบการติดตั้ง migration 037 และ 038";
}

export async function previewStudentImport(input: unknown): Promise<{
  data?: StudentImportSummary;
  error?: string;
}> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = z
    .array(z.string().regex(/^\d{5,10}$/))
    .min(1)
    .max(STUDENT_PREVIEW_BATCH_SIZE)
    .safeParse(input);
  if (!parsed.success) return { error: "รหัสนักเรียนไม่ถูกต้อง" };
  const { data, error } = await context.db.rpc("admin_student_import_summary", {
    p_codes: parsed.data,
  });
  return error ? { error: message(error) } : { data };
}
export async function listStudentLifecycle(
  input: unknown,
): Promise<{ data?: LifecycleList; error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = lifecycleFilterSchema.safeParse(input);
  if (!parsed.success) return { error: "ตัวกรองไม่ถูกต้อง" };
  const v = parsed.data;
  const { data, error } = await context.db.rpc("admin_student_lifecycle_list", {
    p_search: v.search,
    p_status: v.status,
    p_level: v.level,
    p_classroom: v.classroom,
    p_page: v.page,
    p_page_size: v.pageSize,
  });
  return error ? { error: message(error) } : { data: data as LifecycleList };
}
export async function changeStudentStatus(
  input: unknown,
): Promise<Partial<LifecycleChangeResult> & { error?: string }> {
  const context = await adminContext();
  if ("error" in context) return { error: context.error };
  const parsed = lifecycleChangeSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { data, error } = await context.db.rpc("admin_set_student_status", {
    p_students: parsed.data.students,
    p_status: parsed.data.status,
    p_year: parsed.data.year,
  });
  if (error)
    return {
      error:
        error.code === "PGRST202"
          ? "กรุณาติดตั้ง migration 038 ก่อนใช้งานการเปลี่ยนสถานะนักเรียน"
          : message(error),
    };
  const result = lifecycleChangeResultSchema.safeParse(data);
  if (!result.success)
    return {
      error: "ไม่สามารถยืนยันผลได้ กรุณาโหลดรายชื่อใหม่ก่อนลองอีกครั้ง",
    };
  revalidatePath("/dashboard/admin");
  return result.data;
}
