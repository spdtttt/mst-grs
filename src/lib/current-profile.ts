import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole, type Profile } from "./domain";

/** The displayed role and server guards use the same role as the database RLS. */
export async function currentProfile(
  db: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const [profile, role] = await Promise.all([
    db
      .from("profiles")
      .select("id,full_name,student_code,classroom,learning_subject_group")
      .eq("id", userId)
      .single(),
    db.rpc("my_role"),
  ]);
  if (profile.error || role.error || !profile.data || !isRole(role.data))
    return null;
  return { ...profile.data, role: role.data } as Profile;
}
