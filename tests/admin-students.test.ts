import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { studentSchema, type StudentList } from "../src/lib/students";
import { encryptStudentCitizenId } from "../src/lib/student-identity";

test("Admin student list and profile mutations enforce role isolation, paging, filters and audit", async () => {
  const db = await loadTestDatabase();
  const uuid = (n: number) =>
    `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const admin = uuid(1000),
    teacher = uuid(1001),
    academic = uuid(1002),
    manager = uuid(1003),
    newStudent = uuid(1004);
  async function as(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function list(search = "", level: number | null = null, page = 1) {
    return (
      await db.query<{ data: StudentList }>(
        "select admin_student_list($1,$2,$3) data",
        [search, level, page],
      )
    ).rows[0].data;
  }
  const input = studentSchema.parse({
    citizen_id: "1-0000-00000-00-1",
    student_code: "00123",
    name_prefix: "เด็กชาย",
    first_name: "ศุภพล",
    last_name: "แดงประทีป",
    classroom: "ม.4/9",
    roll_number: 9,
  });
  const { citizen_id: _credential, ...profile } = input;
  const stored = {
    ...profile,
    citizen_id_encrypted: encryptStudentCitizenId(
      input.citizen_id,
      input.student_code,
      "test-only-secret-at-least-32-characters",
    ),
  };
  const save = (id: string, value: unknown = stored) =>
    db.query("select admin_save_student($1,$2::jsonb)", [
      id,
      JSON.stringify(value),
    ]);
  try {
    for (const [id, role] of [
      [admin, "admin"],
      [teacher, "teacher"],
      [academic, "academic"],
      [manager, "manager"],
    ]) {
      await db.query("insert into auth.users values($1)", [id]);
      await db.query(
        "insert into profiles(id,role,full_name) values($1,$2,$3)",
        [id, role, role],
      );
    }
    for (let i = 0; i < 60; i++) {
      await db.query("insert into auth.users values($1)", [uuid(i + 1)]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code,classroom) values($1,'student',$2,$3,$4)",
        [uuid(i + 1), `Student ${i}`, String(20000 + i), `ม.${(i % 6) + 1}/1`],
      );
    }
    await db.query("insert into auth.users values($1)", [newStudent]);
    await as(admin);
    const first = await list();
    assert.equal(first.total, 60);
    assert.equal(first.items.length, 50);
    assert.deepEqual(first.levels, [1, 2, 3, 4, 5, 6]);
    const second = await list("", null, 2);
    assert.equal(second.items.length, 10);
    assert.equal(
      new Set([...first.items, ...second.items].map((s) => s.id)).size,
      60,
    );
    assert.equal((await list("sTuDeNt 59")).total, 1);
    assert.equal((await list("", 4)).total, 10);
    assert.equal((await list("%_")).total, 0);
    assert.equal((await list("20059")).total, 1);
    // Ordinary profiles RLS still gives Admin only their own profile.
    assert.equal((await db.query("select * from profiles")).rows.length, 1);
    await assert.rejects(
      () =>
        db.exec(
          "insert into profiles(id,role,full_name) values(gen_random_uuid(),'admin','bad')",
        ),
      /permission denied/,
    );
    await save(newStudent);
    const created = await list("ศุภพล");
    assert.equal(created.total, 1);
    assert.equal(created.items[0].full_name, "เด็กชายศุภพล แดงประทีป");
    assert.equal(created.items[0].roll_number, 9);
    assert.ok(!("citizen_id" in created.items[0]));
    assert.ok(!("citizen_id_encrypted" in created.items[0]));
    await save(newStudent, {
      ...profile,
      first_name: "ชื่อใหม่",
      classroom: "ม.5/1",
      roll_number: 3,
    });
    assert.equal((await list("ชื่อใหม่", 5)).items[0].id, newStudent);
    assert.equal((await list()).total, 61);
    await assert.rejects(() => save(admin), /ไม่สามารถเปลี่ยนประเภทบัญชี/);
    await assert.rejects(
      () => save(newStudent, { ...profile, student_code: "00999" }),
      /รหัสนักเรียนเดิม/,
    );
    await assert.rejects(
      () => save(newStudent, { ...profile, name_prefix: "" }),
      /ข้อมูลนักเรียน/,
    );
    await assert.rejects(() => list("", 7), /ตัวกรอง/);
    await assert.rejects(() => list("", null, 0), /ตัวกรอง/);
    for (const id of [uuid(1), teacher, academic, manager]) {
      await as(id);
      await assert.rejects(() => list(), /เฉพาะผู้ดูแลระบบ/);
      await assert.rejects(() => save(newStudent), /เฉพาะผู้ดูแลระบบ/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(() => list(), /permission denied/);
    await assert.rejects(() => save(newStudent), /permission denied/);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select * from audit_log where action in ('student_created','student_updated')",
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query("select * from profiles where id=$1 and role='admin'", [
          admin,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from auth.users where id=$1", [newStudent]))
        .rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ citizen_id_encrypted: string }>(
          "select citizen_id_encrypted from profiles where id=$1",
          [newStudent],
        )
      ).rows[0].citizen_id_encrypted,
      stored.citizen_id_encrypted,
    );
  } finally {
    await db.close();
  }
});
