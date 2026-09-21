"use server";

import { z } from "zod";
import { managerProfile } from "@/lib/manager-auth";
import {
  managerStudentPageSize,
  type ManagerStudentList,
} from "@/lib/manager-stats";
import { supabase } from "@/lib/supabase";

const listRequest = z.object({
  completed: z.boolean(),
  page: z.number().int().min(1).max(50000),
  query: z.string().trim().max(80),
});

export async function loadManagerStudents(
  input: unknown,
): Promise<
  { data: ManagerStudentList; error: null } | { data: null; error: string }
> {
  await managerProfile();
  const parsed = listRequest.safeParse(input);
  if (!parsed.success) return { data: null, error: "ข้อมูลค้นหาไม่ถูกต้อง" };
  const { completed, page, query } = parsed.data;
  const db = await supabase();
  const { data, error } = await db.rpc("manager_student_list", {
    p_completed: completed,
    p_query: query,
    p_limit: managerStudentPageSize,
    p_offset: (page - 1) * managerStudentPageSize,
  });
  if (error || !data)
    return {
      data: null,
      error:
        "ยังไม่สามารถโหลดรายชื่อนักเรียนได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูล",
    };
  return { data: data as ManagerStudentList, error: null };
}
