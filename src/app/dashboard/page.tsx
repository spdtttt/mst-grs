import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import Workspace from "@/components/workspace";
import type { ArchivedGradeRecord, GradeCorrection, GradeRecord, Profile, Schedule } from "@/lib/domain";
import { isRole } from "@/lib/domain";
export const dynamic = "force-dynamic";
export default async function Dashboard({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  const initialView = (await searchParams).view === "history" ? "history" : "overview";
  if (!configured()) redirect("/");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/");
  const { data: profile, error: pe } = await db
    .from("profiles")
    .select("id,role,full_name,student_code,classroom")
    .eq("id", user.id)
    .single();
  if (!isRole(profile?.role)) redirect("/");
  if (profile.role === "manager") redirect("/dashboard/manager");
  if (profile.role === "admin") redirect("/dashboard/admin");
  const { data: schedule, error: se } = await db
    .from("site_schedule")
    .select("*")
    .eq("id", 1)
    .single();
  if (pe || se || !profile || !schedule)
    throw new Error(
      "ไม่สามารถโหลดบัญชีหรือช่วงเวลาให้บริการ กรุณาติดต่อฝ่ายวิชาการ",
    );
  async function loadRecords(table: "grade_records" | "grade_record_history") {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from(table).select("*")
        .order(table === "grade_record_history" ? "archived_at" : "created_at", { ascending: false })
        .order("id").range(offset, offset + 999);
      if (error) throw new Error(table === "grade_record_history"
        ? "ไม่สามารถโหลดประวัติได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูลประวัติ"
        : "ไม่สามารถโหลดผลการเรียนได้");
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  async function loadCorrections() {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from("grade_corrections").select("*")
        .order("changed_at", { ascending: false }).order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("ไม่สามารถโหลดประวัติการแก้ไขผลการเรียนได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูล");
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  const [records, history, corrections] = await Promise.all([
    loadRecords("grade_records"), loadRecords("grade_record_history"),
    profile.role === "teacher" ? loadCorrections() : Promise.resolve([]),
  ]);
  return (
    <Workspace
      profile={profile as Profile}
      records={records as GradeRecord[]}
      historyRecords={history as ArchivedGradeRecord[]}
      gradeCorrections={corrections as GradeCorrection[]}
      initialView={initialView}
      schedule={schedule as Schedule}
    />
  );
}
