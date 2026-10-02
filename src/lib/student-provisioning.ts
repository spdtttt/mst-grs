import { loginEmail, identityPassword } from "./identity";
import type { StudentInput, StudentSaveResult } from "./students";

export type StudentAccountStore = {
  findProfile(
    code: string,
    options?: { fresh: boolean },
  ): Promise<{ id: string; role: string } | null>;
  verifyAuth(id: string, email: string): Promise<boolean>;
  createAuth(email: string, password: string): Promise<string>;
  saveProfile(id: string, student: StudentInput): Promise<void>;
  deleteAuth(id: string): Promise<void>;
};
export class StudentProvisionError extends Error {}

export async function prefetchStudentStore(
  codes: string[],
  store: StudentAccountStore,
  load: (
    codes: string[],
  ) => Promise<{ id: string; role: string; student_code: string }[]>,
): Promise<StudentAccountStore> {
  const profiles = await load(codes);
  const cache = new Map(
    profiles.map((profile) => [
      profile.student_code,
      { id: profile.id, role: profile.role },
    ]),
  );
  return {
    ...store,
    async findProfile(code, options) {
      return options?.fresh
        ? store.findProfile(code, options)
        : (cache.get(code) ?? null);
    },
  };
}

/** Never replace an existing password, or insert a profile before Auth exists. */
export async function provisionStudent(
  student: StudentInput,
  store: StudentAccountStore,
  secret: string,
): Promise<StudentSaveResult> {
  const email = loginEmail(`student:${student.student_code}`, secret);
  let newId: string | undefined;
  try {
    const existing = await store.findProfile(student.student_code);
    if (existing) {
      if (
        existing.role !== "student" ||
        !(await store.verifyAuth(existing.id, email))
      )
        return {
          student_code: student.student_code,
          status: "failed",
          message:
            "บัญชีเดิมกับ Auth ไม่ตรงกัน กรุณาตรวจสอบบัญชีก่อนนำเข้าอีกครั้ง",
        };
      await store.saveProfile(existing.id, student);
      return { student_code: student.student_code, status: "updated" };
    }
    newId = await store.createAuth(
      email,
      identityPassword("student", student.citizen_id, secret),
    );
    await store.saveProfile(newId, student);
    return { student_code: student.student_code, status: "created" };
  } catch (error) {
    if (newId) {
      // A lost RPC response can happen after commit. Confirm the profile before
      // deleting Auth, so a successful save never loses its login account.
      try {
        const saved = await store.findProfile(student.student_code, {
          fresh: true,
        });
        if (saved?.id === newId && saved.role === "student")
          return { student_code: student.student_code, status: "created" };
        await store.deleteAuth(newId);
      } catch {
        return {
          student_code: student.student_code,
          status: "failed",
          message:
            "ไม่สามารถยืนยันสถานะบัญชีได้ กรุณาตรวจสอบ Supabase Auth และ profiles ก่อนลองใหม่",
        };
      }
    }
    return {
      student_code: student.student_code,
      status: "failed",
      message:
        error instanceof StudentProvisionError
          ? error.message
          : "บันทึกบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง",
    };
  }
}
