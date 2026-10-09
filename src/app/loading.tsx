import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main
      className="min-h-screen w-full bg-gradient-to-b from-white to-[#F1E7FC]"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">กำลังโหลด</span>
      <div className="border-b border-[#E4D6F7] bg-white p-4 shadow-sm md:px-10 md:py-7.5">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center gap-3 md:flex-row md:gap-7">
          <Skeleton className="size-[70px] rounded-full md:size-[90px]" />
          <div className="flex flex-col items-center gap-3 md:items-start">
            <Skeleton className="h-7 w-64 max-w-full md:h-9 md:w-96" />
            <Skeleton className="h-8 w-48 max-w-full md:h-10 md:w-72" />
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8 sm:px-7">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-4/5" />
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </main>
  );
}
