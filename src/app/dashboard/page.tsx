import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import Workspace from "@/components/workspace";
import type { GradeRecord, Profile, Schedule } from "@/lib/domain";
import { isRole } from "@/lib/domain";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  if (!configured()) redirect("/");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/");
  const { data: profile, error: pe } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!isRole(profile?.role)) redirect("/");
  if (profile.role === "manager") redirect("/dashboard/manager");
  const { data: schedule, error: se } = await db
    .from("site_schedule")
    .select("*")
    .eq("id", 1)
    .single();
  if (pe || se || !profile || !schedule)
    throw new Error(
      "ไม่สามารถโหลดบัญชีหรือช่วงเวลาให้บริการ กรุณาติดต่อฝ่ายวิชาการ",
    );
  const records: GradeRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("grade_records")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error("ไม่สามารถโหลดผลการเรียนได้");
    records.push(...data);
    if (data.length < 1000) break;
  }
  return (
    <Workspace
      profile={profile as Profile}
      records={records}
      schedule={schedule as Schedule}
    />
  );
}
