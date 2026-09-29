import type { AssignmentUpload } from "./assignment-files";

export function assignmentUploadEndpoint(projectUrl: string) {
  const endpoint = new URL("/storage/v1/upload/resumable/sign", projectUrl);
  if (endpoint.hostname.endsWith(".supabase.co") && !endpoint.hostname.endsWith(".storage.supabase.co")) {
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return endpoint.href;
}

export function assignmentUploadError(status: number | undefined, body: string) {
  let code = "";
  try {
    const data = JSON.parse(body);
    code = String(data.code ?? data.error ?? "");
  } catch { /* Some Storage errors are plain text. */ }
  if (status === 413 || /EntityTooLarge|PayloadTooLarge|exceed.*size|too large|maximum.*size/i.test(body))
    return "ไฟล์มีขนาดเกินเพดานที่ตั้งไว้ใน Supabase Storage กรุณาติดต่อผู้ดูแลเพื่อปรับ Storage Settings";
  if (status === 401 || status === 403 || /InvalidJWT|InvalidSignature|invalid_compact_jws|Invalid Compact JWS|expired/i.test(body))
    return "สิทธิ์อัปโหลดไม่ถูกต้องหรือหมดอายุ กรุณาโหลดหน้าใหม่และลองอีกครั้ง";
  if (/InvalidMimeType|mime.*not supported/i.test(body))
    return "Storage ไม่อนุญาตชนิดไฟล์นี้ กรุณาตรวจสอบชนิดไฟล์ที่รองรับ";
  // Show only a safe error code, never a response that may contain signed URLs.
  const detail = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(code) ? `: ${code}` : "";
  return status
    ? `Storage ปฏิเสธการอัปโหลด (HTTP ${status}${detail}) กรุณาแจ้งรหัสนี้แก่ผู้ดูแล`
    : "อัปโหลดไฟล์ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและลองอีกครั้ง";
}

export async function uploadAssignmentFile(
  file: File,
  target: AssignmentUpload,
  onProgress: (uploaded: number) => void,
) {
  const { Upload } = await import("tus-js-client");
  const endpoint = assignmentUploadEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        "x-signature": target.token,
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      // Do not persist signed upload URLs on a shared device.
      storeFingerprintForResuming: false,
      metadata: {
        bucketName: "assignment-files",
        objectName: target.storage_path,
        contentType: target.mime_type,
        cacheControl: "3600",
      },
      onProgress,
      onSuccess: () => resolve(),
      onError: (error) => {
        const response = "originalResponse" in error ? error.originalResponse : undefined;
        reject(new Error(assignmentUploadError(response?.getStatus(), response?.getBody() ?? "")));
      },
    });
    upload.start();
  });
}
