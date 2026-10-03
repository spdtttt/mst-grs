// Isolated attack simulations against all local migrations. Never connects to Supabase.
// Reproductions describe current weaknesses; they are evidence, not passing security gates.
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadTestDatabase } from "./load-test-bootstrap";
import { teacherRegistrationSchema } from "../src/lib/auth-input";
import { provisionTeacher } from "../src/lib/teacher-registration";
import { encryptStaffCitizenId } from "../src/lib/staff-identity";

async function main() {
  const db = await loadTestDatabase();
  const results: { name: string; result: string; evidence?: unknown }[] = [];
  const id = (n: number) =>
    `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const session = (n: number) =>
    `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const roles = [
    "student",
    "student",
    "teacher",
    "teacher",
    "academic",
    "manager",
    "admin",
  ];
  async function as(n: number, claims: Record<string, unknown> = {}) {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [
        n ? id(n) : "",
        JSON.stringify(n ? { session_id: session(n), ...claims } : {}),
      ],
    );
    await db.exec(n ? "set role authenticated" : "set role anon");
  }
  async function denied(name: string, sql: string, args: unknown[] = []) {
    let error: any;
    try {
      await db.query(sql, args);
    } catch (e) {
      error = e;
    }
    assert.ok(error, `Unexpected permission: ${name}`);
    assert.ok(
      ["42501", "P0001"].includes(error.code),
      `${name}: unexpected error ${error.code}: ${error.message}`,
    );
    results.push({ name, result: "blocked", evidence: { code: error.code } });
  }
  try {
    // The shared test bootstrap models only the minimal Storage table.
    await db.exec("alter table storage.objects add column metadata jsonb");
    for (const [i, role] of roles.entries()) {
      const n = i + 1;
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id(n),
        `audit${n}@example.invalid`,
      ]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code,classroom) values($1,$2,$3,$4,$5)",
        [
          id(n),
          role,
          `Audit ${n}`,
          role === "student" ? `9000${n}` : null,
          role === "student" ? "ม.1/1" : null,
        ],
      );
      await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
        session(n),
        id(n),
      ]);
      await db.query("select activate_login_role($1,$2,$3)", [
        session(n),
        id(n),
        role,
      ]);
    }
    await as(7);
    await db.query(
      "select update_schedule(now()-interval '1 day',now()+interval '2 days','Security test')",
    );
    await db.exec("reset role");
    for (let n = 1; n <= 2; n++) {
      await db.query(
        "insert into grade_records(id,course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id) values($1,$2,'Audit subject',1,'ม.1/1',$3,$4,$5,$6,2569,1,'0',$7,$8)",
        [
          id(100 + n),
          `AUDIT${n}`,
          [`Audit ${n + 2}`],
          `9000${n}`,
          `Audit ${n}`,
          n,
          id(n),
          [id(n + 2)],
        ],
      );
      await db.query(
        "insert into grade_assignments(id,record_id,round_number,assignment,due_at) values($1,$2,1,'Synthetic audit assignment',now()+interval '1 day')",
        [id(200 + n), id(100 + n)],
      );
      const path = `${id(100 + n)}/${id(300 + n)}.pdf`;
      await db.query(
        'insert into storage.objects(bucket_id,name,metadata) values(\'assignment-files\',$1,\'{"size":10,"mimetype":"application/pdf"}\')',
        [path],
      );
      await db.query(
        "insert into assignment_files(record_id,assignment_id,storage_path,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,$3,'audit.pdf','application/pdf',10,$4)",
        [id(100 + n), id(200 + n), path, id(n + 2)],
      );
    }
    const inventory = {
      tables: (
        await db.query(
          "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1",
        )
      ).rows,
      functions: (
        await db.query(
          "select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1",
        )
      ).rows,
      policies: (
        await db.query(
          "select * from pg_policies where schemaname in ('public','storage') order by tablename,policyname",
        )
      ).rows,
    };
    assert.ok(inventory.tables.every((t: any) => t.relrowsecurity));
    results.push({
      name: "All public tables enable RLS",
      result: "passed",
      evidence: inventory.tables.length,
    });
    await as(0);
    for (const table of inventory.tables as { relname: string }[])
      await denied(
        `anon SELECT ${table.relname}`,
        `select * from public.${table.relname} limit 1`,
      );
    for (const [i, role] of roles.entries()) {
      const n = i + 1;
      await as(n);
      assert.equal(
        (await db.query<{ r: string }>("select my_role() r")).rows[0].r,
        role,
      );
      const expected =
        role === "academic" ? 2 : ["student", "teacher"].includes(role) ? 1 : 0;
      for (const table of [
        "grade_records",
        "grade_assignments",
        "assignment_files",
        "storage.objects",
      ]) {
        const rows = (await db.query(`select * from ${table}`)).rows;
        assert.equal(rows.length, expected, `${role}/${n} read ${table}`);
        results.push({
          name: `${role}/${n} SELECT ${table}`,
          result: "isolated",
          evidence: rows.length,
        });
      }
      assert.equal((await db.query("select id from profiles")).rows.length, 1);
      for (const sql of [
        "update profiles set role='admin'",
        "update grade_records set final_grade='4'",
        "delete from audit_log",
        "delete from grade_record_history",
        "delete from grade_reset_history",
        "delete from grade_corrections",
        "select * from login_role_sessions",
        "select * from profile_roles",
        "select * from push_subscriptions",
        "select * from login_attempts",
      ])
        await denied(`${role}/${n}: ${sql}`, sql);
      for (const sql of [
        "select set_staff_roles($1,ARRAY['teacher','admin']::app_role[])",
        "select activate_login_role($2,$1,'admin')",
        "select register_teacher_profile($1,'{}')",
        "select resolve_staff_login(ARRAY['a','b','c'],'admin')",
        "select consume_teacher_registration(repeat('a',64),repeat('b',64))",
        "select archive_completed_grade_records()",
      ])
        await denied(
          `${role}/${n} service RPC ${sql.split("(")[0]}`,
          sql,
          sql.includes("$2")
            ? [id(n), session(n)]
            : sql.includes("$1")
              ? [id(n)]
              : [],
        );
      if (role !== "admin") {
        for (const sql of [
          "select admin_student_list()",
          "select admin_account_list('manager')",
          "select admin_student_import_summary(ARRAY['90001'])",
          "select admin_delete_account($1,'student',0)",
          "select admin_manager_password_target($1,0)",
          "select admin_finish_manager_password_reset($1,0)",
          "select admin_edit_account($1,'student',0,'{}')",
          "select admin_create_manager_profile($1,'{}')",
          "select admin_create_academic_profile($1,'{}')",
          "select admin_add_academic_teacher($1,'Audit 3')",
          "select admin_reset_teacher($1,'Audit 3')",
          "select admin_reset_academic($1,'Audit 5')",
          "select admin_set_student_status('[]','graduated',2569)",
          "select student_import_control('start')",
          "select import_grades_overwrite('[]')",
          "select update_schedule(now(),now()+interval '1 day','forged')",
        ])
          await denied(
            `${role}/${n} admin RPC ${sql.split("(")[0]}`,
            sql,
            sql.includes("$1") ? [id(3)] : [],
          );
      }
      if (role !== "admin") {
        for (const sql of [
          "select admin_teacher_list()",
          "select admin_academic_list()",
          "select admin_student_lifecycle_list()",
          "select admin_save_student($1,'{}')",
          "select import_grades('[]')",
        ])
          await denied(
            `${role}/${n} legacy/admin RPC ${sql.split("(")[0]}`,
            sql,
            sql.includes("$1") ? [id(1)] : [],
          );
      }
      if (role !== "manager") {
        for (const sql of [
          "select manager_dashboard_stats()",
          "select manager_student_courses('90001')",
          "select manager_student_list(false,'',20,0)",
          "select manager_student_list_filtered(false,'',20,0,null,null,null)",
        ])
          await denied(`${role}/${n} manager RPC ${sql.split("(")[0]}`, sql);
      } else
        assert.ok(
          (await db.query("select manager_dashboard_stats()")).rows.length,
        );
      if (n !== 2)
        await denied(
          `${role}/${n} request another student's record`,
          "select advance_grade($1,'pending')",
          [id(102)],
        );
      if (n !== 4)
        await denied(
          `${role}/${n} change another teacher's grade`,
          "select correct_final_grade($1,'1','4')",
          [id(102)],
        );
      if (n !== 3)
        await denied(
          `${role}/${n} upload to another teacher's record`,
          "insert into storage.objects(bucket_id,name) values('assignment-files',$1)",
          [`${id(101)}/${id(999)}.pdf`],
        );
      const protectedPath = `${id(101)}/${id(301)}.pdf`;
      await db.query("delete from storage.objects where name=$1", [
        protectedPath,
      ]);
      await db.exec("reset role");
      assert.equal(
        (
          await db.query("select id from storage.objects where name=$1", [
            protectedPath,
          ])
        ).rows.length,
        1,
      );
      results.push({
        name: `${role}/${n} cannot delete linked assignment file`,
        result: "blocked",
      });
      await as(n, {
        user_metadata: { role: "admin" },
        app_metadata: { role: "admin" },
        role: "admin",
      });
      assert.equal(
        (await db.query<{ r: string }>("select my_role() r")).rows[0].r,
        role,
      );
      results.push({
        name: `${role}/${n} ignore metadata role claims`,
        result: "passed",
      });
      await as(n, { session_id: session(n === 7 ? 1 : 7) });
      assert.equal(
        (await db.query<{ r: null }>("select my_role() r")).rows[0].r,
        null,
      );
      assert.equal(
        (await db.query("select * from grade_records")).rows.length,
        0,
      );
      results.push({
        name: `${role}/${n} foreign session cannot bind role`,
        result: "blocked",
      });
    }
    await as(7);
    const injection = (
      await db.query<{ r: { total: number } }>(
        "select admin_student_list($1,null,1,null) r",
        ["' OR 1=1 --"],
      )
    ).rows[0].r;
    assert.equal(injection.total, 0);
    await denied(
      "invalid room length",
      "select admin_student_list('',null,1,repeat('x',41))",
    );
    results.push({
      name: "SQL injection search stays literal",
      result: "passed",
    });

    // Reproduction 1: public registration has no invitation/approval; imported names grant ownership.
    await db.exec("reset role");
    const secret = "synthetic-security-audit-secret-at-least-32";
    const input = {
      citizen_id: "0000000000000",
      name_prefix: "Mr",
      first_name: "Unverified",
      last_name: "Teacher",
      password: "test-only-password",
    };
    assert.equal(teacherRegistrationSchema.safeParse(input).success, true);
    const registered = await provisionTeacher(
      input,
      {
        async createAuth(email) {
          await db.query("insert into auth.users(id,email) values($1,$2)", [
            id(9),
            email,
          ]);
          return id(9);
        },
        async saveProfile(profile, citizen) {
          await db.query("select register_teacher_profile($1,$2)", [
            profile.id,
            {
              name_prefix: profile.name_prefix,
              first_name: profile.first_name,
              last_name: profile.last_name,
              citizen_id_encrypted: encryptStaffCitizenId(
                citizen,
                profile.id,
                secret,
              ),
            },
          ]);
        },
        async findProfile() {
          return null;
        },
        async deleteAuth() {
          throw new Error("unexpected rollback");
        },
      },
      secret,
    );
    assert.equal(registered.success, true);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      session(9),
      id(9),
    ]);
    await db.query("select activate_login_role($1,$2,'teacher')", [
      session(9),
      id(9),
    ]);
    await as(7);
    await db.query("select import_grades_overwrite($1)", [
      [
        {
          course_code: "UNVERIFIED",
          course_name: "Audit subject",
          credits: 1,
          classroom: "ม.1/1",
          teacher_name: ["MrUnverified Teacher"],
          student_code: "90001",
          student_name: "Audit 1",
          roll_number: 1,
          academic_year: 2569,
          semester: 1,
          original_grade: "0",
        },
      ],
    ]);
    await as(9);
    assert.equal(
      (
        await db.query(
          "select id from grade_records where course_code='UNVERIFIED'",
        )
      ).rows.length,
      1,
    );
    results.push({
      name: "F1: self-registered, unverified teacher receives record by matching import name",
      result: "reproduced",
      evidence:
        "Synthetic Auth adapter; real registration/provisioning/SQL logic. Admin import of that name is required.",
    });

    // Reproduction 2: arbitrary HTTPS push destination is accepted by SQL and the actual sender.
    const require = createRequire(import.meta.url);
    const webpush = require("web-push");
    const https = require("node:https");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const subscription = {
      endpoint: "https://127.0.0.1:9443/audit-only",
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    };
    await as(3);
    await db.query("select upsert_push_subscription($1,$2,$3,'audit')", [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
    ]);
    const vapid = webpush.generateVAPIDKeys();
    const originalRequest = https.request;
    let destination: unknown;
    https.request = (options: unknown) => {
      destination = options;
      throw new Error("AUDIT_BLOCKED_NETWORK");
    };
    try {
      await assert.rejects(
        webpush.sendNotification(subscription, "Synthetic notification", {
          vapidDetails: { subject: "mailto:audit@example.invalid", ...vapid },
        }),
        /AUDIT_BLOCKED_NETWORK/,
      );
    } finally {
      https.request = originalRequest;
    }
    assert.equal((destination as { hostname: string }).hostname, "127.0.0.1");
    results.push({
      name: "F2: push accepts loopback destination and reaches HTTPS request sink",
      result: "reproduced",
      evidence: {
        hostname: "127.0.0.1",
        port: 9443,
        networkSent: false,
        condition:
          "Push configured and student request triggers notification; TLS/egress still apply",
      },
    });

    // Reproduction 3: an unauthenticated caller can insert arbitrary rate-limit keys.
    await as(0);
    const bucket = "a".repeat(64);
    for (let i = 1; i <= 11; i++)
      assert.equal(
        (
          await db.query<{ ok: boolean }>(
            "select consume_login_attempt($1) ok",
            [bucket],
          )
        ).rows[0].ok,
        i <= 10,
      );
    let accepted = 0;
    for (let n = 1; n <= 12; n++)
      if (
        (
          await db.query<{ ok: boolean }>(
            "select consume_login_attempt($1) ok",
            [n.toString(16).padStart(64, "0")],
          )
        ).rows[0].ok
      )
        accepted++;
    assert.equal(accepted, 12);
    await db.exec("reset role");
    const rateRows = (
      await db.query<{ n: number }>(
        "select count(*)::int n from login_attempts",
      )
    ).rows[0].n;
    results.push({
      name: "F3: anon can grow login_attempts using caller-chosen buckets",
      result: "reproduced",
      evidence: { rows: rateRows, requests: 23, loginBypassProven: false },
    });
    await db.query("delete from auth.sessions where id=$1", [session(3)]);
    await as(3);
    assert.equal(
      (await db.query<{ r: null }>("select my_role() r")).rows[0].r,
      null,
    );
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    results.push({
      name: "revoked session loses protected record access",
      result: "passed",
    });
    mkdirSync("test-results/security", { recursive: true });
    writeFileSync(
      "test-results/security/local-audit.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          scope:
            "PGlite with migrations 001-041 except pg_cron; no live Auth, Storage transport or JWT verification",
          results,
          inventory,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          checks: results.length,
          findings: results.filter((r) => r.result === "reproduced"),
          blocked: results.filter((r) => r.result === "blocked").length,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
