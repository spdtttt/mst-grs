import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด</span>
      <div className="mx-auto max-w-6xl px-6 py-9 max-md:px-4 max-md:py-6">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6 max-lg:grid-cols-1">
          <div className="flex flex-col gap-6">
            {[0, 1].map((i) => (
              <section key={i} className="border border-line bg-white p-6 shadow-card max-md:p-5">
                <Skeleton className="mb-5 h-6 w-48" />
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </section>
            ))}
          </div>
          <section className="h-fit border border-line bg-white p-6 shadow-card max-md:p-5">
            <Skeleton className="mb-5 h-6 w-36" />
            <div className="flex flex-col gap-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
