import { z } from "zod";

// Match admin_student_import_summary's per-request limit. A workbook may have
// many sheets; its combined row count is not the size of one RPC request.
export const STUDENT_PREVIEW_BATCH_SIZE = 2000;
const summarySchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type StudentImportSummary = z.infer<typeof summarySchema>;
type PreviewResult = {
  data?: StudentImportSummary;
  error?: string;
  cancelled?: boolean;
};

export async function summarizeStudentImport(
  codes: string[],
  load: (
    batch: string[],
  ) => Promise<{ data?: StudentImportSummary; error?: string }>,
  canContinue: () => boolean = () => true,
): Promise<PreviewResult> {
  if (!codes.length || new Set(codes).size !== codes.length)
    return { error: "ไม่พบรหัสนักเรียนหรือมีรหัสซ้ำในรายการ" };
  const total: StudentImportSummary = { created: 0, updated: 0, archived: 0 };
  for (
    let offset = 0;
    offset < codes.length;
    offset += STUDENT_PREVIEW_BATCH_SIZE
  ) {
    if (!canContinue()) return { cancelled: true };
    const batch = codes.slice(offset, offset + STUDENT_PREVIEW_BATCH_SIZE);
    const result = await load(batch);
    if (!canContinue()) return { cancelled: true };
    if (result.error) return { error: result.error };
    const parsed = summarySchema.safeParse(result.data);
    if (
      !parsed.success ||
      parsed.data.created + parsed.data.updated !== batch.length ||
      parsed.data.archived > parsed.data.updated
    )
      return { error: "สรุปจำนวนบัญชีไม่ครบ กรุณาลองตรวจสอบใหม่" };
    total.created += parsed.data.created;
    total.updated += parsed.data.updated;
    total.archived += parsed.data.archived;
  }
  return { data: total };
}
