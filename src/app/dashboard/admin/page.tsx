import { redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { type Profile, type Schedule } from "@/lib/domain";
import { currentProfile } from "@/lib/current-profile";
import { roleHomePath } from "@/lib/navigation";
import { configured, supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const requestedView = (await searchParams).view;
  const initialView = requestedView === "import" || requestedView === "teachers" || requestedView === "academics" || requestedView === "managers" ? requestedView : "students";
  if (!configured()) redirect("/");
  const db = await supabase();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/");
  const profile = await currentProfile(db, user.id);
  if (!profile) redirect("/");
  if (profile.role !== "admin") redirect(roleHomePath(profile.role));
  const { data: schedule, error: scheduleError } = await db.from("site_schedule")
    .select("*").eq("id", 1).single();
  if (scheduleError || !schedule)
    throw new Error("ไม่สามารถโหลดช่วงเวลาให้บริการได้");
  return <Workspace
    profile={profile as Profile}
    records={[]}
    schedule={schedule as Schedule}
    initialView={initialView}
  />;
}
