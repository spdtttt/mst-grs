import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadTestDatabase } from "./load-test-bootstrap";
import { syntheticSchool } from "../src/lib/synthetic-school";

async function main() {
  const dataset = syntheticSchool();
  const db = await loadTestDatabase();
  const result: Record<string, unknown> = { at: new Date().toISOString(), environment: "local PGlite PostgreSQL; no network or Supabase Auth", accounts: dataset.accounts.length, records: 1200 };
  const as = async (id: string) => {
    await db.exec("reset role; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const time = async (name: string, work: () => Promise<void>, repeats = 1) => {
    const values: number[] = [];
    for (let i = 0; i < repeats; i++) { const t = performance.now(); await work(); values.push(performance.now() - t); }
    values.sort((a,b) => a-b);
    result[name] = { iterations: repeats, p50_ms: +values[Math.floor(repeats * .5)].toFixed(2), p95_ms: +values[Math.min(repeats-1, Math.floor(repeats*.95))].toFixed(2) };
    console.log(JSON.stringify({ operation: name, ...result[name] as object }));
  };
  try {
    await time("seed_profiles", async () => {
      await db.query("insert into auth.users select (value->>'id')::uuid from jsonb_array_elements($1::jsonb)", [JSON.stringify(dataset.accounts)]);
      await db.query("insert into profiles(id,role,full_name,student_code,classroom) select id::uuid,role::public.app_role,full_name,student_code,classroom from jsonb_to_recordset($1::jsonb) as a(id text,role text,full_name text,student_code text,classroom text)", [JSON.stringify(dataset.accounts)]);
    });
    await as(dataset.actors.admin.id);
    await db.query("select update_schedule(now()-interval '1 day',now()+interval '1 day','synthetic local benchmark')");
    await time("import_1200", async () => {
      const r = await db.query<{ result: { inserted: number; updated: number; skipped: number } }>("select import_grades($1::jsonb) result", [JSON.stringify(dataset.imports)]);
      assert.deepEqual(r.rows[0].result, { inserted: 1200, updated: 0, skipped: 0 });
    });
    await time("overwrite_import_1200", async () => {
      const r = await db.query<{ result: { inserted: number; updated: number; skipped: number } }>("select import_grades($1::jsonb) result", [JSON.stringify(dataset.imports)]);
      assert.deepEqual(r.rows[0].result, { inserted: 0, updated: 1200, skipped: 0 });
    });
    await db.exec("reset role");
    await db.query(`update grade_records g set status=(r->>'status')::public.grade_status,
      assignment=r->>'assignment',due_at=(r->>'due_at')::timestamptz,
      requested_at=(r->>'requested_at')::timestamptz,assigned_at=(r->>'assigned_at')::timestamptz,
      submitted_at=(r->>'submitted_at')::timestamptz,teacher_approved_at=(r->>'teacher_approved_at')::timestamptz,
      completed_at=(r->>'completed_at')::timestamptz,final_grade=r->>'final_grade'
      from jsonb_array_elements($1::jsonb) r where g.student_code=r->>'student_code' and g.course_code=r->>'course_code'`, [JSON.stringify(dataset.records)]);
    await db.exec("insert into grade_assignments(record_id,round_number,assignment,due_at,assigned_at,received_at) select id,1,assignment,due_at,assigned_at,submitted_at from grade_records where assignment is not null; analyze;");
    await as(dataset.actors.academic.id);
    await time("academic_first_1000", async () => {
      assert.equal((await db.query("select * from grade_records order by created_at desc,id limit 1000")).rows.length, 1000);
    }, 30);
    assert.equal((await db.query("select * from grade_records order by created_at desc,id limit 1000 offset 1000")).rows.length, 200);
    await as(dataset.actors.student.id);
    await time("student_rls", async () => {
      const r = await db.query<{ student_id: string }>("select * from grade_records order by created_at desc,id limit 1000");
      assert.equal(r.rows.length, 1); assert.ok(r.rows.every(x => x.student_id === dataset.actors.student.id));
    }, 50);
    await as(dataset.actors.teacher.id);
    await time("teacher_rls", async () => {
      const r = await db.query<{ teacher_id: string[] }>("select * from grade_records order by created_at desc,id limit 1000");
      assert.ok(r.rows.length >= 6); assert.ok(r.rows.every(x => x.teacher_id.includes(dataset.actors.teacher.id)));
    }, 50);
    await as(dataset.actors.manager.id);
    await time("manager_stats", async () => {
      const r = await db.query<{ result: { total_records: number; completed_records: number } }>("select manager_dashboard_stats() result");
      assert.equal(r.rows[0].result.total_records, 1200); assert.equal(r.rows[0].result.completed_records, 200);
    }, 50);
    await time("manager_search_page", async () => {
      const r = await db.query<{ result: { total: number; items: unknown[] } }>("select manager_student_list_filtered(false,'',20,0,null,null,null) result");
      assert.equal(r.rows[0].result.total, 1000); assert.equal(r.rows[0].result.items.length, 20);
    }, 50);
    await as(dataset.actors.admin.id);
    await time("close_and_archive_200", async () => {
      await db.query("select update_schedule(now()-interval '2 days',now()-interval '1 day','closed test')");
    });
    await as(dataset.actors.academic.id);
    assert.equal((await db.query("select * from grade_record_history")).rows.length, 200);
    await db.exec("reset role");
    assert.equal((await db.query("select * from grade_records")).rows.length, 1000);
    assert.equal((await db.query("select * from grade_assignments where archived_record_id is not null")).rows.length, 200);
    assert.equal((await db.query<{ n: number }>("select archive_completed_grade_records() n")).rows[0].n, 0);
    result.passed = true;
    const dir = resolve("data/load-test-1200"); mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "local-benchmark.json"), JSON.stringify(result, null, 2));
  } finally { await db.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
