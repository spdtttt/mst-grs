import { z } from "zod";

export const assignmentFileTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  txt: "text/plain",
};

export function assignmentFileMimeType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(assignmentFileTypes, extension)
    ? assignmentFileTypes[extension]
    : undefined;
}

export function validateAssignmentFiles(
  files: readonly { name: string; size: number }[],
): string {
  if (files.some((file) => !Number.isSafeInteger(file.size) || file.size <= 0))
    return "ไฟล์แนบต้องไม่เป็นไฟล์ว่าง";
  if (files.some((file) => !assignmentFileMimeType(file.name)))
    return "รองรับเฉพาะ PDF, Word, Excel, PowerPoint, JPG, PNG และ TXT";
  return "";
}

export const assignmentFileSchema = z.object({
  name: z.string().min(1).max(180),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const uploadedAssignmentFileSchema = assignmentFileSchema.extend({
  storage_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]+$/),
});

export type AssignmentUpload = z.infer<typeof uploadedAssignmentFileSchema> & {
  token: string;
  mime_type: string;
};

// Only small text fields and file metadata go through a Server Action.
export function assignmentSubmissionForm(form: FormData) {
  const result = new FormData();
  for (const field of ["expected_status", "assignment", "due_at"]) {
    result.set(field, String(form.get(field) ?? ""));
  }
  return result;
}

export function parseAssignmentDetails(form: FormData) {
  const expectedStatus = String(form.get("expected_status") ?? "");
  if (!["requested", "assigned", "submitted"].includes(expectedStatus))
    return { error: "ข้อมูลภาระงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่" } as const;
  const assignment = String(form.get("assignment") ?? "").trim();
  const due = String(form.get("due_at") ?? "");
  const dueAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)
    ? new Date(`${due}+07:00`)
    : null;
  if (assignment.length < 10 || assignment.length > 10000 || !dueAt ||
    !Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now())
    return { error: "กรุณาระบุรายละเอียดงานอย่างน้อย 10 ตัวอักษร และกำหนดส่งในอนาคต" } as const;
  return { expectedStatus, assignment, dueAt } as const;
}
