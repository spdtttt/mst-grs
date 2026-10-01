import "server-only";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/domain";
import { isRole } from "@/lib/domain";
import { roleHomePath } from "@/lib/navigation";

export async function managerProfile(): Promise<Profile> {
  if (!configured()) redirect("/");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/");
  const { data: profile, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error || !isRole(profile?.role)) redirect("/");
  if (profile.role !== "manager") redirect(roleHomePath(profile.role));
  return profile as Profile;
}
