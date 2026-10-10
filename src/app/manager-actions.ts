"use server";

import { z } from "zod";
import { managerStatsViewerProfile } from "@/lib/manager-auth";
import {
  managerStudentPageSize,
  type ManagerStudentCourse,
  type ManagerStudentList,
  type ManagerStudentRow,
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

const exportRequest = listRequest.omit({ page: true });
// The list RPC caps each call at 100 rows, so export walks the pages.
const exportPageSize = 100;
const exportBatch = 5;
const exportMaxStudents = 20000;

export async function exportManagerStudents(
  input: unknown,
): Promise<
  { data: ManagerStudentRow[]; error: null } | { data: null; error: string }
> {
  await managerStatsViewerProfile();
  const parsed = exportRequest.safeParse(input);
  if (!parsed.success) return { data: null, error: "ข้อมูลค้นหาไม่ถูกต้อง" };
  const { completed, query, level, academicYear, semester } = parsed.data;
  const db = await supabase();
  const failure = {
    data: null,
    error: "ไม่สามารถส่งออกรายชื่อนักเรียนได้ กรุณาลองอีกครั้ง",
  } as const;
  async function fetchPage(index: number) {
    const { data, error } = await db.rpc("manager_student_list_filtered", {
      p_completed: completed,
      p_query: query,
      p_limit: exportPageSize,
      p_offset: index * exportPageSize,
      p_level: level,
      p_academic_year: academicYear,
      p_semester: semester,
    });
    return error || !data ? null : (data as ManagerStudentList);
  }

  const first = await fetchPage(0);
  if (!first) return failure;
  if (first.total > exportMaxStudents)
    return {
      data: null,
      error: `มีนักเรียนมากกว่า ${exportMaxStudents.toLocaleString("th-TH")} คน กรุณากรองข้อมูลให้แคบลงก่อนส่งออก`,
    };
  const rows = [...first.items];
  const pageCount = Math.ceil(first.total / exportPageSize);
  for (let start = 1; start < pageCount; start += exportBatch) {
    const batch = await Promise.all(
      Array.from(
        { length: Math.min(exportBatch, pageCount - start) },
        (_, offset) => fetchPage(start + offset),
      ),
    );
    for (const page of batch) {
      if (!page) return failure;
      rows.push(...page.items);
    }
  }
  return { data: rows, error: null };
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
