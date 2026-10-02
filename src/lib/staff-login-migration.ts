import { loginEmail } from "./identity";

type StaffAccount = {
  role: "teacher" | "academic" | "admin";
  identifier: string;
  legacy_identifier?: string;
  password: string;
};
export type StaffMigrationStore = {
  listUsers(): Promise<{ id: string; email?: string }[]>;
  profileRole(id: string): Promise<string | null>;
  updateUser(id: string, email: string, password: string): Promise<void>;
};

/** Validate every mapping before changing any login; preserve profile IDs and roles. */
export async function migrateStaffLogins(
  accounts: StaffAccount[],
  store: StaffMigrationStore,
  secret: string,
) {
  const users = await store.listUsers();
  const byEmail = new Map(
    users.filter((user) => user.email).map((user) => [user.email!, user]),
  );
  const seenIds = new Set<string>();
  const plan: { id: string; email: string; password: string }[] = [];
  for (const [index, account] of accounts.entries()) {
    const oldEmail = loginEmail(
      `${account.role}:${account.legacy_identifier || account.identifier}`,
      secret,
    );
    const email = loginEmail(`${account.role}:${account.identifier}`, secret);
    const user = byEmail.get(oldEmail);
    if (!user || (await store.profileRole(user.id)) !== account.role)
      throw new Error(
        `Row ${index + 2}: existing Auth and profile must match the requested role. No logins changed.`,
      );
    if (
      seenIds.has(user.id) ||
      (byEmail.has(email) && byEmail.get(email)!.id !== user.id) ||
      plan.some((item) => item.email === email)
    )
      throw new Error(
        `Row ${index + 2}: duplicate or conflicting login mapping. No logins changed.`,
      );
    seenIds.add(user.id);
    plan.push({ id: user.id, email, password: account.password });
  }
  for (const [index, item] of plan.entries()) {
    try {
      await store.updateUser(item.id, item.email, item.password);
    } catch {
      throw new Error(
        `Row ${index + 2}: login update could not be confirmed. ${index} previous updates completed; inspect Auth before retrying.`,
      );
    }
  }
  return plan.length;
}
