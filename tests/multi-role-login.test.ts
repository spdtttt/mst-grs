import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { loginEmail, identityPassword } from "../src/lib/identity";
import {
  sessionIdFromAuthResponse,
  signInForRole,
  staffLoginEmails,
  type RoleLoginStore,
} from "../src/lib/role-login";
import { roleHomePath } from "../src/lib/navigation";

const secret = "multi-role-test-secret-at-least-32-characters";
const citizenId = "1000000000001";
const teacherId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const sessionId = "10000000-0000-4000-8000-000000000001";
function authResponse(userId = teacherId, session = sessionId) {
  return `test.${Buffer.from(JSON.stringify({ sub: userId, session_id: session })).toString("base64url")}.test`;
}

test("one staff account and password signs in under each granted role without changing its Auth identity", async () => {
  for (const role of ["teacher", "academic", "admin"] as const) {
    const steps: string[] = [];
    const store: RoleLoginStore = {
      async resolveStaff(emails, requested) {
        assert.deepEqual(emails, staffLoginEmails(citizenId, secret));
        assert.equal(requested, role);
        return loginEmail(`teacher:${citizenId}`, secret);
      },
      async signIn(email, password) {
        assert.equal(email, loginEmail(`teacher:${citizenId}`, secret));
        assert.equal(password, "abc123");
        steps.push("password");
        return { userId: teacherId, accessToken: authResponse() };
      },
      async activate(session, user, selected) {
        assert.deepEqual(
          [session, user, selected],
          [sessionId, teacherId, role],
        );
        steps.push("activate");
      },
      async signOut() {
        steps.push("signout");
      },
    };
    assert.deepEqual(
      await signInForRole(
        { role, identifier: citizenId, password: "abc123" },
        store,
        secret,
      ),
      { error: "" },
    );
    assert.deepEqual(steps, ["password", "activate"]);
    assert.equal(
      roleHomePath(role),
      role === "admin" ? "/dashboard/admin" : "/dashboard",
    );
  }
});

test("failed authentication cannot activate a role; failed activation signs out the new session", async () => {
  const calls: string[] = [];
  const input = {
    role: "admin" as const,
    identifier: citizenId,
    password: "abc123",
  };
  const store: RoleLoginStore = {
    async resolveStaff() {
      return loginEmail(`teacher:${citizenId}`, secret);
    },
    async signIn() {
      calls.push("signin");
      return null;
    },
    async activate() {
      calls.push("activate");
      throw new Error("denied");
    },
    async signOut() {
      calls.push("signout");
    },
  };
  assert.ok((await signInForRole(input, store, secret)).error);
  assert.deepEqual(calls, ["signin"]);
  calls.length = 0;
  assert.ok(
    (
      await signInForRole(
        input,
        { ...store, resolveStaff: async () => null },
        secret,
      )
    ).error,
  );
  assert.deepEqual(calls, []);
  store.signIn = async () => ({
    userId: teacherId,
    accessToken: authResponse(),
  });
  assert.ok((await signInForRole(input, store, secret)).error);
  assert.deepEqual(calls, ["activate", "signout"]);
  assert.throws(() =>
    sessionIdFromAuthResponse(authResponse(otherId), teacherId),
  );
  assert.throws(() =>
    sessionIdFromAuthResponse(authResponse(teacherId, "bad"), teacherId),
  );
});

test("student and manager credentials stay compatible and also bind their selected role", async () => {
  for (const role of ["student", "manager"] as const) {
    let bound = false;
    const store: RoleLoginStore = {
      async resolveStaff() {
        throw new Error("must not resolve student/manager as staff");
      },
      async signIn(email, password) {
        assert.equal(email, loginEmail(`${role}:10001`, secret));
        assert.equal(
          password,
          role === "student"
            ? identityPassword("student", citizenId, secret)
            : citizenId,
        );
        return { userId: teacherId, accessToken: authResponse() };
      },
      async activate(_session, _user, selected) {
        assert.equal(selected, role);
        bound = true;
      },
      async signOut() {},
    };
    assert.equal(
      (
        await signInForRole(
          { role, identifier: "10001", password: citizenId },
          store,
          secret,
        )
      ).error,
      "",
    );
    assert.ok(bound);
  }
});

