import "server-only";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/domain";
import { currentProfile } from "./current-profile";
import { roleHomePath } from "@/lib/navigation";

async function profileWithRoles(allowed: readonly Profile["role"][]): Promise<Profile> {
  if (!configured()) redirect("/");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/");
  const profile = await currentProfile(db, user.id);
  if (!profile) redirect("/");
  if (!allowed.includes(profile.role)) redirect(roleHomePath(profile.role));
  return profile as Profile;
}

export function managerProfile(): Promise<Profile> {
  return profileWithRoles(["manager"]);
}

/** Statistics and student lists are shared by managers and academic staff. */
export function managerStatsViewerProfile(): Promise<Profile> {
  return profileWithRoles(["manager", "academic"]);
}
