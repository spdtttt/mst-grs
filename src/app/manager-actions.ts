"use server";

import { z } from "zod";
import { managerStatsViewerProfile } from "@/lib/manager-auth";
import {
  managerStudentPageSize,
  type ManagerStudentCourse,
  type ManagerStudentList,
} from "@/lib/manager-stats";
import { supabase } from "@/lib/supabase";

const listRequest = z.object({
  completed: z.boolean(),
  page: z.number().int().min(1).max(50000),
  query: z.string().trim().max(80),
  level: z.number().int().min(1).max(6).nullable(),
  academicYear: z.number().int().min(2500).max(2700).nullable(),
  semester: z.number().int().min(1).max(3).nullable(),
});

export async function loadManagerStudents(
  input: unknown,
): Promise<
  { data: ManagerStudentList; error: null } | { data: null; error: string }
> {
  await managerStatsViewerProfile();
  const parsed = listRequest.safeParse(input);
  if (!parsed.success) return { data: null, error: "ข้อมูลค้นหาไม่ถูกต้อง" };
  const { completed, page, query, level, academicYear, semester } = parsed.data;
  const db = await supabase();
  const { data, error } = await db.rpc("manager_student_list_filtered", {
    p_completed: completed,
    p_query: query,
    p_limit: managerStudentPageSize,
    p_offset: (page - 1) * managerStudentPageSize,
    p_level: level,
    p_academic_year: academicYear,
    p_semester: semester,
  });
  if (error || !data)
    return {
      data: null,
      error:
        "ยังไม่สามารถโหลดรายชื่อนักเรียนได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูล",
    };
  return { data: data as ManagerStudentList, error: null };
}

const detailRequest = z.string().trim().min(1).max(40);

export async function loadManagerStudentCourses(
  input: unknown,
): Promise<
  { data: ManagerStudentCourse[]; error: null } | { data: null; error: string }
> {
  await managerStatsViewerProfile();
  const parsed = detailRequest.safeParse(input);
  if (!parsed.success)
    return { data: null, error: "รหัสนักเรียนไม่ถูกต้อง" };

  const db = await supabase();
  const { data, error } = await db.rpc("manager_student_courses", {
    p_student_code: parsed.data,
  });
  if (error || !data)
    return { data: null, error: "ไม่สามารถโหลดรายละเอียดรายวิชาได้ กรุณาลองอีกครั้ง" };
  return { data: data as ManagerStudentCourse[], error: null };
}
