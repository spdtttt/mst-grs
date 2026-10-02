import { loginEmail } from "./identity";
import { teacherRegistrationSchema } from "./auth-input";

export type TeacherProfile = {
  id: string;
  role: "teacher";
  full_name: string;
  name_prefix: string;
  first_name: string;
  last_name: string;
};
export type TeacherRegistrationStore = {
  createAuth(email: string, password: string): Promise<string>;
  saveProfile(profile: TeacherProfile, citizenId: string): Promise<void>;
  findProfile(id: string): Promise<{ role: string } | null>;
  deleteAuth(id: string): Promise<void>;
};
export type RegistrationState = { error: string; success?: boolean };
export class RegistrationError extends Error {}

export async function provisionTeacher(
  input: unknown,
  store: TeacherRegistrationStore,
  secret: string,
): Promise<RegistrationState> {
  const parsed = teacherRegistrationSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message || "กรุณาตรวจสอบข้อมูลสมัครสมาชิก",
    };
  const teacher = parsed.data;
  let newId: string | undefined;
  try {
    newId = await store.createAuth(
      loginEmail(`teacher:${teacher.citizen_id}`, secret),
      teacher.password,
    );
    await store.saveProfile(
      {
        id: newId,
        role: "teacher",
        full_name: `${teacher.name_prefix}${teacher.first_name} ${teacher.last_name}`,
        name_prefix: teacher.name_prefix,
        first_name: teacher.first_name,
        last_name: teacher.last_name,
      },
      teacher.citizen_id,
    );
    return { error: "", success: true };
  } catch (error) {
    if (newId) {
      try {
        // A request can fail after commit. Never remove an account with a saved profile.
        const saved = await store.findProfile(newId);
        if (saved?.role === "teacher") return { error: "", success: true };
        if (saved) throw new Error("Unexpected profile role");
        await store.deleteAuth(newId);
      } catch {
        return {
          error:
            "ไม่สามารถยืนยันสถานะบัญชีได้ กรุณาติดต่อผู้ดูแลระบบก่อนสมัครอีกครั้ง",
        };
      }
    }
    return {
      error:
        error instanceof RegistrationError
          ? error.message
          : "สมัครสมาชิกไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ",
    };
  }
}
