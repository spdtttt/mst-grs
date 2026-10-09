type AuthAdmin = {
  auth: {
    admin: {
      deleteUser(id: string): Promise<{
        error: { status?: number; code?: string } | null;
      }>;
    };
  };
};

// The profile row is already gone when this runs, so a failure must be
// reported rather than thrown; the caller tells the administrator.
export async function deleteAuthUserAfterRoleDelete(
  service: AuthAdmin,
  id: string,
): Promise<{ ok: boolean }> {
  try {
    const { error } = await service.auth.admin.deleteUser(id);
    if (!error || error.status === 404 || error.code === "user_not_found")
      return { ok: true };
  } catch {
    // fall through
  }
  return { ok: false };
}
