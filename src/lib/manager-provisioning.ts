import { accountFullName, managerInputSchema, type ManagerInput } from "./admin-accounts";
import { loginEmail } from "./identity";

export type ManagerProfileInput = Omit<ManagerInput, "password"> & { id: string; full_name: string; role: "manager" };
export type ManagerStore = {
  createAuth(email: string, password: string): Promise<string>;
  saveProfile(profile: ManagerProfileInput): Promise<void>;
  findProfile(id: string): Promise<{ role: string } | null>;
  deleteAuth(id: string): Promise<void>;
};
export class ManagerAccountError extends Error {}

export async function provisionManager(input: unknown, store: ManagerStore, secret: string) {
  const parsed = managerInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  let id: string | undefined;
  try {
    const { password, ...profile } = parsed.data;
    id = await store.createAuth(loginEmail(`manager:${profile.username}`, secret), password);
    await store.saveProfile({ ...profile, id, full_name: accountFullName(profile), role: "manager" });
    return { success: true as const };
  } catch (error) {
    if (id) {
      try {
        const saved = await store.findProfile(id);
        if (saved?.role === "manager") return { success: true as const };
        if (saved) throw new Error("Unexpected profile role");
        await store.deleteAuth(id);
      } catch {
        return { error: "ไม่สามารถยืนยันสถานะบัญชีได้ กรุณาโหลดรายชื่อใหม่ก่อนสร้างบัญชีซ้ำ" };
      }
    }
    return { error: error instanceof ManagerAccountError ? error.message : "สร้างบัญชีผู้บริหารไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
}
