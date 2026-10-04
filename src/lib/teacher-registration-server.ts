import "server-only";
import { teacherRegistrationSchema } from "./auth-input";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import {
  provisionRegisteredTeacher,
  RegistryRegistrationError,
  type RegistrationResponse,
} from "./registered-teacher";

export async function registerTeacherRequest(
  input: unknown,
  source: string,
): Promise<RegistrationResponse> {
  const parsed = teacherRegistrationSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 400,
      body: { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
    };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret = process.env.LOGIN_HMAC_SECRET;
  if (!url || !key || !secret || secret.length < 32)
    return {
      status: 503,
      body: { error: "ระบบสมัครสมาชิกยังไม่พร้อมให้บริการ" },
    };
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await service.rpc(name, args);
    if (result.error) {
      console.error("[teacher-registration]", {
        stage: name,
        code: result.error.code,
      });
      throw new RegistryRegistrationError(result.error.message);
    }
    return result.data;
  };
  return provisionRegisteredTeacher(
    parsed.data,
    {
      async consume(hash, sourceValue) {
        const bucket = (value: string) =>
          createHmac("sha256", secret).update(value).digest("hex");
        return (
          (await rpc("consume_teacher_registration", {
            p_identity_bucket: bucket(`register:identity:${hash}`),
            p_source_bucket: bucket(`register:source:${sourceValue}`),
          })) === true
        );
      },
      async claim(hash, first, last, token, emails) {
        return rpc("claim_teacher_registration", {
          p_hash: hash,
          p_first: first,
          p_last: last,
          p_token: token,
          p_emails: emails,
        });
      },
      async create(id, email, password, token) {
        const { data, error } = await service.auth.admin.createUser({
          id,
          email,
          password,
          email_confirm: true,
          app_metadata: { role: "teacher", teacher_registration_token: token },
        });
        if (error || data.user?.id !== id)
          throw new RegistryRegistrationError(error?.code ?? "unknown");
      },
      async authToken(id) {
        const { data, error } = await service.auth.admin.getUserById(id);
        if (error) {
          if (error.status === 404 || error.code === "user_not_found")
            return null;
          throw new Error("Auth state unknown");
        }
        if (!data.user) throw new Error("Auth state unknown");
        return typeof data.user.app_metadata.teacher_registration_token ===
          "string"
          ? data.user.app_metadata.teacher_registration_token
          : "unowned";
      },
      async finish(id, token, success) {
        await rpc("finish_teacher_registration", {
          p_id: id,
          p_token: token,
          p_success: success,
        });
      },
    },
    secret,
    source,
  );
}
