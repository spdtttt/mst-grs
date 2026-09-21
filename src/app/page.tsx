import Login from "@/components/login";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import { safeReturnPath } from "@/lib/navigation";
import { isRole } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );
  if (configured()) {
    const db = await supabase();
    const {
      data: { user },
    } = await db.auth.getUser();

    if (user) {
      const { data: profile } = await db
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (isRole(profile?.role)) redirect(next);
    }
  }

  return <Login next={next} />;
}
