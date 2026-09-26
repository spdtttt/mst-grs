import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loginEmail, identityPassword } from "../src/lib/identity";
import { parseDelimited } from "../src/lib/import";
import { syntheticSchool } from "../src/lib/synthetic-school";
import { siteUrl } from "../src/lib/site";
import assert from "node:assert/strict";

for (const file of [".env.local", ".env"]) { try { process.loadEnvFile(file); } catch {} }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.LOGIN_HMAC_SECRET!;
if (!url || !key || !anon || !secret) throw new Error("Missing local credentials");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const dir = resolve("data/load-test-1200");
const dataset = syntheticSchool();
type State = { created: Record<string, string>; baseline?: unknown; stages: unknown[]; originalRecords?: unknown[]; originalHistory?: unknown[] };
const statePath = resolve(dir, "live-state.json");
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { created: {}, stages: [] };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const accountKey = (a: { role: string; identifier: string }) => `${a.role}:${a.identifier}`;
function check(error: { message: string } | null) { if (error) throw new Error(error.message); }
const accountsCsv = () => {
  const rows = parseDelimited(readFileSync(resolve(dir, "accounts.csv"), "utf8").replace(/^\uFEFF/, ""));
  const headers = rows.shift()!;
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
};
async function pool<T>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<void>) {
  let cursor = 0, failed: unknown;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length && !failed) {
      const index = cursor++;
      try { await work(items[index], index); } catch (e) { failed = e; }
    }
  }));
  if (failed) throw failed;
}
async function inspect() {
  const counts: Record<string, number | null> = {};
  for (const table of ["profiles", "grade_records", "grade_record_history"]) {
    const r = await admin.from(table).select("id", { count: "exact", head: true }); check(r.error); counts[table] = r.count;
  }
  const schedule = await admin.from("site_schedule").select("*").eq("id", 1).single(); check(schedule.error);
  const homepage = await fetch(siteUrl, { signal: AbortSignal.timeout(20000) });
  const result = { at: new Date().toISOString(), site: siteUrl, status: homepage.status, counts, schedule: schedule.data };
  if (!state.baseline) { state.baseline = result; save(); }
  if (!state.originalRecords) {
    const records = await admin.from("grade_records").select("*").not("student_code", "like", "9900%").order("id"); check(records.error);
    const history = await admin.from("grade_record_history").select("*").order("id"); check(history.error);
    state.originalRecords = records.data ?? []; state.originalHistory = history.data ?? []; save();
  }
  console.log(JSON.stringify(result));
}
async function seed() {
  const accounts = accountsCsv();
  if (accounts.length !== 2520) throw new Error("Expected 2520 generated accounts");
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 }); check(r.error);
    for (const user of r.data.users) if (user.email) existing.set(user.email, user.id);
    if (r.data.users.length < 1000) break;
  }
  let done = 0;
  await pool(accounts, 6, async (a) => {
    const email = loginEmail(accountKey(a as { role: string; identifier: string }), secret);
    let id = existing.get(email);
    if (!id) {
      const r = await admin.auth.admin.createUser({ email, password: a.role === "manager" ? a.password : identityPassword(a.role, a.role === "student" ? a.citizen_id : a.identifier, secret), email_confirm: true, app_metadata: { synthetic_load_test: "mst-grs-1200" } });
      check(r.error); id = r.data.user!.id;
    }
    const old = await admin.from("profiles").select("id,role,full_name").eq("id", id).maybeSingle(); check(old.error);
    if (old.data && (old.data.role !== a.role || old.data.full_name !== a.full_name)) throw new Error("Existing account differs; refusing overwrite");
    if (!old.data) {
      const r = await admin.from("profiles").insert({ id, role: a.role, full_name: a.full_name, student_code: a.role === "student" ? a.identifier : null, classroom: a.role === "student" ? a.classroom : null }); check(r.error);
    }
    state.created[accountKey(a as { role: string; identifier: string })] = id;
    save(); done++;
    if (done % 100 === 0 || done === accounts.length) console.log(JSON.stringify({ accounts_ready: done, total: accounts.length }));
  });
}
async function login(a: Record<string, string>) {
  const cookies: { name: string; value: string }[] = [];
  const db = createServerClient(url, anon, { cookies: { getAll: () => cookies, setAll: values => { for (const value of values) { const i = cookies.findIndex(c => c.name === value.name); if (i >= 0) cookies[i] = value; else cookies.push(value); } } }, auth: { autoRefreshToken: false } });
  const t = performance.now();
  const r = await db.auth.signInWithPassword({ email: loginEmail(accountKey(a as { role: string; identifier: string }), secret), password: a.role === "manager" ? a.password : identityPassword(a.role, a.role === "student" ? a.citizen_id : a.identifier, secret) }); check(r.error);
  return { db, cookies, role: a.role, name: a.full_name, userId: r.data.user!.id, loginMs: performance.now() - t };
}
async function grades() {
  if (Object.keys(state.created).length !== 2520) throw new Error("Finish seeding accounts first");
  const session = await login(accountsCsv().find(a => a.role === "academic")!);
  const schedule = await admin.from("site_schedule").select("*").eq("id", 1).single(); check(schedule.error);
  if (!(Date.now() >= Date.parse(schedule.data.opens_at) && Date.now() < Date.parse(schedule.data.closes_at))) throw new Error("Schedule is closed. Need an authorized test window before importing.");
  const t = performance.now();
  const imported = await session.db.rpc("import_grades", { p_rows: dataset.imports }); check(imported.error);
  state.stages.push({ operation: "import_1200", ms: performance.now() - t, result: imported.data }); save();
  console.log(JSON.stringify(state.stages.at(-1)));
  const fakeById = new Map(dataset.accounts.map(a => [a.id, a]));
  // Avoid thousands of Auth logins just to prepare fixtures: seed requested
  // states as fixture setup, then validate real approval RPCs in the probe mode.
  let prepared = 0;
  await pool(dataset.records, 4, async record => {
    const student = fakeById.get(record.student_id)!;
    const teacherIds = record.teacher_id.map(id => state.created[accountKey(fakeById.get(id)!)]);
    const { id: fakeId, ...values } = record;
    const r = await admin.from("grade_records").update({ ...values, student_id: state.created[accountKey(student)], teacher_id: teacherIds }).eq("student_code", record.student_code).eq("course_code", record.course_code).eq("academic_year", record.academic_year).eq("semester", record.semester).select("id").single(); check(r.error);
    if (record.assignment && record.due_at) {
      const task = await admin.from("grade_assignments").upsert({ record_id: r.data!.id, round_number: 1, assignment: record.assignment, due_at: record.due_at, assigned_at: record.assigned_at, received_at: record.submitted_at }, { onConflict: "record_id,round_number" }); check(task.error);
    }
    prepared++;
    if (prepared % 200 === 0) console.log(JSON.stringify({ grades_prepared: prepared }));
  });
  state.stages.push({ operation: "fixture_states_prepared", count: prepared, method: "service-role fixture setup; not measured workflow transitions" }); save();
  await session.db.auth.signOut();
}
function summary(values: number[]) {
  const sorted = [...values].sort((a,b) => a-b);
  return { samples: values.length, p50_ms: Math.round(sorted[Math.floor(sorted.length * .5)]), p95_ms: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]), max_ms: Math.round(sorted.at(-1) ?? 0) };
}
async function load() {
  const accounts = accountsCsv();
  const chosen = [...accounts.filter(a => a.role === "student").slice(0, 40), ...accounts.filter(a => a.role === "teacher").slice(0, 6), ...accounts.filter(a => a.role === "academic").slice(0, 3), accounts.find(a => a.role === "manager")!];
  const sessions: Awaited<ReturnType<typeof login>>[] = [];
  for (const a of chosen) {
    sessions.push(await login(a));
    if (sessions.length % 10 === 0) console.log(JSON.stringify({ sessions_ready: sessions.length }));
    await new Promise(r => setTimeout(r, 2200));
  }
  const priority: Record<string, number> = { manager: 0, academic: 1, teacher: 2, student: 3 };
  sessions.sort((a, b) => priority[a.role] - priority[b.role]);
  const results: unknown[] = [];
  for (const concurrency of [1, 5, 10, 25, 50]) {
    const count = concurrency === 1 ? 20 : concurrency * 4;
    const times: number[] = [], failures: { status: number; role: string; reason: string }[] = [];
    const started = performance.now();
    await pool(Array.from({ length: count }, (_, i) => i), concurrency, async i => {
      const session = sessions[i % sessions.length];
      const path = session.role === "manager" ? "/dashboard/manager" : "/dashboard";
      const t = performance.now();
      try {
        const r = await fetch(`${siteUrl}${path}`, { headers: { cookie: session.cookies.map(c => `${c.name}=${c.value}`).join("; ") }, redirect: "manual", signal: AbortSignal.timeout(30000) });
        const body = await r.text();
        if (r.status !== 200 || !body.includes(session.name)) failures.push({ status: r.status, role: session.role, reason: r.status === 200 ? "missing authenticated user's name" : "unexpected HTTP status" });
      } catch { failures.push({ status: 0, role: session.role, reason: "network error or 30s timeout" }); }
      times.push(performance.now() - t);
    });
    const result = { concurrency, ...summary(times), duration_ms: Math.round(performance.now() - started), failures: failures.length, failure_examples: failures.slice(0, 3) };
    results.push(result); console.log(JSON.stringify(result));
    writeFileSync(resolve(dir, "live-load-results.json"), JSON.stringify({ at: new Date().toISOString(), site: siteUrl, authenticated_sessions: sessions.length, login: summary(sessions.map(s => s.loginMs)), stages: results, limitations: ["HTTP SSR requests with real session cookies, not full browser user journeys", "Single load-generator machine; not 2520 simultaneous users", "No archive or schedule mutation performed by load test"] }, null, 2));
    if (failures.length || result.p95_ms > 10000) { console.log("Stopped escalation: failure or p95 > 10 seconds"); break; }
    await new Promise(r => setTimeout(r, 1500));
  }
  await pool(sessions, 3, async s => { await s.db.auth.signOut({ scope: "local" }); });
}
async function probe() {
  const probeCourse = process.argv[3] ?? "MOCK-E2E";
  if (!/^MOCK-E2E(?:-[0-9]+)?$/.test(probeCourse)) throw new Error("Use a MOCK-E2E test course code");
  const accounts = accountsCsv();
  const sessions = await Promise.all(["student", "teacher", "academic", "manager"].map(role => login(accounts.find(a => a.role === role)!)));
  const [student, teacher, academic, manager] = sessions;
  try {
    const own = await student.db.from("grade_records").select("id,student_id"); check(own.error);
    assert.ok(own.data!.length > 0 && own.data!.every(r => r.student_id === student.userId));
    const teaching = await teacher.db.from("grade_records").select("id,teacher_id"); check(teaching.error);
    assert.ok(teaching.data!.length > 0 && teaching.data!.every(r => r.teacher_id.includes(teacher.userId)));
    const denied = await student.db.rpc("manager_dashboard_stats"); assert.ok(denied.error);
    const stats = await manager.db.rpc("manager_dashboard_stats"); check(stats.error);
    const row = { ...dataset.imports[0], course_code: probeCourse, course_name: "วิชาจำลองทดสอบครบวงจร" };
    const imported = await academic.db.rpc("import_grades", { p_rows: [row] }); check(imported.error);
    const selected = await academic.db.from("grade_records").select("id,status").eq("course_code", probeCourse).eq("student_code", row.student_code).single(); check(selected.error);
    const steps = ["pending", "requested", "assigned", "submitted", "teacher_approved"];
    let index = steps.indexOf(selected.data!.status);
    const timings: { from: string; ms: number }[] = [];
    while (index >= 0 && index < steps.length) {
      const actor = index === 0 ? student : index === 4 ? academic : teacher;
      const started = performance.now();
      const r = await actor.db.rpc("advance_grade", { p_id: selected.data!.id, p_expected: steps[index], p_assignment: "ภาระงานจำลองสำหรับทดสอบระบบจริงครบวงจร", p_due_at: new Date(Date.now() + 86400000).toISOString(), p_final_grade: "1" }); check(r.error);
      timings.push({ from: steps[index], ms: Math.round(performance.now() - started) }); index++;
    }
    const final = await student.db.from("grade_records").select("status,final_grade").eq("id", selected.data!.id).single(); check(final.error);
    assert.deepEqual(final.data, { status: "completed", final_grade: "1" });
    const history = await student.db.from("grade_record_history").select("id").eq("id", selected.data!.id); check(history.error); assert.equal(history.data!.length, 0);
    const duplicate = await academic.db.rpc("import_grades", { p_rows: [row] }); check(duplicate.error); assert.deepEqual(duplicate.data, { inserted: 0, skipped: 1 });
    const result = { at: new Date().toISOString(), passed: true, course: probeCourse, own_student_records: own.data!.length, teacher_records: teaching.data!.length, workflow: timings, final: final.data, duplicate_import: duplicate.data, note: "Test course completed; live schedule and original data unchanged" };
    writeFileSync(resolve(dir, "live-probe.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (e) {
    writeFileSync(resolve(dir, "live-probe.json"), JSON.stringify({ at: new Date().toISOString(), passed: false, error: e instanceof Error ? e.message : "Unknown failure" }, null, 2));
    throw e;
  } finally { for (const session of sessions) await session.db.auth.signOut({ scope: "local" }); }
}
async function verify() {
  const counts: Record<string, number | null> = {};
  for (const role of ["student", "teacher", "academic", "manager"]) {
    const names: Record<string, string> = { student: "นักเรียนจำลอง", teacher: "ครูจำลอง", academic: "วิชาการจำลอง", manager: "ผู้บริหารจำลอง" };
    const r = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", role).like("full_name", `${names[role]} %`); check(r.error); counts[role] = r.count;
  }
  assert.deepEqual(counts, { student: 2300, teacher: 200, academic: 15, manager: 5 });
  const records = await admin.from("grade_records").select("id", { count: "exact", head: true }).like("student_code", "9900%"); check(records.error);
  const outstanding = await admin.from("grade_records").select("id", { count: "exact", head: true }).like("student_code", "9900%").neq("status", "completed"); check(outstanding.error);
  assert.ok((records.count ?? 0) >= 1200); assert.ok((outstanding.count ?? 0) > 500);
  if (state.stages.some(s => (s as { operation?: string }).operation === "fixture_states_prepared")) {
    assert.equal(outstanding.count, 1000);
  }
  if (state.originalRecords) {
    const original = await admin.from("grade_records").select("*").not("student_code", "like", "9900%").order("id"); check(original.error); assert.deepEqual(original.data, state.originalRecords);
  }
  if (state.originalHistory) {
    const original = await admin.from("grade_record_history").select("*").order("id"); check(original.error); assert.deepEqual(original.data, state.originalHistory);
  }
  const result = { at: new Date().toISOString(), accounts: counts, simulated_records: records.count, simulated_outstanding: outstanding.count, simulated_completed: records.count! - outstanding.count!, original_data_unchanged: !!state.originalRecords && !!state.originalHistory };
  writeFileSync(resolve(dir, "live-verification.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}
async function browserCheck() {
  const { chromium, expect } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: "msedge" });
  const results: unknown[] = [];
  try {
    for (const role of ["student", "teacher", "academic", "manager"]) {
      const a = accountsCsv().find(a => a.role === role)!;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(siteUrl);
      await page.locator(`input[name=role][value=${role}]`).check();
      await page.locator("#identifier").fill(a.identifier);
      if (role === "student" || role === "manager") await page.locator("#password").fill(role === "student" ? a.citizen_id : a.password);
      const started = performance.now();
      await page.locator("button[type=submit]").click();
      await page.waitForURL(/\/dashboard/, { timeout: 30000 });
      await expect(page.getByText(a.full_name, { exact: true }).first()).toBeVisible({ timeout: 20000 });
      const loginAndRenderMs = Math.round(performance.now() - started);
      if (role === "academic") {
        await expect(page.locator("tbody tr")).toHaveCount(8);
        await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
        await page.getByLabel("ค้นหารายการ", { exact: true }).fill("นักเรียนจำลอง 1199");
        await expect(page.locator("tbody tr")).toHaveCount(1);
        await expect(page.locator("tbody")).toContainText("นักเรียนจำลอง 1199");
      } else if (role === "manager") {
        await page.getByRole("button", { name: "รายชื่อนักเรียนที่ยังไม่เรียบร้อย", exact: true }).click();
        await expect(page.locator("tbody tr")).toHaveCount(20, { timeout: 20000 });
        await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
        await expect(page.locator("tbody tr")).toHaveCount(20, { timeout: 20000 });
      }
      await page.screenshot({ path: resolve(dir, `live-${role}.png`), fullPage: true });
      if (role === "student") {
        await page.getByRole("button", { name: "ประวัติแก้ไขผลการเรียน", exact: true }).click();
        await expect(page.getByText("ประวัติการแก้ไขที่เก็บเมื่อถึงเวลาปิดระบบ · เปิดอ่านได้ตลอดเวลา", { exact: true })).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => page.locator("#role-aside").evaluate(e => e.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: resolve(dir, "live-student-mobile.png"), fullPage: true });
      }
      assert.deepEqual(errors, []);
      results.push({ role, login_and_render_ms: loginAndRenderMs, passed: true, errors });
      console.log(JSON.stringify(results.at(-1)));
      await context.close();
    }
  } finally {
    await browser.close();
    writeFileSync(resolve(dir, "live-browser.json"), JSON.stringify({ at: new Date().toISOString(), site: siteUrl, results }, null, 2));
  }
}
async function main() {
  const mode = process.argv[2];
  if (mode === "inspect") await inspect();
  else if (mode === "seed") await seed();
  else if (mode === "grades") await grades();
  else if (mode === "load") await load();
  else if (mode === "probe") await probe();
  else if (mode === "verify") await verify();
  else if (mode === "browser") await browserCheck();
  else if (mode === "cleanup-plan" || mode === "cleanup") await cleanup(mode === "cleanup");
  else if (mode === "cleanup-status") await cleanupStatus();
  else if (mode === "cleanup-confirmed-orphans") {
    // These three original profiles were deleted by the owner during cleanup.
    // The owner explicitly confirmed keeping only the remaining four accounts.
    const confirmed = ["1fe16e2b-3a1e-44bc-b4e9-2832aa063a74", "5e3f23f9-7224-47f5-b500-634308479f05", "71ffb572-2711-4928-8186-f7a9fe4cfc77"];
    for (const id of confirmed) {
      const profile = await admin.from("profiles").select("id").eq("id", id).maybeSingle(); check(profile.error);
      assert.equal(profile.data, null);
      const deleted = await admin.auth.admin.deleteUser(id); check(deleted.error);
    }
    await cleanupStatus();
  }
  else throw new Error("Use inspect | seed | grades | probe | load | verify | browser");
}
async function cleanupStatus() {
  const before = JSON.parse(readFileSync(resolve(dir, "pre-cleanup-backup.json"), "utf8"));
  const ids = new Set(Object.values(state.created));
  const differences: Record<string, unknown> = {};
  for (const [table, rows] of Object.entries(before.snapshot) as [string, any[]][]) {
    const r = await admin.from(table).select("*").order("id"); check(r.error);
    const expected = rows.filter(x => !ids.has(x.id) && !ids.has(x.student_id) && !ids.has(x.actor_id) && !ids.has(x.user_id));
    if (["profiles", "grade_records", "grade_record_history", "site_schedule"].includes(table)) {
      const original = table === "grade_records" ? state.originalRecords! : table === "grade_record_history" ? state.originalHistory! : expected;
      differences[table] = { count: r.data!.length, missing_original_ids: original.filter((x: any) => !r.data!.some(y => y.id === x.id)).map((x: any) => x.id), retained_rows_unchanged: r.data!.every(x => original.some((y: any) => JSON.stringify(x) === JSON.stringify(y))) };
    } else differences[table] = { count: r.data!.length };
  }
  const r = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); check(r.error);
  differences.auth_users = { count: r.data.users.length, remaining_mock: r.data.users.filter(u => ids.has(u.id)).length, missing_original_ids: before.users.filter((u: any) => !ids.has(u.id) && !r.data.users.some(x => x.id === u.id)).map((u: any) => u.id) };
  writeFileSync(resolve(dir, "cleanup-result.json"), JSON.stringify({ at: new Date().toISOString(), differences }, null, 2));
  console.log(JSON.stringify(differences));
}
async function cleanup(apply: boolean) {
  assert.equal(Object.keys(state.created).length, 2520);
  const ids = new Set(Object.values(state.created));
  const accounts = new Map(accountsCsv().map(a => [state.created[accountKey(a as { role: string; identifier: string })], a]));
  const tables = ["profiles", "grade_records", "grade_record_history", "grade_assignments", "assignment_files", "audit_log", "push_subscriptions", "site_schedule"];
  const snapshot: Record<string, any[]> = {};
  for (const table of tables) {
    snapshot[table] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await admin.from(table).select("*").order("id").range(offset, offset + 999); check(r.error);
      snapshot[table].push(...r.data!);
      if (r.data!.length < 1000) break;
    }
  }
  const users = [];
  for (let page = 1; ; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 }); check(r.error);
    users.push(...r.data.users);
    if (r.data.users.length < 1000) break;
  }
  const mockProfiles = snapshot.profiles.filter(p => ids.has(p.id));
  for (const p of mockProfiles) {
    const a = accounts.get(p.id)!;
    assert.equal(p.full_name, a.full_name); assert.equal(p.role, a.role);
  }
  const mockUsers = users.filter(u => ids.has(u.id));
  for (const u of mockUsers) {
    const a = accounts.get(u.id)!;
    assert.equal(u.app_metadata.synthetic_load_test, "mst-grs-1200");
    assert.equal(u.email, loginEmail(accountKey(a as { role: string; identifier: string }), secret));
  }
  const mockRecords = snapshot.grade_records.filter(r => ids.has(r.student_id));
  const mockHistory = snapshot.grade_record_history.filter(r => ids.has(r.student_id));
  for (const r of [...mockRecords, ...mockHistory]) {
    assert.ok(["MOCK-001", "MOCK-E2E", "MOCK-E2E-2"].includes(r.course_code));
    assert.equal(r.student_code, accounts.get(r.student_id)!.identifier);
    assert.ok(r.teacher_id.every((id: string) => ids.has(id)));
  }
  const recordIds = new Set([...mockRecords, ...mockHistory].map(r => r.id));
  assert.deepEqual(snapshot.grade_records.filter(r => !recordIds.has(r.id)), state.originalRecords);
  assert.deepEqual(snapshot.grade_record_history.filter(r => !recordIds.has(r.id)), state.originalHistory);
  assert.equal(snapshot.profiles.filter(p => !ids.has(p.id)).length, 7);
  const targets: Record<string, any[]> = {
    audit_log: snapshot.audit_log.filter(r => ids.has(r.actor_id) || recordIds.has(r.record_id) || recordIds.has(r.archived_record_id)),
    assignment_files: snapshot.assignment_files.filter(r => ids.has(r.uploaded_by) || recordIds.has(r.record_id) || recordIds.has(r.archived_record_id)),
    grade_assignments: snapshot.grade_assignments.filter(r => recordIds.has(r.record_id) || recordIds.has(r.archived_record_id)),
    grade_records: mockRecords, grade_record_history: mockHistory,
    push_subscriptions: snapshot.push_subscriptions.filter(r => ids.has(r.user_id)),
    profiles: mockProfiles,
  };
  // No uploads were generated. Stop if new activity needs separate preservation.
  assert.equal(targets.assignment_files.length, 0, "Unexpected test-account uploads; inspect before cleanup");
  for (const a of targets.audit_log) {
    assert.ok(!a.record_id || recordIds.has(a.record_id));
    assert.ok(!a.archived_record_id || recordIds.has(a.archived_record_id));
  }
  const backupPath = resolve(dir, "pre-cleanup-backup.json");
  if (!existsSync(backupPath)) writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), snapshot, users }, null, 2));
  const counts = Object.fromEntries(Object.entries(targets).map(([t, rows]) => [t, rows.length]));
  console.log(JSON.stringify({ apply, targets: counts, auth_users: mockUsers.length, originals_verified: true }));
  if (!apply) return;
  for (const [table, rows] of Object.entries(targets)) {
    for (let i = 0; i < rows.length; i += 100) {
      const r = await admin.from(table).delete().in("id", rows.slice(i, i + 100).map(r => r.id)); check(r.error);
    }
    console.log(JSON.stringify({ table, deleted: rows.length }));
  }
  let removed = 0;
  await pool(mockUsers, 6, async u => {
    const r = await admin.auth.admin.deleteUser(u.id); check(r.error);
    removed++;
    if (removed % 100 === 0 || removed === mockUsers.length) console.log(JSON.stringify({ auth_users_deleted: removed, total: mockUsers.length }));
  });
  // Compare every preserved table row with the snapshot, not just the counts.
  for (const table of tables) {
    const r = await admin.from(table).select("*").order("id"); check(r.error);
    const deleted = new Set((targets[table] ?? []).map(r => r.id));
    assert.deepEqual(r.data, snapshot[table].filter(r => !deleted.has(r.id)));
  }
  const remaining = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); check(remaining.error);
  assert.deepEqual(remaining.data.users.map(u => u.id).sort(), users.filter(u => !ids.has(u.id)).map(u => u.id).sort());
  const report = { at: new Date().toISOString(), removed: counts, removed_auth_users: removed, remaining_profiles: 7, remaining_grade_records: state.originalRecords!.length, remaining_history: state.originalHistory!.length, preserved_rows_verified: true, note: "Legacy trigger repair retained; no schema rollback or managed Auth log reset" };
  writeFileSync(resolve(dir, "cleanup-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Load test failed"); process.exitCode = 1; });
