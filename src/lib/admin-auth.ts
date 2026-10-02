import "server-only";
import { configured, supabase } from "./supabase";

export async function adminContext() {
  if (!configured())
    return { error: "ยังไม่ได้เชื่อมต่อฐานข้อมูล", status: 503 } as const;
  const db = await supabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    return { error: "กรุณาเข้าสู่ระบบใหม่", status: 401 } as const;
  const { data: role, error: roleError } = await db.rpc("my_role");
  if (roleError || role !== "admin")
    return {
      error: "เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการได้",
      status: 403,
    } as const;
  return { db, user };
}
