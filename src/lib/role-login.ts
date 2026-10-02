import type { Role } from "./domain";
import { loginEmail, loginPassword } from "./identity";

const staffRoles = ["teacher", "academic", "admin"] as const;
export function staffLoginEmails(identifier: string, secret: string) {
  return staffRoles.map((role) => loginEmail(`${role}:${identifier}`, secret));
}

/** Only pass tokens returned directly by Supabase signInWithPassword, never client input. */
export function sessionIdFromAuthResponse(token: string, userId: string) {
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
  if (
    claims.sub !== userId ||
    typeof claims.session_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      claims.session_id,
    )
  )
    throw new Error("Invalid Auth session response");
  return claims.session_id as string;
}

export type RoleLoginStore = {
  resolveStaff(emails: string[], role: Role): Promise<string | null>;
  signIn(
    email: string,
    password: string,
  ): Promise<{ userId: string; accessToken: string } | null>;
  activate(sessionId: string, userId: string, role: Role): Promise<void>;
  signOut(): Promise<void>;
};

export async function signInForRole(
  input: { role: Role; identifier: string; password: string },
  store: RoleLoginStore,
  secret: string,
): Promise<{ error: string }> {
  let signedIn = false;
  try {
    const email = staffRoles.some((role) => role === input.role)
      ? await store.resolveStaff(
          staffLoginEmails(input.identifier, secret),
          input.role,
        )
      : loginEmail(`${input.role}:${input.identifier}`, secret);
    if (!email)
      return {
        error:
          "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง หรือบัญชีไม่มีสิทธิ์ในบทบาทที่เลือก",
      };
    const session = await store.signIn(
      email,
      loginPassword(input.role, input.password, secret),
    );
    if (!session)
      return {
        error:
          "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง หรือบัญชีไม่มีสิทธิ์ในบทบาทที่เลือก",
      };
    signedIn = true;
    await store.activate(
      sessionIdFromAuthResponse(session.accessToken, session.userId),
      session.userId,
      input.role,
    );
    return { error: "" };
  } catch {
    if (signedIn) {
      try {
        await store.signOut();
      } catch {
        /* An unbound session has no application role. */
      }
    }
    return {
      error:
        "ไม่สามารถเตรียมสิทธิ์เข้าสู่ระบบได้ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ",
    };
  }
}
