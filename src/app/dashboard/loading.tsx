import { Skeleton, SkeletonRows } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด</span>
      <aside className="fixed inset-y-0 left-0 hidden w-[250px] flex-col gap-3 bg-gradient-to-b from-sidebar-from to-sidebar-to px-4 py-6 desk:flex">
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="size-10 rounded-full bg-white/20" />
          <Skeleton className="h-4 w-28 bg-white/20" />
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg bg-white/15" />
        ))}
      </aside>
      <div className="desk:pl-[250px]">
        <header className="flex items-center justify-between border-b border-line bg-white px-[35px] py-4 max-desk:px-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </header>
        <main className="flex flex-col gap-6 px-[35px] py-8 max-desk:px-4 max-desk:py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-9 w-64 max-w-full" />
            <div className="flex gap-3">
              <Skeleton className="h-10 w-[174px] rounded-none" />
              <Skeleton className="h-10 w-[154px] rounded-none" />
            </div>
          </div>
          <section className="rounded-[14px] border border-line bg-white p-6 shadow-card max-desk:p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-9 w-56 max-w-[45%]" />
            </div>
            <div className="divide-y divide-line">
              <SkeletonRows rows={8} />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
