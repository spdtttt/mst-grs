import "server-only";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/domain";
import { currentProfile } from "./current-profile";
import { roleHomePath } from "@/lib/navigation";

export async function managerProfile(): Promise<Profile> {
  if (!configured()) redirect("/");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/");
  const profile = await currentProfile(db, user.id);
  if (!profile) redirect("/");
  if (profile.role !== "manager") redirect(roleHomePath(profile.role));
  return profile as Profile;
}
