import { redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { isRole, type Profile, type Schedule } from "@/lib/domain";
import { roleHomePath } from "@/lib/navigation";
import { configured, supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!configured()) redirect("/");
  const db = await supabase();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/");
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("*").eq("id", user.id).single();
  if (profileError || !isRole(profile?.role)) redirect("/");
  if (profile.role !== "admin") redirect(roleHomePath(profile.role));
  const { data: schedule, error: scheduleError } = await db.from("site_schedule")
    .select("*").eq("id", 1).single();
  if (scheduleError || !schedule)
    throw new Error("ไม่สามารถโหลดช่วงเวลาให้บริการได้");
  return <Workspace
    profile={profile as Profile}
    records={[]}
    schedule={schedule as Schedule}
    initialView="import"
  />;
}
