"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { adminContext } from "@/lib/admin-auth";
import type { TeacherList } from "@/lib/teachers";

export async function listTeachers(
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
  const { data, error } = await context.db.rpc("admin_teacher_list", {
    p_search: parsed.data.search,
    p_page: parsed.data.page,
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
          .replaceAll("คุณครู", "ฝ่ายวิชาการ")
          .replaceAll("สิทธิ์ครู", "สิทธิ์ฝ่ายวิชาการ"),
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
