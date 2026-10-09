import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("legacy term trigger repair restores completion and preserves existing term data", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table site_schedule(id int primary key);
      insert into site_schedule values (1);
      create table grade_records(id int primary key, status text, completed_academic_year int, completed_semester int);
      insert into grade_records values (1, 'teacher_approved', null, null), (2, 'completed', 2569, 1);
      create function stamp_completion_term() returns trigger language plpgsql as $$
      begin
        if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
          select current_academic_year, current_semester into new.completed_academic_year, new.completed_semester
          from site_schedule where id = 1;
        end if;
        return new;
      end; $$;
      create trigger stamp_completion_term before insert or update on grade_records
      for each row execute function stamp_completion_term();
    `);
    await assert.rejects(db.exec("update grade_records set status = 'completed' where id = 1"), /current_academic_year/);
    const repair = readFileSync("tests/fixtures/migration-history/018_remove_legacy_completion_trigger.sql", "utf8");
    await db.exec(repair);
    await db.exec(repair);
    await db.exec("update grade_records set status = 'completed' where id = 1");
    assert.deepEqual((await db.query("select * from grade_records order by id")).rows, [
      { id: 1, status: "completed", completed_academic_year: null, completed_semester: null },
      { id: 2, status: "completed", completed_academic_year: 2569, completed_semester: 1 },
    ]);
  } finally { await db.close(); }
});
