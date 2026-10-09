import { twMerge } from "tailwind-merge";

// A span so it is valid inside <p>, <span>, <td> and flex rows alike.
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={twMerge(
        "block animate-pulse rounded-md bg-[#e9e2ee] motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function SkeletonRows({ rows, className }: { rows: number; className?: string }) {
  return Array.from({ length: rows }, (_, i) => (
    <div key={i} className={twMerge("flex items-center gap-4 py-3.5", className)}>
      <Skeleton className="h-4 w-8" />
      <Skeleton className="h-4 flex-[2]" />
      <Skeleton className="h-4 flex-1 max-desk:hidden" />
      <Skeleton className="h-4 flex-1 max-desk:hidden" />
      <Skeleton className="h-6 w-24 rounded-full" />
    </div>
  ));
}

// Placeholder <tr>s for a table body; keeps the real header and column widths.
export function SkeletonTableRows({
  columns,
  rows = 6,
  label = "กำลังโหลดรายชื่อ",
}: {
  columns: number;
  rows?: number;
  label?: string;
}) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} className="border-t border-line">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column} className="px-4 py-4">
          {row === 0 && column === 0 && <span className="sr-only" role="status">{label}</span>}
          <Skeleton className={column === columns - 1 ? "h-8 w-24" : column === 1 ? "h-4 w-4/5" : "h-4 w-3/5"} />
        </td>
      ))}
    </tr>
  ));
}

export function SkeletonCard({ rows = 6, label = "กำลังโหลด" }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="rounded-xl border border-line bg-white p-6 shadow-card">
      <span className="sr-only">{label}</span>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <Skeleton className="h-9 w-56 max-w-[45%]" />
      </div>
      <div className="divide-y divide-line">
        <SkeletonRows rows={rows} />
      </div>
    </div>
  );
}
