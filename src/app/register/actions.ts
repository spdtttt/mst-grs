"use server";
import { headers } from "next/headers";
import type { RegistrationState } from "@/lib/teacher-registration";
import { registerTeacherRequest } from "@/lib/teacher-registration-server";

// Legacy callers share the registry gate; the UI uses the HTTP endpoint.
export async function registerTeacher(
  _previous: RegistrationState,
  form: FormData,
): Promise<RegistrationState> {
  const requestHeaders = await headers();
  const source = process.env.VERCEL
    ? requestHeaders.get("x-vercel-forwarded-for") || "unknown"
    : "local";
  const result = await registerTeacherRequest(
    Object.fromEntries(
      ["citizen_id", "name_prefix", "first_name", "last_name", "password"].map(
        (field) => [field, form.get(field)],
      ),
    ),
    source,
  );
  return {
    error: result.body.error ?? "",
    ...(result.body.success ? { success: true } : {}),
  };
}
