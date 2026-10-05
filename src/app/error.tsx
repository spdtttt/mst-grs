"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 p-[30px] text-center">
      <h1 className="text-[29px] leading-normal font-[650] tracking-[-0.5px]">
        ไม่สามารถโหลดข้อมูลได้
      </h1>
      <p>กรุณาลองอีกครั้ง หากยังพบปัญหาโปรดติดต่อฝ่ายวัดผล</p>
      <button
        className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] rounded-lg border border-transparent px-[18px] py-[11px] font-[550] whitespace-nowrap bg-brand text-white shadow-[0_3px_6px_#713cd112] enabled:hover:bg-[#602cbc] enabled:hover:shadow-[0_3px_12px_#713cd126]"
        onClick={reset}
      >
        ลองอีกครั้ง
      </button>
      <a
        className="focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3"
        href="/"
      >
        กลับหน้าเข้าสู่ระบบ
      </a>
    </main>
  );
}
