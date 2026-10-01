/** Run only on the trusted school operator's computer. No citizen IDs are stored in profiles. */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loginEmail, identityPassword } from "../src/lib/identity";
import { parseDelimited } from "../src/lib/import";
import { z } from "zod";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Deployment environment may provide values directly. */
}
const accountSchema = z.object({
  role: z.enum(["student", "teacher", "academic", "manager", "admin"]),
  identifier: z.string().trim().min(1),
  citizen_id: z.string().trim(),
  full_name: z.string().trim().min(1).max(150),
  classroom: z.string().trim(),
  password: z.string().optional(),
});
async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: npm run accounts -- path/to/accounts.csv [--apply] [--reset-admin-password | --verify-admin-login]",
    );
  const apply = process.argv.includes("--apply");
  const resetAdminPassword = process.argv.includes("--reset-admin-password");
  const verifyAdminLogin = process.argv.includes("--verify-admin-login");
  if (resetAdminPassword && verifyAdminLogin)
    throw new Error("Choose either password reset or login verification.");
  const table = parseDelimited(
    readFileSync(path, "utf8").replace(/^\uFEFF/, ""),
  );
  const headers = table.shift()!;
  const required = [
    "role",
    "identifier",
    "citizen_id",
    "full_name",
    "classroom",
  ];
  if (required.some((k) => !headers.includes(k)))
    throw new Error("Required columns: " + required.join(","));
  const seen = new Set<string>();
  const rows = table
    .filter((r) => r.some(Boolean))
    .map((r, i) => {
      const result = accountSchema.safeParse(
        Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ""])),
      );
      if (!result.success) {
        const fields = [
          ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
        ];
        throw new Error(
          `Invalid account at row ${i + 2}: ${fields.includes("role") ? "role must be student, teacher, academic, manager, or admin" : `check ${fields.join(", ")}`}`,
        );
      }
      const account = result.data;
      if ((account.role === "manager" || account.role === "admin") &&
        account.password !== account.password?.trim())
        throw new Error(`Password at row ${i + 2} has leading or trailing whitespace.`);
      if (
        account.role === "student" &&
        (!/^\d{5,10}$/.test(account.identifier) ||
          !/^\d{13}$/.test(account.citizen_id))
      )
        throw new Error(`Invalid student identity at row ${i + 2}`);
      if (
        ["teacher", "academic"].includes(account.role) &&
        !/^\d{13}$/.test(account.identifier)
      )
        throw new Error(`Invalid citizen ID at row ${i + 2}`);
      if (
        (account.role === "manager" || account.role === "admin") &&
        (!/^[A-Za-z][A-Za-z0-9_.-]{2,39}$/.test(account.identifier) ||
          (account.password?.length ?? 0) < 6 ||
          (account.password?.length ?? 0) > 128)
      )
        throw new Error(
          `Invalid ${account.role} username or password at row ${i + 2}: username must be 3-40 characters and password 6-128 characters`,
        );
      const key = account.role + ":" + account.identifier;
      if (seen.has(key)) throw new Error(`Duplicate account at row ${i + 2}`);
      seen.add(key);
      return account;
    });
  if ((resetAdminPassword || verifyAdminLogin) &&
    (rows.length !== 1 || rows[0].role !== "admin"))
    throw new Error("Admin password operations require a CSV containing exactly one admin account.");
  console.log(
    `Validated ${rows.length} accounts. Sensitive values will not be printed.`,
  );
  if (verifyAdminLogin) {
    if (apply) throw new Error("Login verification does not use --apply.");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.LOGIN_HMAC_SECRET;
    if (!url || !key || !secret || secret.length < 32)
      throw new Error("Missing Supabase URL, publishable key or LOGIN_HMAC_SECRET.");
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.auth.signInWithPassword({
      email: loginEmail(`admin:${rows[0].identifier}`, secret),
      password: rows[0].password!,
    });
    if (error) {
      console.error(`Admin Auth login failed (${error.code ?? "auth error"}, HTTP ${error.status}).`);
      process.exitCode = 1;
      return;
    }
    const profile = await db.from("profiles").select("role")
      .eq("id", data.user.id).single();
    await db.auth.signOut();
    if (profile.error || profile.data?.role !== "admin")
      throw new Error("Auth login succeeded, but the Admin profile did not match.");
    console.log("Admin Auth login and profile role verified.");
    return;
  }
  if (!apply) {
    console.log(resetAdminPassword
      ? "Dry run only. Add --apply to reset the Admin password."
      : "Dry run only. Add --apply to create accounts.");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret = process.env.LOGIN_HMAC_SECRET;
  if (!url || !key || !secret || secret.length < 32)
    throw new Error(
      "Missing Supabase URL, service role key or LOGIN_HMAC_SECRET. Set them locally; do not send them in chat.",
    );
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (resetAdminPassword) {
    const account = rows[0];
    const expectedEmail = loginEmail(`admin:${account.identifier}`, secret);
    const { data: profiles, error: profilesError } = await db.from("profiles")
      .select("id").eq("role", "admin");
    if (profilesError) throw new Error(`Cannot read Admin profiles (${profilesError.code}).`);
    const matches: string[] = [];
    for (const profile of profiles ?? []) {
      const { data, error } = await db.auth.admin.getUserById(profile.id);
      if (error) throw new Error(`Cannot verify Admin account (${error.code ?? "auth error"}).`);
      if (data.user?.email === expectedEmail) matches.push(profile.id);
    }
    if (matches.length !== 1)
      throw new Error("Expected exactly one matching Admin Auth account; no password was changed.");
    const { error } = await db.auth.admin.updateUserById(matches[0], {
      password: account.password!,
    });
    if (error) throw new Error(`Admin password reset failed (${error.code ?? "auth error"}).`);
    console.log("Admin password updated. Profile data was not changed.");
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = loginEmail(r.role + ":" + r.identifier, secret);
    const password =
      r.role === "manager" || r.role === "admin"
        ? r.password!
        : identityPassword(
            r.role,
            r.role === "student" ? r.citizen_id : r.identifier,
            secret,
          );
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.error(
        `Row ${i + 2}: account not created (${error.code ?? "auth error"}). Existing accounts are not overwritten.`,
      );
      process.exitCode = 1;
      continue;
    }
    const { error: pe } = await db.from("profiles").insert({
      id: data.user.id,
      role: r.role,
      full_name: r.full_name,
      student_code: r.role === "student" ? r.identifier : null,
      classroom: r.role === "student" ? r.classroom : null,
    });
    if (pe) {
      const rollback = await db.auth.admin.deleteUser(data.user.id);
      console.error(
        `Row ${i + 2}: profile creation failed (${pe.code}); auth rollback ${rollback.error ? "FAILED — inspect Supabase Auth" : "completed"}.`,
      );
      process.exitCode = 1;
      continue;
    }
    console.log(`Row ${i + 2}: created ${r.role} account.`);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Provisioning failed");
  process.exitCode = 1;
});
