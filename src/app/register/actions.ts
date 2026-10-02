"use server";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { configured } from "@/lib/supabase";
import { teacherRegistrationSchema } from "@/lib/auth-input";
import { encryptStaffCitizenId } from "@/lib/staff-identity";
import { staffLoginEmails } from "@/lib/role-login";
import {
  provisionTeacher,
  RegistrationError,
  type RegistrationState,
} from "@/lib/teacher-registration";

// Database error messages/details may contain submitted personal data.
// Record only the operation and error code on the server.
function logRegistrationError(stage: string, code?: string) {
  console.error("[teacher-registration]", {
    stage,
    code: code && /^[A-Za-z0-9_]{1,50}$/.test(code) ? code : "unknown",
  });
}

export async function registerTeacher(
  _previous: RegistrationState,
  form: FormData,
): Promise<RegistrationState> {
  const secret = process.env.LOGIN_HMAC_SECRET;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configured() || !key || !secret || secret.length < 32)
    return {
      error: "ระบบสมัครสมาชิกยังไม่พร้อมให้บริการ กรุณาติดต่อผู้ดูแลระบบ",
    };
  const parsed = teacherRegistrationSchema.safeParse(
    Object.fromEntries(
      ["citizen_id", "name_prefix", "first_name", "last_name", "password"].map(
        (field) => [field, form.get(field)],
      ),
    ),
  );
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message || "กรุณาตรวจสอบข้อมูลสมัครสมาชิก",
    };
  try {
    const requestHeaders = await headers();
    // Vercel overwrites this header. Other hosts share the server bucket unless
    // a trusted proxy integration is added; arbitrary forwarded headers are not trusted.
    const source = process.env.VERCEL
      ? requestHeaders.get("x-vercel-forwarded-for") || "unknown"
      : "local";
    const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bucket = (value: string) =>
      createHmac("sha256", secret).update(value).digest("hex");
    const limit = await service.rpc("consume_teacher_registration", {
      p_identity_bucket: bucket(`register:identity:${parsed.data.citizen_id}`),
      p_source_bucket: bucket(`register:source:${source}`),
    });
    if (limit.error) {
      logRegistrationError("rate_limit", limit.error.code);
      return {
        error: "ระบบสมัครสมาชิกยังไม่พร้อมให้บริการ กรุณาติดต่อผู้ดูแลระบบ",
      };
    }
    if (!limit.data)
      return { error: "สมัครสมาชิกบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
    return await provisionTeacher(
      parsed.data,
      {
        async createAuth(email, password) {
          const existing = await service.rpc("staff_identity_exists", {
            p_emails: staffLoginEmails(parsed.data.citizen_id, secret),
          });
          if (existing.error) {
            logRegistrationError("check_existing_staff", existing.error.code);
            throw new RegistrationError("ระบบสมัครสมาชิกยังไม่พร้อมให้บริการ กรุณาติดต่อผู้ดูแลระบบ");
          }
          if (existing.data)
            throw new RegistrationError("มีบัญชีบุคลากรนี้อยู่แล้ว กรุณาเข้าสู่ระบบหรือติดต่อผู้ดูแลระบบเพื่อเพิ่มสิทธิ์ครู");
          const { data, error } = await service.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: { role: "teacher" },
          });
          if (error || !data.user) {
            logRegistrationError("create_auth", error?.code);
            throw new RegistrationError(
              [
                "email_exists",
                "email_conflict",
                "user_already_exists",
              ].includes(error?.code ?? "")
                ? "มีบัญชีครูนี้อยู่แล้ว กรุณาเข้าสู่ระบบหรือติดต่อผู้ดูแลระบบ"
                : error?.code === "weak_password"
                  ? "รหัสผ่านไม่ผ่านข้อกำหนดของระบบ กรุณาเปลี่ยนรหัสผ่านแล้วลองใหม่"
                  : "สร้างบัญชีไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ",
            );
          }
          return data.user.id;
        },
        async saveProfile(profile, citizenId) {
          const { error } = await service.rpc("register_teacher_profile", {
            p_id: profile.id,
            p_profile: {
              name_prefix: profile.name_prefix,
              first_name: profile.first_name,
              last_name: profile.last_name,
              citizen_id_encrypted: encryptStaffCitizenId(
                citizenId,
                profile.id,
                secret,
              ),
            },
          });
          if (error) {
            logRegistrationError("save_profile", error.code);
            if (["42703", "PGRST202", "PGRST204"].includes(error.code))
              throw new RegistrationError(
                "ระบบสมัครสมาชิกยังไม่พร้อมให้บริการ กรุณาติดต่อผู้ดูแลระบบ",
              );
            throw new Error("Profile save failed");
          }
        },
        async findProfile(id) {
          const { data, error } = await service
            .from("profiles")
            .select("role")
            .eq("id", id)
            .maybeSingle();
          if (error) {
            logRegistrationError("verify_profile", error.code);
            throw new Error("Profile verification failed");
          }
          return data;
        },
        async deleteAuth(id) {
          const { error } = await service.auth.admin.deleteUser(id);
          if (error) {
            logRegistrationError("rollback_auth", error.code);
            throw new Error("Auth rollback failed");
          }
        },
      },
      secret,
    );
  } catch {
    logRegistrationError("registration_request");
    return {
      error: "ไม่สามารถยืนยันผลการสมัครได้ กรุณาติดต่อผู้ดูแลระบบก่อนลองใหม่",
    };
  }
}
