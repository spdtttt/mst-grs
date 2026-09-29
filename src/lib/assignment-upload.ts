import type { AssignmentUpload } from "./assignment-files";

export async function uploadAssignmentFile(
  file: File,
  target: AssignmentUpload,
  onProgress: (uploaded: number) => void,
) {
  const { Upload } = await import("tus-js-client");
  const endpoint = new URL("/storage/v1/upload/resumable", process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (endpoint.hostname.endsWith(".supabase.co")) {
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: endpoint.href,
      headers: { "x-signature": target.token },
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
        const status = "originalResponse" in error ? error.originalResponse?.getStatus() : undefined;
        reject(new Error(status === 413
          ? "ไฟล์มีขนาดเกินเพดานที่ตั้งไว้ใน Supabase Storage กรุณาติดต่อผู้ดูแลเพื่อปรับ Storage Settings"
          : status === 401 || status === 403
            ? "สิทธิ์อัปโหลดหมดอายุหรือไม่อนุญาต กรุณาเข้าสู่ระบบใหม่และลองอีกครั้ง"
            : "อัปโหลดไฟล์ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและลองอีกครั้ง"));
      },
    });
    upload.start();
  });
}
