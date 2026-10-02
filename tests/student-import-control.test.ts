import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import {
  compareStudents,
  type StudentList,
  type StudentRow,
} from "../src/lib/students";

test("import control protects owners, serializes batches, persists cancellation and enforces expiry", async () => {
  const db = await loadTestDatabase();
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  async function as(n: number) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(n),
    ]);
    await db.exec("set role authenticated");
  }
  const control = async (
    operation: string,
    importId: string | null = null,
    batchId: string | null = null,
  ) =>
    (
      await db.query<{
        result: { importId: string; status: string; canContinue: boolean };
      }>("select student_import_control($1,$2,$3) result", [
        operation,
        importId,
        batchId,
      ])
    ).rows[0].result;
  try {
    for (const [n, role] of [
      [1, "admin"],
      [2, "admin"],
      [3, "teacher"],
      [4, "academic"],
      [5, "manager"],
      [6, "student"],
    ] as const) {
      await db.query("insert into auth.users values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code) values($1,$2,$3,$4)",
        [id(n), role, role, role === "student" ? "10006" : null],
      );
    }
    await as(1);
    const run = await control("start");
    assert.equal(run.canContinue, true);
    await assert.rejects(
      () => db.query("select * from student_import_runs"),
      /permission denied/,
    );
    assert.equal(
      (await control("claim", run.importId, id(100))).canContinue,
      true,
    );
    await assert.rejects(
      () => control("claim", run.importId, id(101)),
      /กำลังทำงาน/,
    );
    await assert.rejects(() => control("finish", run.importId), /กำลังรอ/);
    await assert.rejects(
      () => control("release", run.importId, id(101)),
      /ไม่ตรงกัน/,
    );
    await as(2);
    await assert.rejects(() => control("cancel", run.importId), /ไม่มีสิทธิ์/);
    await assert.rejects(
      () => control("claim", run.importId, id(101)),
      /ไม่มีสิทธิ์/,
    );
    await as(1);
    assert.equal((await control("cancel", run.importId)).canContinue, false);
    assert.equal(
      (await control("check", run.importId, id(100))).status,
      "cancelled",
    );
    await control("release", run.importId, id(100));
    assert.equal((await control("finish", run.importId)).status, "cancelled");
    assert.equal(
      (await control("claim", run.importId, id(101))).canContinue,
      false,
    );
    const expired = await control("start");
    await control("claim", expired.importId, id(102));
    await db.exec("reset role");
    await db.query(
      "update student_import_runs set expires_at=now()-interval '1 minute' where id=$1",
      [expired.importId],
    );
    await as(1);
    assert.equal(
      (await control("check", expired.importId, id(102))).canContinue,
      false,
    );
    await control("release", expired.importId, id(102));
    const finished = await control("start");
    assert.equal(
      (await control("finish", finished.importId)).status,
      "finished",
    );
    assert.equal(
      (await control("claim", finished.importId, id(103))).canContinue,
      false,
    );
    for (const n of [3, 4, 5, 6]) {
      await as(n);
      await assert.rejects(() => control("start"), /เฉพาะผู้ดูแลระบบ/);
      await assert.rejects(
        () => control("cancel", run.importId),
        /เฉพาะผู้ดูแลระบบ/,
      );
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(() => control("start"), /permission denied/);
    await db.exec("reset role");
    const meta = (
      await db.query<{ active_batch_id: string | null }>(
        "select * from student_import_runs where id=$1",
        [run.importId],
      )
    ).rows[0];
    assert.equal(meta.active_batch_id, null);
    assert.ok(!("citizen_id" in meta));
  } finally {
    await db.close();
  }
});

test("numeric class/room order agrees with Demo across pagination, legacy formats and unknown rooms", async () => {
  const db = await loadTestDatabase();
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const expected: StudentRow[] = [];
  try {
    await db.query("insert into auth.users values($1)", [id(1)]);
    await db.query(
      "insert into profiles(id,role,full_name) values($1,'admin','Admin')",
      [id(1)],
    );
    const rooms = ["ม.1/10", "ม.1/2", "ม.2/1", "1/1", "unknown", null, "ม.1/9"];
    for (let i = 0; i < 75; i++) {
      const row: StudentRow = {
        id: id(i + 10),
        student_code: String(10000 + i),
        full_name: `Student ${i}`,
        classroom: rooms[i % rooms.length],
        roll_number: i % 9 === 0 ? null : (i % 10) + 1,
        name_prefix: null,
        first_name: null,
        last_name: null,
      };
      expected.push(row);
      await db.query("insert into auth.users values($1)", [row.id]);
      await db.query(
        "insert into profiles(id,role,student_code,full_name,classroom,roll_number) values($1,'student',$2,$3,$4,$5)",
        [
          row.id,
          row.student_code,
          row.full_name,
          row.classroom,
          row.roll_number,
        ],
      );
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1),
    ]);
    await db.exec("set role authenticated");
    const actual: StudentRow[] = [];
    for (const page of [1, 2]) {
      const data = (
        await db.query<{ result: StudentList }>(
          "select admin_student_list('',null,$1) result",
          [page],
        )
      ).rows[0].result;
      assert.equal(data.total, 75);
      actual.push(...data.items);
    }
    assert.deepEqual(
      actual.map((r) => r.id),
      expected.sort(compareStudents).map((r) => r.id),
    );
    assert.equal(actual[0].classroom, "1/1");
    assert.equal(actual[actual.length - 1].classroom, null);
    assert.ok(!("position" in actual[0]));
    assert.ok(!("citizen_id_encrypted" in actual[0]));
  } finally {
    await db.close();
  }
});
