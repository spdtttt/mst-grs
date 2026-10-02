import "server-only";
import { configured, supabase } from "./supabase";

export async function studentAdminContext() {
  if (!configured())
    return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล", status: 503 } as const;
  const db = await supabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    return { error: "กรุณาเข้าสู่ระบบใหม่", status: 401 } as const;
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin")
    return {
      error: "เฉพาะผู้ดูแลระบบเท่านั้นที่จัดการรายชื่อนักเรียนได้",
      status: 403,
    } as const;
  return { db };
}
