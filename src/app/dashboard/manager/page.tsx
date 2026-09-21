import ManagerWorkspace from "@/components/manager-workspace";
import { managerProfile } from "@/lib/manager-auth";
import type { ManagerStats } from "@/lib/manager-stats";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ManagerDashboard() {
  const profile = await managerProfile();
  const db = await supabase();
  const { data, error } = await db.rpc("manager_dashboard_stats");
  return (
    <ManagerWorkspace
      profile={profile}
      stats={error ? null : (data as ManagerStats | null)}
    />
  );
}
