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
  role: z.enum(["student", "teacher", "academic", "manager"]),
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
      "Usage: npm run accounts -- path/to/accounts.csv [--apply]",
    );
  const apply = process.argv.includes("--apply");
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
          `Invalid account at row ${i + 2}: ${fields.includes("role") ? "role must be student, teacher, academic, or manager" : `check ${fields.join(", ")}`}`,
        );
      }
      const account = result.data;
      if (
        account.role === "student" &&
        (!/^\d{1,20}$/.test(account.identifier) ||
          !/^\d{13}$/.test(account.citizen_id))
      )
        throw new Error(`Invalid student identity at row ${i + 2}`);
      if (
        ["teacher", "academic"].includes(account.role) &&
        !/^\d{13}$/.test(account.identifier)
      )
        throw new Error(`Invalid citizen ID at row ${i + 2}`);
      if (
        account.role === "manager" &&
        (!/^[A-Za-z][A-Za-z0-9_.-]{2,39}$/.test(account.identifier) ||
          (account.password?.length ?? 0) < 6)
      )
        throw new Error(
          `Invalid manager username or password at row ${i + 2}: username must be 3-40 characters and password at least 6 characters`,
        );
      const key = account.role + ":" + account.identifier;
      if (seen.has(key)) throw new Error(`Duplicate account at row ${i + 2}`);
      seen.add(key);
      return account;
    });
  console.log(
    `Validated ${rows.length} accounts. Sensitive values will not be printed.`,
  );
  if (!apply) {
    console.log("Dry run only. Add --apply to create accounts.");
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
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = loginEmail(r.role + ":" + r.identifier, secret);
    const password =
      r.role === "manager"
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
