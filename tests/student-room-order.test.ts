import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTestDatabase } from "../scripts/load-test-bootstrap";
import { compareStudents, type StudentList } from "../src/lib/students";
import type { LifecycleList } from "../src/lib/student-lifecycle";

test("Admin rosters sort numeric rooms and rolls before pagination and retain enrollment filters", async () => {
  const db = await loadTestDatabase();
  const id = (n: number) =>
    `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.query("insert into auth.users(id) values($1)", [id(1)]);
    await db.query(
      "insert into profiles(id,role,full_name) values($1,'admin','Admin')",
      [id(1)],
    );
    let nextId = 2;
    const add = async (
      classroom: string | null,
      roll: number | null,
      status = "active",
    ) => {
      const n = nextId++;
      await db.query("insert into auth.users(id) values($1)", [id(n)]);
      await db.query(
        "insert into profiles(id,role,full_name,student_code,classroom,roll_number,student_status,student_status_year) values($1,'student','Student',$2,$3,$4,$5,$6)",
        [
          id(n),
          String(30000 + n),
          classroom,
          roll,
          status,
          status === "active" ? null : 2569,
        ],
      );
    };
    for (const room of [10, 2, 12, 1, 11, 9, 3, 8, 7, 4, 6, 5])
      for (const roll of [5, 4, 3, 2, 1]) await add(`ม.6/${room}`, roll);
    await add("ม.2/1", 1);
    await add("ม.1/10", 1);
    await add(null, null);
    await add("ม.6/2", 6, "not_graduated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(1),
    ]);
    await db.exec("set role authenticated");
    const current = async (
      page: number,
      search = "",
      classroom: string | null = null,
      level: number | null = null,
    ) =>
      (
        await db.query<{ data: StudentList }>(
          "select admin_student_list($1,$2,$3,$4) data",
          [search, level, page, classroom],
        )
      ).rows[0].data;
    const lifecycle = async (page: number, status = "active") =>
      (
        await db.query<{ data: LifecycleList }>(
          "select admin_student_lifecycle_list('',$1,null,null,$2,50) data",
          [status, page],
        )
      ).rows[0].data;
    const expected: [string | null, number | null][] = [
      ["ม.1/10", 1],
      ["ม.2/1", 1],
    ];
    for (let room = 1; room <= 12; room++)
      for (let roll = 1; roll <= 5; roll++)
        expected.push([`ม.6/${room}`, roll]);
    expected.push([null, null]);
    for (const load of [current, lifecycle]) {
      const first = await load(1),
        second = await load(2);
      assert.equal(first.total, 63);
      assert.equal(first.items.length, 50);
      assert.equal(second.items.length, 13);
      const rows = [...first.items, ...second.items];
      assert.deepEqual(
        rows.map((row) => [row.classroom, row.roll_number]),
        expected,
      );
      assert.equal(new Set(rows.map((row) => row.id)).size, 63);
      assert.ok(rows.every((row) => !("room" in row) && !("level" in row)));
      assert.deepEqual(
        [...rows]
          .reverse()
          .sort(compareStudents)
          .map((row) => row.id),
        rows.map((row) => row.id),
      );
    }
    assert.deepEqual((await lifecycle(1)).classrooms, [
      "ม.1/10",
      "ม.2/1",
      ...Array.from({ length: 12 }, (_, i) => `ม.6/${i + 1}`),
    ]);
    assert.equal((await lifecycle(1, "not_graduated")).total, 1);
    assert.equal((await current(1, "Student")).total, 63);
    const room = await current(1, "", "ม.6/2", 6);
    assert.equal(room.total, 5);
    assert.deepEqual(
      room.items.map((row) => row.roll_number),
      [1, 2, 3, 4, 5],
    );
    assert.ok(room.items.every((row) => row.classroom === "ม.6/2"));
    assert.deepEqual(
      room.classrooms,
      Array.from({ length: 12 }, (_, i) => `ม.6/${i + 1}`),
    );
    assert.equal((await current(2, "", "ม.6/2", 6)).items.length, 0);
    assert.equal((await current(2, "", "ม.6/2", 6)).total, 5);
    const search = await current(1, room.items[0].student_code, "ม.6/2", 6);
    assert.equal(search.total, 1);
    assert.deepEqual(search.classrooms, room.classrooms);
    assert.equal((await current(1, "", "ม.6/2", 1)).total, 0);
    assert.equal((await current(1, "", "ม.6/99", 6)).total, 0);
  } finally {
    await db.close();
  }
});
