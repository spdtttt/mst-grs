import type { StudentInput, StudentSaveResult } from "./students";

export const STUDENT_BATCH_SIZE = 50;
export const STUDENT_CONCURRENCY = 5;
export type StudentBatchResult = {
  results: StudentSaveResult[];
  cancelled: boolean;
  error?: string;
};

/** Fixed waves ensure cancellation leaves at most five started accounts to finish. */
export async function runStudentBatch(
  rows: StudentInput[],
  process: (student: StudentInput) => Promise<StudentSaveResult>,
  canContinue: () => Promise<boolean>,
): Promise<StudentBatchResult> {
  const results: StudentSaveResult[] = [];
  for (let offset = 0; offset < rows.length; offset += STUDENT_CONCURRENCY) {
    try {
      if (!(await canContinue())) return { results, cancelled: true };
    } catch {
      return {
        results,
        cancelled: false,
        error:
          "ไม่สามารถยืนยันสถานะการนำเข้าได้ หยุดเริ่มรายการใหม่แล้ว กรุณาตรวจสอบการเชื่อมต่อ",
      };
    }
    const wave = await Promise.all(
      rows.slice(offset, offset + STUDENT_CONCURRENCY).map(async (student) => {
        try {
          return await process(student);
        } catch {
          return {
            student_code: student.student_code,
            status: "failed" as const,
            message: "บันทึกบัญชีไม่สำเร็จ กรุณาตรวจสอบสถานะก่อนลองใหม่",
          };
        }
      }),
    );
    results.push(...wave);
  }
  return { results, cancelled: false };
}

export function sameOrigin(requestUrl: string, origin: string | null) {
  if (!origin) return false;
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}
