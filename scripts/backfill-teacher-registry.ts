import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  decryptStaffCitizenId,
  encryptStaffCitizenId,
  staffCitizenHash,
} from "../src/lib/staff-identity";
import {
  parseTeacherName,
  readTeacherWorkbook,
} from "../src/lib/teacher-registry";
import { staffLoginEmails } from "../src/lib/role-login";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* Environment may already be supplied. */
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret = process.env.LOGIN_HMAC_SECRET;
  if (!url || !key || !secret || secret.length < 32)
    throw new Error("Missing server configuration");
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const xlsxIndex = process.argv.indexOf("--xlsx");
  const byEmail = new Map<string, string>();
  if (xlsxIndex !== -1) {
    const path = process.argv[xlsxIndex + 1];
    if (!path || path.startsWith("--"))
      throw new Error(
        "Usage: npm run teachers:backfill -- [--xlsx teachers.xlsx] [--apply]",
      );
    const ExcelJS = (await import("exceljs")).default,
      book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(readFileSync(path)).buffer);
    const parsed = readTeacherWorkbook(book);
    if (parsed.errors.length)
      throw new Error(
        `Workbook contains ${parsed.errors.length} errors; correct it using the Admin preview first`,
      );
    for (const row of parsed.rows)
      for (const email of staffLoginEmails(row.citizen_id, secret))
        byEmail.set(email, row.citizen_id);
  }
  const authEmails = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error)
      throw new Error(`Auth lookup failed (${error.code ?? "unknown"})`);
    data.users.forEach((user) => {
      if (user.email) authEmails.set(user.id, user.email);
    });
    if (data.users.length < 1000) break;
  }
  const profiles: {
    id: string;
    full_name: string;
    name_prefix: string | null;
    first_name: string | null;
    last_name: string | null;
    citizen_id_encrypted: string | null;
    staff_citizen_hash: string | null;
  }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await service
      .from("profiles")
      .select(
        "id,full_name,name_prefix,first_name,last_name,citizen_id_encrypted,staff_citizen_hash",
      )
      .neq("role", "student")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`Profile lookup failed (${error.code})`);
    profiles.push(...data);
    if (data.length < 1000) break;
  }
  const seen = new Map<string, string>(),
    plan: { id: string; hash: string; identity: object }[] = [];
  let unresolved = 0;
  for (const profile of profiles) {
    if (profile.staff_citizen_hash) {
      const prior = seen.get(profile.staff_citizen_hash);
      if (prior && prior !== profile.id)
        throw new Error("Ambiguous existing identities; no changes applied");
      seen.set(profile.staff_citizen_hash, profile.id);
    }
    const citizenId = profile.citizen_id_encrypted
      ? decryptStaffCitizenId(profile.citizen_id_encrypted, profile.id, secret)
      : byEmail.get(authEmails.get(profile.id) ?? "");
    if (!citizenId) {
      unresolved++;
      continue;
    }
    const hash = staffCitizenHash(citizenId, secret),
      previous = seen.get(hash);
    if (
      (previous && previous !== profile.id) ||
      (profile.staff_citizen_hash && profile.staff_citizen_hash !== hash)
    )
      throw new Error("Ambiguous identity mapping; no changes applied");
    seen.set(hash, profile.id);
    const names =
      profile.name_prefix && profile.first_name && profile.last_name
        ? {
            name_prefix: profile.name_prefix,
            first_name: profile.first_name,
            last_name: profile.last_name,
          }
        : parseTeacherName(profile.full_name);
    if (
      !profile.staff_citizen_hash ||
      !profile.name_prefix ||
      !profile.first_name ||
      !profile.last_name
    )
      plan.push({
        id: profile.id,
        hash,
        identity: {
          ...names,
          citizen_id_encrypted:
            profile.citizen_id_encrypted ??
            encryptStaffCitizenId(citizenId, profile.id, secret),
        },
      });
  }
  console.log(
    `Validated ${plan.length} updates; ${unresolved} identities unresolved. No names or citizen IDs are printed.`,
  );
  if (!process.argv.includes("--apply")) {
    console.log("Dry run only. Add --apply to write validated mappings.");
    return;
  }
  for (const [index, item] of plan.entries()) {
    const { error } = await service.rpc("backfill_staff_identity", {
      p_id: item.id,
      p_hash: item.hash,
      p_identity: item.identity,
    });
    if (error)
      throw new Error(
        `Update ${index + 1} failed (${error.code}); ${index} previous updates completed. Re-run the dry run before retrying.`,
      );
  }
  console.log(
    `Applied ${plan.length} updates. Unresolved identities require an Excel import matched by existing Auth email; never match by name.`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Backfill failed");
  process.exitCode = 1;
});