test("database fixes each session to its selected role, enforces RLS and rejects escalation", async () => {
  const db = await loadTestDatabase();
  const academicSession = "10000000-0000-4000-8000-000000000002";
  const adminSession = "10000000-0000-4000-8000-000000000003";
  const unboundSession = "10000000-0000-4000-8000-000000000004";
  const emails = staffLoginEmails(citizenId, secret);
  const asSession = async (session: string, user = teacherId) => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
      [
        user,
        JSON.stringify({
          session_id: session,
          user_metadata: { role: "admin" },
        }),
      ],
    );
    await db.exec("set role authenticated");
  };
  const asService = async () => {
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{}',false); set role service_role",
    );
  };
  const activeRole = async () =>
    (await db.query<{ role: string | null }>("select public.my_role() role"))
      .rows[0].role;
  const activate = (session: string, role: string, user = teacherId) =>
    db.query("select public.activate_login_role($1,$2,$3)", [
      session,
      user,
      role,
    ]);
  const setRoles = (roles: string[]) =>
    db.query("select public.set_staff_roles($1,$2::public.app_role[])", [
      teacherId,
      `{${roles.join(",")}}`,
    ]);
  try {
    await db.query(
      "insert into auth.users(id,email) values($1,$2),($3,null),($4,null)",
      [teacherId, emails[0], studentId, otherId],
    );
    await db.query(
      "insert into profiles(id,role,full_name,student_code,classroom) values($1,'teacher','Teacher A',null,null),($2,'student','Student','10001','ม.4/1'),($3,'academic','Teacher B',null,null)",
      [teacherId, studentId, otherId],
    );
    for (const session of [
      sessionId,
      academicSession,
      adminSession,
      unboundSession,
    ])
      await db.query("insert into auth.sessions values($1,$2)", [
        session,
        teacherId,
      ]);
    await db.exec(
      "update site_schedule set opens_at=now()-interval '1 day', closes_at=now()+interval '1 day' where id=1",
    );
    await asService();
    await setRoles(["teacher", "academic", "admin"]);
    await db.query(
      "select public.set_staff_roles($1,ARRAY['academic','teacher']::public.app_role[])",
      [otherId],
    );
    for (const role of ["teacher", "academic", "admin"]) {
      const resolved = await db.query<{ email: string }>(
        "select public.resolve_staff_login($1,$2) email",
        [emails, role],
      );
      assert.equal(resolved.rows[0].email, emails[0]);
    }
    assert.equal(
      (
        await db.query<{ found: boolean }>(
          "select public.staff_identity_exists($1) found",
          [emails],
        )
      ).rows[0].found,
      true,
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.set_staff_roles($1,ARRAY['student','admin']::public.app_role[])",
          [studentId],
        ),
      /Invalid staff roles/,
    );
    await assert.rejects(
      () => setRoles(["academic", "admin"]),
      /original account role/,
    );
    await activate(sessionId, "teacher");
    await activate(academicSession, "academic");
    await activate(adminSession, "admin");
    await activate(sessionId, "teacher"); // Retry is idempotent.
    await assert.rejects(() => activate(sessionId, "admin"), /Sign out/);
    await assert.rejects(
      () => activate(unboundSession, "student"),
      /Invalid account/,
    );
    await assert.rejects(
      () => activate(unboundSession, "academic", otherId),
      /Invalid account/,
    );

    await asSession(adminSession);
    assert.equal(await activeRole(), "admin");
    const rows = ["Teacher A", "Teacher B"].map((teacher, i) => ({
      course_code: `C${i}`,
      course_name: "Course",
      credits: 1,
      classroom: "ม.4/1",
      teacher_name: [teacher],
      student_code: "10001",
      student_name: "Student",
      roll_number: 1,
      academic_year: 2569,
      semester: 1,
      original_grade: "0",
    }));
    const imported = await db.query<{ result: { inserted: number } }>(
      "select public.import_grades_overwrite($1::jsonb) result",
      [JSON.stringify(rows)],
    );
    assert.equal(imported.rows[0].result.inserted, 2); // Includes a teacher whose original role is academic.
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await db.query("select public.admin_student_list() ");
    await assert.rejects(
      () => setRoles(["teacher", "admin"]),
      /permission denied/,
    );
    await assert.rejects(
      () => activate(sessionId, "admin"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query("select public.resolve_staff_login($1,'teacher')", [emails]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("insert into profile_roles values($1,'admin')", [otherId]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.exec("update login_role_sessions set role='admin'"),
      /permission denied/,
    );

    await asSession(sessionId);
    assert.equal(await activeRole(), "teacher");
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      1,
    );
    await assert.rejects(
      () => db.query("select public.admin_student_list()"),
      /เฉพาะผู้ดูแลระบบ/,
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.update_schedule(now(),now()+interval '1 day','')",
        ),
      /ไม่มีสิทธิ์/,
    );
    await db.exec("reset role");
    await db.exec(
      "update grade_records set status='teacher_approved',final_grade='1'",
    );
    const recordId = (
      await db.query<{ id: string }>(
        "select id from grade_records where course_code='C0'",
      )
    ).rows[0].id;
    await asSession(sessionId);
    await assert.rejects(
      () =>
        db.query("select public.advance_grade($1,'teacher_approved')", [
          recordId,
        ]),
      /ไม่มีสิทธิ์/,
    );
    await asSession(academicSession);
    assert.equal(await activeRole(), "academic");
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      2,
    );
    await db.query("select public.advance_grade($1,'teacher_approved')", [
      recordId,
    ]);
    await assert.rejects(
      () => db.query("select public.admin_student_list()"),
      /เฉพาะผู้ดูแลระบบ/,
    );
    await asSession(unboundSession);
    assert.equal(await activeRole(), null);
    assert.equal(
      (await db.query("select * from grade_records")).rows.length,
      0,
    );
    await asSession(adminSession, otherId);
    assert.equal(await activeRole(), null);

    await asService();
    await setRoles(["teacher", "academic"]);
    await asSession(adminSession);
    assert.equal(await activeRole(), null); // Revocation affects existing sessions immediately.
    await asSession(sessionId);
    assert.equal(await activeRole(), "teacher");
    await db.exec("reset role");
    await db.query("delete from auth.sessions where id=$1", [sessionId]);
    await asSession(sessionId);
    assert.equal(await activeRole(), null);

    await db.exec("reset role");
    await db.query("update auth.users set email=$1 where id=$2", [
      emails[1],
      otherId,
    ]);
    await asService();
    assert.equal(
      (
        await db.query<{ email: string | null }>(
          "select public.resolve_staff_login($1,'academic') email",
          [emails],
        )
      ).rows[0].email,
      null,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      () => db.query("select public.staff_identity_exists($1)", [emails]),
      /permission denied/,
    );
    await assert.rejects(
      () => activate(adminSession, "admin"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
