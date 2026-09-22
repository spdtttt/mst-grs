"use client";

import { Loader2 } from "lucide-react";

export default function LogoutOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
      role="status"
      aria-live="polite"
      aria-modal="true"
      aria-label="กำลังออกจากระบบ"
    >
      <div className="flex w-full max-w-[340px] flex-col items-center rounded-2xl border border-line bg-white/95 p-7 text-center shadow-[0_16px_50px_rgba(49,32,67,0.22)] backdrop-blur-md">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand shadow-[inset_0_2px_4px_rgba(113,60,209,0.06)]">
          <Loader2 className="size-7 animate-spin text-brand" />
        </div>
        <h3 className="font-thai text-lg font-semibold tracking-tight text-ink">
          กำลังออกจากระบบ
        </h3>
        <p className="font-thai mt-1.5 text-xs leading-relaxed text-secondary sm:text-sm">
          กรุณารอสักครู่ ระบบกำลังนำท่านกลับสู่หน้าหลัก...
        </p>
        <div className="mt-5 h-1 w-28 overflow-hidden rounded-full bg-brand-soft">
          <div className="h-full w-full origin-left animate-pulse rounded-full bg-brand" />
        </div>
      </div>
    </div>
  );
}
