import { randomUUID } from "node:crypto";
import { teacherRegistrationSchema } from "./auth-input";
import { loginEmail } from "./identity";
import { staffCitizenHash } from "./staff-identity";
import { staffLoginEmails } from "./role-login";

export type RegistrationResponse = {
  status: number;
  body: { success?: true; error?: string };
};
export class RegistryRegistrationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export type RegisteredTeacherStore = {
  consume(hash: string, source: string): Promise<boolean>;
  claim(
    hash: string,
    first: string,
    last: string,
    token: string,
    emails: string[],
  ): Promise<{ id: string; token: string; pending: boolean }>;
  create(
    id: string,
    email: string,
    password: string,
    token: string,
  ): Promise<void>;
  // null only for a confirmed Auth 404; transport errors must throw.
  authToken(id: string): Promise<string | null>;
  finish(id: string, token: string, success: boolean): Promise<void>;
};
const unavailable = (): RegistrationResponse => ({
  status: 503,
  body: {
    error: "ไม่สามารถยืนยันสถานะบัญชีได้ กรุณาติดต่อผู้ดูแลระบบก่อนลองใหม่",
  },
});
function registrationError(error: unknown): RegistrationResponse {
  const code =
    error instanceof RegistryRegistrationError ? error.code : "unknown";
  if (code === "REGISTRATION_DENIED")
    return {
      status: 403,
      body: {
        error:
          "ไม่พบทะเบียนคุณครูที่ตรงกับเลขบัตรประชาชนและชื่อ–นามสกุล กรุณาติดต่อผู้ดูแลระบบ",
      },
    };
  if (
    [
      "REGISTRATION_EXISTS",
      "email_exists",
      "email_conflict",
      "user_already_exists",
    ].includes(code)
  )
    return {
      status: 409,
      body: {
        error:
          "มีบัญชีนี้อยู่แล้ว กรุณาเข้าสู่ระบบหรือติดต่อผู้ดูแลระบบเพื่อรีเซ็ทรหัสผ่าน",
      },
    };
  if (code === "weak_password")
    return {
      status: 400,
      body: { error: "รหัสผ่านไม่ผ่านข้อกำหนดของระบบ กรุณาเปลี่ยนรหัสผ่าน" },
    };
  return unavailable();
}

/** Reserve before touching Auth. A pre-existing profile is never proof of
 * creation. Unknown responses keep their reservation, never delete Auth. */
export async function provisionRegisteredTeacher(
  input: unknown,
  store: RegisteredTeacherStore,
  secret: string,
  source: string,
  role: "teacher" | "academic" = "teacher",
): Promise<RegistrationResponse> {
  const parsed = teacherRegistrationSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 400,
      body: { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
    };
  const value = parsed.data;
  try {
    const hash = staffCitizenHash(value.citizen_id, secret);
    if (!(await store.consume(hash, source)))
      return {
        status: 429,
        body: { error: "สมัครบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
      };
    const claim = await store.claim(
      hash,
      value.first_name,
      value.last_name,
      randomUUID(),
      staffLoginEmails(value.citizen_id, secret),
    );
    if (claim.pending) {
      const token = await store.authToken(claim.id);
      if (token === claim.token)
        await store.finish(claim.id, claim.token, true);
      return {
        status: 409,
        body: {
          error:
            "บัญชีนี้กำลังดำเนินการหรือสมัครแล้ว กรุณาเข้าสู่ระบบหรือติดต่อผู้ดูแลระบบ",
        },
      };
    }
    try {
      await store.create(
        claim.id,
        loginEmail(`${role}:${value.citizen_id}`, secret),
        value.password,
        claim.token,
      );
    } catch (error) {
      const token = await store.authToken(claim.id);
      if (token === claim.token) {
        await store.finish(claim.id, claim.token, true);
        return { status: 200, body: { success: true } };
      }
      if (
        token === null &&
        error instanceof RegistryRegistrationError &&
        [
          "weak_password",
          "email_exists",
          "email_conflict",
          "user_already_exists",
          "validation_failed",
        ].includes(error.code)
      ) {
        await store.finish(claim.id, claim.token, false);
        return registrationError(error);
      }
      // A timed-out POST could still commit later: keep the reservation.
      return unavailable();
    }
    if ((await store.authToken(claim.id)) !== claim.token) return unavailable();
    await store.finish(claim.id, claim.token, true);
    return { status: 200, body: { success: true } };
  } catch (error) {
    return registrationError(error);
  }
}
