// Read-only public checks. No credentials are guessed, no accounts are created,
// and no database mutation RPCs are called. Response bodies are not persisted.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const run = promisify(execFile);
const base = "https://mst-grs.vercel.app";
const checks = [];
const bodies = [];
async function request(url, { method = "GET", headers = {}, body } = {}) {
  const args = [
    "-sS",
    "--max-time",
    "20",
    "--max-filesize",
    "8000000",
    "-i",
    "-X",
    method,
    url,
  ];
  for (const [key, value] of Object.entries(headers))
    args.push("-H", `${key}: ${value}`);
  if (body) args.push("--data-binary", body);
  const { stdout } = await run("curl.exe", args, {
    maxBuffer: 9 * 1024 * 1024,
  });
  const boundary = stdout.indexOf("\r\n\r\n");
  const lines = stdout.slice(0, boundary).split("\r\n");
  const responseHeaders = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(0, i).toLowerCase() !== "set-cookie")
      responseHeaders[line.slice(0, i).toLowerCase()] = line
        .slice(i + 1)
        .trim();
  }
  return {
    status: Number(lines[0].split(" ")[1]),
    headers: responseHeaders,
    body: stdout.slice(boundary + 4),
  };
}
async function probe(path, options) {
  try {
    const r = await request(base + path, options);
    bodies.push(r.body);
    checks.push({
      path,
      method: options?.method ?? "GET",
      variant: options?.headers ? Object.keys(options.headers) : [],
      status: r.status,
      headers: r.headers,
      bytes: Buffer.byteLength(r.body),
      loginForm: r.body.includes('name="identifier"'),
      loginRedirect:
        r.headers.location === "/" ||
        r.headers.location?.startsWith("/?next=") ||
        r.body.includes("NEXT_REDIRECT;replace;/;") ||
        /http-equiv="refresh"[^>]*url=\//.test(r.body),
      serverError: r.body.includes("Application error:"),
    });
    return r;
  } catch (error) {
    checks.push({ path, error: error.code ?? "request failed" });
    return null;
  }
}
const home = await probe("/");
for (const path of [
  "/dashboard",
  "/dashboard/admin",
  "/dashboard/manager",
  "/dashboard/assignments/00000000-0000-4000-8000-000000000000",
  "/register",
  "/.env",
  "/.env.local",
  "/.git/config",
  "/package.json",
  "/api/admin/students/import-control",
])
  await probe(path);
for (const headers of [
  {
    "x-middleware-subrequest":
      "middleware:middleware:middleware:middleware:middleware",
  },
  { RSC: "1" },
  { cookie: "role=admin; isAdmin=true" },
])
  await probe("/dashboard/admin", { headers });
for (const origin of [base, "https://audit.invalid"])
  await probe("/api/admin/students/import-control", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "start" }),
  });
const chunks = [
  ...new Set(
    [
      ...(home?.body.matchAll(/(?:src|href)="([^" ]+\.js(?:\?[^" ]*)?)"/g) ??
        []),
    ].map((m) => m[1]),
  ),
]
  .filter((p) => p.startsWith("/_next/"))
  .slice(0, 30);
for (const chunk of chunks) await probe(chunk);
if (chunks[0]) await probe(chunks[0].split("?")[0] + ".map");
const secrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "LOGIN_HMAC_SECRET",
  "VAPID_PRIVATE_KEY",
].map((name) => ({
  name,
  configuredLocally: !!process.env[name],
  foundInPublicResponses:
    !!process.env[name] &&
    bodies.some((body) => body.includes(process.env[name])),
}));
const database = [];
const databaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (databaseOrigin && publicKey) {
  const headers = { apikey: publicKey };
  for (const table of [
    "profiles",
    "profile_roles",
    "login_role_sessions",
    "grade_records",
    "grade_record_history",
    "grade_reset_history",
    "grade_corrections",
    "audit_log",
    "login_attempts",
    "push_subscriptions",
    "assignment_files",
    "grade_assignments",
    "site_schedule",
    "student_import_runs",
  ]) {
    try {
      const r = await request(
        `${databaseOrigin}/rest/v1/${table}?select=*&limit=1`,
        { headers },
      );
      const data = JSON.parse(r.body);
      database.push({
        table,
        status: r.status,
        code: data.code,
        rowCount: Array.isArray(data) ? data.length : null,
      });
    } catch (error) {
      database.push({ table, error: error.code ?? "request failed" });
    }
  }
  for (const rpc of [
    "my_role",
    "manager_dashboard_stats",
    "admin_student_list",
    "admin_account_list",
  ]) {
    try {
      const r = await request(`${databaseOrigin}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(
          rpc === "admin_account_list" ? { p_role: "manager" } : {},
        ),
      });
      const data = JSON.parse(r.body);
      database.push({ rpc, status: r.status, code: data?.code });
    } catch (error) {
      database.push({ rpc, error: error.code ?? "request failed" });
    }
  }
}
const result = {
  date: new Date().toISOString(),
  base,
  scope:
    "Unauthenticated, bounded, non-mutating probes. No login attempts. Database uses only the public key from local configuration; deployed-project identity is not assumed.",
  databaseOrigin,
  databaseOriginSeenInPublicResponses:
    !!databaseOrigin && bodies.some((body) => body.includes(databaseOrigin)),
  checks,
  secrets,
  database,
};
mkdirSync("test-results/security", { recursive: true });
writeFileSync(
  "test-results/security/public-audit.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      checks: checks.map(({ path, status, loginRedirect, error }) => ({
        path,
        status,
        loginRedirect,
        error,
      })),
      secrets,
      database,
      databaseOriginSeenInPublicResponses:
        result.databaseOriginSeenInPublicResponses,
    },
    null,
    2,
  ),
);
