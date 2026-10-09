import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteAuthUserAfterRoleDelete } from "../src/lib/account-auth-cleanup";

const client = (run: (id: string) => Promise<{ error: { status?: number; code?: string } | null }>) =>
  ({ auth: { admin: { deleteUser: run } } });

test("auth cleanup succeeds, treats a missing user as done, and never throws", async () => {
  const seen: string[] = [];
  assert.deepEqual(
    await deleteAuthUserAfterRoleDelete(client(async (id) => (seen.push(id), { error: null })), "u1"),
    { ok: true },
  );
  assert.deepEqual(seen, ["u1"]);
  assert.deepEqual(
    await deleteAuthUserAfterRoleDelete(client(async () => ({ error: { status: 404 } })), "u1"),
    { ok: true },
  );
  assert.deepEqual(
    await deleteAuthUserAfterRoleDelete(client(async () => ({ error: { code: "user_not_found" } })), "u1"),
    { ok: true },
  );
  assert.deepEqual(
    await deleteAuthUserAfterRoleDelete(client(async () => ({ error: { status: 500 } })), "u1"),
    { ok: false },
  );
  assert.deepEqual(
    await deleteAuthUserAfterRoleDelete(client(async () => { throw new Error("network"); }), "u1"),
    { ok: false },
  );
});
