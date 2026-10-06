/** Resumable Auth deletion. Storage and Auth are external services, so they
 * must never run inside a database transaction or an automatically retried POST. */
export type ResetOperation = {
  token?: string;
  stage: "files" | "deleting" | "complete";
  account_revision: number;
};
export type ResetFile = {
  bucket: string;
  name: string;
  version: string | null;
  metadata: Record<string, unknown> | null;
};
export type ResetResult = {
  success?: boolean;
  pending?: boolean;
  account_revision?: number;
  error?: string;
};
export type StaffAuthResetStore = {
  files(token: string): Promise<ResetFile[]>;
  preserve(file: ResetFile): Promise<void>;
  claimDelete(token: string): Promise<boolean>;
  deleteAuth(): Promise<void>;
  retryAfterRejectedDelete(token: string): Promise<void>;
  authExists(): Promise<boolean>;
  finish(token: string): Promise<{ account_revision: number }>;
};
export class RejectedAuthDelete extends Error {}

export async function completeStaffAuthReset(
  operation: ResetOperation,
  store: StaffAuthResetStore,
): Promise<ResetResult> {
  if (operation.stage === "complete")
    return { success: true, account_revision: operation.account_revision };
  if (!operation.token) throw new Error("Missing reset reservation");
  const token = operation.token;
  if (operation.stage === "files") {
    // One bounded batch per request, at most four server-side copies in flight.
    // Ownership is the durable checkpoint: already preserved objects disappear
    // from the next inventory. Never download whole attachments into Next.js.
    const files = await store.files(token);
    for (let offset = 0; offset < files.length; offset += 4) {
      const outcomes = await Promise.allSettled(
        files.slice(offset, offset + 4).map((file) => store.preserve(file)),
      );
      const failed = outcomes.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    const remaining = await store.files(token);
    if (
      remaining.some((file) =>
        files.some(
          (previous) =>
            previous.bucket === file.bucket && previous.name === file.name,
        ),
      )
    )
      throw new Error("Storage ownership change could not be verified");
    if (remaining.length)
      return { pending: true, account_revision: operation.account_revision };
    if (await store.claimDelete(token)) {
      // A timeout is ambiguous: inspect Auth, but never issue a second delete
      // that might arrive after re-registration using this same profile ID.
      try {
        await store.deleteAuth();
      } catch (error) {
        if (error instanceof RejectedAuthDelete && (await store.authExists())) {
          await store.retryAfterRejectedDelete(token);
          return {
            error:
              "บริการ Auth ปฏิเสธการรีเซ็ต ข้อมูลและไฟล์ยังอยู่ กรุณาโหลดรายชื่อใหม่แล้วลองอีกครั้ง",
            account_revision: operation.account_revision,
          };
        }
        // Network/5xx errors remain ambiguous; reconcile without repeating POST.
      }
    }
  }
  if (await store.authExists()) {
    return {
      error:
        "ยังยืนยันการลบ Auth ไม่ได้ บัญชีถูกระงับไว้และข้อมูลยังอยู่ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบ",
      account_revision: operation.account_revision,
    };
  }
  const finished = await store.finish(token);
  return { success: true, account_revision: finished.account_revision };
}
