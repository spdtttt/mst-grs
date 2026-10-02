import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { syntheticSchool, syntheticCounts } from "../src/lib/synthetic-school";
import { columns, parseRows } from "../src/lib/import";

const count = Number(process.argv[2] ?? 1200);
const output = resolve("data", `load-test-${count}`);
const liveState = resolve(output, "live-state.json");
if (existsSync(liveState) && Object.keys(JSON.parse(readFileSync(liveState, "utf8")).created ?? {}).length)
  throw new Error("Live accounts already exist; keep their saved test credentials instead of regenerating them");
const dataset = syntheticSchool(count);
mkdirSync(output, { recursive: true });
const csv = (rows: unknown[][]) => "\uFEFF" + rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
const accounts = dataset.accounts.map(a => [a.role, a.identifier, a.citizen_id, a.full_name, a.classroom ?? "", a.role !== "student" ? `Mock!${randomBytes(12).toString("hex")}` : ""]);
writeFileSync(resolve(output, "accounts.csv"), csv([["role", "identifier", "citizen_id", "full_name", "classroom", "password"], ...accounts]));
for (let offset = 0; offset < count; offset += 2000) {
  const rows = dataset.imports.slice(offset, offset + 2000).map(r => Object.values(columns).map(k => k === "teacher_name" ? r[k].join(", ") : r[k]));
  const validated = parseRows(Object.keys(columns), rows);
  if (validated.errors.length) throw new Error(validated.errors.join("\n"));
  writeFileSync(resolve(output, `grades-${1 + offset / 2000}.csv`), csv([Object.keys(columns), ...rows]));
}
writeFileSync(resolve(output, "fixtures.json"), JSON.stringify(dataset, null, 2));
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ synthetic: true, created_at: new Date().toISOString(), accounts: syntheticCounts, total_accounts: dataset.accounts.length, records: count, outstanding: dataset.records.filter(r => r.status !== "completed").length, completed: dataset.records.filter(r => r.status === "completed").length, note: "CSV import creates pending records. fixtures.json contains target workflow states for local tests. Supabase Auth accounts have not been created." }, null, 2));
console.log(JSON.stringify({ output, accounts: dataset.accounts.length, records: count }));
