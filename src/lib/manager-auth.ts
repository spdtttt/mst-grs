import "server-only";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/domain";

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
  if (error || !profile || profile.role !== "manager") redirect("/dashboard");
  return profile as Profile;
}
