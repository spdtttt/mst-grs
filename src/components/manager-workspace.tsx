"use client";

import {
  startTransition,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  LogOut,
  Menu,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { signOut } from "@/app/actions";
import { loadManagerStudents } from "@/app/manager-actions";
import {
  roles,
  statuses,
  type GradeRecord,
  type Profile,
  type Role,
} from "@/lib/domain";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useSwipeSidebar } from "@/lib/use-swipe-sidebar";
import {
  managerStudentPageSize,
  outstandingStatuses,
  summarizeManagerStudents,
  type ManagerStats,
  type ManagerStudentList,
} from "@/lib/manager-stats";

const BarChart = dynamic(
  () => import("@mui/x-charts/BarChart").then((module) => module.BarChart),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-[360px] items-center justify-center rounded-xl bg-[#faf8fd] text-sm text-[#8c7e99]"
      >
        กำลังโหลดกราฟ…
      </div>
    ),
  },
);

const PieChart = dynamic(
  () => import("@mui/x-charts/PieChart").then((module) => module.PieChart),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex size-[260px] items-center justify-center rounded-full bg-[#faf8fd] text-sm text-[#8c7e99]"
      >
        กำลังโหลดกราฟ…
      </div>
    ),
  },
);

type ManagerView = "dashboard" | "incomplete" | "completed";

const pages = [
  {
    id: "dashboard",
    label: "Dashboard สถิติ",
    icon: BarChart3,
  },
  {
    id: "incomplete",
    label: "รายชื่อนักเรียนที่ยังไม่เรียบร้อย",
    title: "รายชื่อนักเรียนที่ยังแก้ไขไม่เสร็จสิ้น",
    icon: ClipboardList,
  },
  {
    id: "completed",
    label: "รายชื่อนักเรียนที่เรียบร้อยแล้ว",
    title: "รายชื่อนักเรียนที่แก้ไขเสร็จสิ้นแล้ว",
    icon: CheckCircle2,
  },
] as const;

export default function ManagerWorkspace({
  profile,
  stats,
  demo = false,
  demoRecords,
  onRoleChange,
}: {
  profile: Profile;
  stats: ManagerStats | null;
  demo?: boolean;
  demoRecords?: GradeRecord[];
  onRoleChange?: (role: Role) => void;
}) {
  const [view, setView] = useState<ManagerView>("dashboard");
  const [pending, startTransition] = useTransition();
  const {
    open: mobileMenuOpen,
    setOpen: setMobileMenuOpen,
    phase,
    visible,
    asideRef,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onTransitionEnd,
  } = useSwipeSidebar(250);
  const currentPage = pages.find((page) => page.id === view) ?? pages[0];
  const title = "title" in currentPage ? currentPage.title : currentPage.label;

  function logout() {
    if (demo) {
      window.location.assign("/");
      return;
    }
    startTransition(async () => {
      await signOut();
    });
  }

  return (
    <div
      className="min-h-screen touch-auto bg-[#f8f6fc] text-[#372d45]"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <button
        type="button"
        aria-label="ปิดเมนู"
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
        onClick={() => setMobileMenuOpen(false)}
        className={`fixed inset-0 z-30 bg-[#24163666] transition-opacity duration-300 motion-reduce:transition-none desk:hidden ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        id="manager-aside"
        ref={asideRef}
        onTransitionEnd={onTransitionEnd}
        className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col border-r border-[#e8e0f1] bg-white px-4 py-6 duration-300 ease-out motion-reduce:transition-none desk:translate-x-0 ${phase === "idle" ? (mobileMenuOpen ? "translate-x-0 transition-transform" : "-translate-x-full transition-transform") : `translate-x-[var(--sidebar-offset)] ${phase === "dragging" ? "transition-none" : "transition-transform"}`}`}
      >
        <div className="flex items-start justify-between gap-1">
          <a
            href={demo ? "/demo" : "/dashboard"}
            className="focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 flex min-w-0 items-center gap-2 text-2xl leading-[1.2] font-[650] tracking-[-0.5px] [&_b]:font-normal [&_b]:text-brand [&_small]:mt-[7px] [&_small]:block [&_small]:text-[8px] [&_small]:font-medium [&_small]:tracking-[1.4px] [&_small]:text-[#9a90ac] max-wide:text-[21px] max-wide:[&_small]:text-[7px] max-desk:text-[20px]"
          >
            <Image
              src="https://upload.wikimedia.org/wikipedia/commons/4/44/MuangST2020.jpg"
              alt="โรงเรียนเมืองสุราษฎร์ธานี"
              width={45}
              height={45}
              className="shrink-0 ring-2 ring-white shadow-sm"
            />
            <span className="min-w-0">
              MST <b>GRS</b>
              <small className="text-xs whitespace-nowrap">
                GRADE RECOVERY SYSTEM
              </small>
            </span>
          </a>
          <button
            type="button"
            aria-label="ปิดเมนู"
            onClick={() => setMobileMenuOpen(false)}
            className="ml-auto shrink-0 rounded-lg p-1 text-[#7d6e8e] desk:hidden"
          >
            <X size={20} />
          </button>
        </div>
        <div className="mx-2.5 mt-5 mb-[30px] border-b border-line pb-[25px] text-sm text-secondary">
          ระบบแก้ไขผลการเรียน
        </div>
        <nav aria-label="เมนูผู้บริหาร" className="grid gap-1">
          {pages.map((page) => {
            const Icon = page.icon;
            return (
              <button
                key={page.id}
                type="button"
                aria-current={view === page.id ? "page" : undefined}
                onClick={() => {
                  setView(page.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8455c8] ${view === page.id ? "bg-[#f1eafb] font-semibold text-[#633ba1]" : "text-[#756782] hover:bg-[#faf7fe]"}`}
              >
                <Icon size={19} aria-hidden="true" />
                {page.label}
              </button>
            );
          })}
        </nav>
        {demo && onRoleChange && (
          <label className="mt-8 grid gap-2 border-t border-[#eee8f5] px-3 pt-5 text-xs text-[#796b88]">
            ทดลองบทบาท
            <select
              value="manager"
              onChange={(event) => onRoleChange(event.target.value as Role)}
              className="rounded-lg border border-[#ded3ec] bg-white px-3 py-2 text-sm"
            >
              {(Object.keys(roles) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {roles[role]}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-auto border-t border-[#eee8f5] pt-4">
          <div className="px-3 py-2">
            <strong className="block truncate text-sm font-semibold">
              {profile.full_name}
            </strong>
            <span className="text-xs text-[#8b7e99]">{roles.manager}</span>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={logout}
            className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#756782] hover:bg-[#faf7fe] disabled:opacity-50"
          >
            <LogOut size={17} aria-hidden="true" />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      <div className="min-h-screen desk:ml-[250px]">
        <header className="flex h-[76px] items-center justify-between gap-4 border-b border-[#e8e0f1] bg-white px-5 desk:px-9">
          <button
            type="button"
            aria-label="เปิดเมนู"
            aria-controls="manager-aside"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-[#685779] desk:hidden"
          >
            <Menu size={22} />
          </button>
          <span className="text-sm font-medium text-[#6e5b83]">{title}</span>
        </header>
        {demo && (
          <div className="border-b border-[#f1e4c6] bg-[#fff8e9] px-5 py-2 text-xs text-[#846527] desk:px-9">
            โหมดทดลอง · ข้อมูลสมมติ ไม่บันทึกลงฐานข้อมูล
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-5 py-8 desk:px-9 desk:py-10">
          <div className="mb-8">
            <span className="text-xs font-semibold tracking-[0.18em] text-[#9467c3]">
              MANAGEMENT
            </span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#3e2e52] desk:text-3xl">
              {title}
            </h1>
          </div>
          {view === "dashboard" ? (
            stats ? (
              <ManagerDashboardStats stats={stats} />
            ) : (
              <section
                role="alert"
                className="rounded-2xl border border-[#ead7db] bg-white px-6 py-8 text-sm text-[#9b485b] shadow-[0_8px_24px_#40206f08]"
              >
                ยังไม่สามารถโหลดสถิติได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูล
              </section>
            )
          ) : (
            <ManagerStudentsView
              key={view}
              completed={view === "completed"}
              demoRecords={demo ? (demoRecords ?? []) : null}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ManagerStudentsView({
  completed,
  demoRecords,
}: {
  completed: boolean;
  demoRecords: GradeRecord[] | null;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ManagerStudentList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const format = (value: number) => value.toLocaleString("th-TH");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (demoRecords) {
      setResult(summarizeManagerStudents(demoRecords, completed, query, page));
      setLoading(false);
    } else {
      startTransition(async () => {
        try {
          const response = await loadManagerStudents({
            completed,
            page,
            query,
          });
          if (!active) return;
          setResult(response.data);
          setError(response.error ?? "");
        } catch {
          if (!active) return;
          setResult(null);
          setError("ไม่สามารถโหลดรายชื่อนักเรียนได้ กรุณาลองอีกครั้ง");
        } finally {
          if (active) setLoading(false);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [completed, demoRecords, page, query, refresh]);

  const totalPages = Math.max(
    1,
    Math.ceil((result?.total ?? 0) / managerStudentPageSize),
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e9e1f2] bg-white shadow-[0_8px_24px_#40206f08]">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-6 pb-5 desk:px-7">
        <div>
          <h2 className="text-lg font-semibold text-[#3d2d52]">
            {completed
              ? "นักเรียนที่แก้ไขผลการเรียนเรียบร้อยแล้ว"
              : "นักเรียนที่ยังมีผลการเรียนคงค้าง"}
          </h2>
          <p className="mt-1 text-sm text-[#8c7e99]">
            {completed
              ? "แก้ไขครบทุกวิชาและฝ่ายวิชาการอนุมัติแล้ว"
              : "มีอย่างน้อยหนึ่งวิชาที่ยังดำเนินการไม่เสร็จ"}
          </p>
        </div>
        <span className="rounded-full bg-[#f3ecfb] px-3 py-1.5 text-sm font-medium text-[#6b449f]">
          {result ? `${format(result.total)} คน` : "กำลังโหลด"}
        </span>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setResult(null);
          setPage(1);
          setQuery(input.trim());
          setRefresh((value) => value + 1);
        }}
        className="flex flex-wrap items-end gap-2 border-t border-[#f0ebf5] px-5 py-4 desk:px-7"
      >
        <label className="min-w-[220px] flex-1 text-xs font-medium text-[#756782]">
          ค้นหานักเรียน
          <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-[#e5dced] bg-white px-3 focus-within:border-[#9d72cf] focus-within:ring-2 focus-within:ring-[#9d72cf33]">
            <Search
              size={17}
              className="shrink-0 text-[#9a8aa9]"
              aria-hidden="true"
            />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={80}
              placeholder="ชื่อ เลขประจำตัว หรือชั้น/ห้อง"
              className="min-w-0 flex-1 py-2.5 text-sm text-[#3d2d52] outline-none placeholder:text-[#a89caf]"
            />
          </span>
        </label>
        <button
          type="submit"
          className="cursor-pointer rounded-lg bg-yellow-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-yellow-700 duration-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
        >
          ค้นหา
        </button>
        <button
          type="button"
          aria-label="โหลดรายชื่อล่าสุด"
          title="โหลดรายชื่อล่าสุด"
          onClick={() => {
            setResult(null);
            setRefresh((value) => value + 1);
          }}
          className="grid size-10 cursor-pointer place-items-center rounded-lg border border-[#e5dced] text-[#765a9b] transition-colors hover:bg-[#f7f1fd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </form>

      {loading ? (
        <p
          role="status"
          className="px-5 py-16 text-center text-sm text-[#8c7e99]"
        >
          กำลังโหลดรายชื่อนักเรียน…
        </p>
      ) : error ? (
        <p
          role="alert"
          className="mx-5 my-8 rounded-xl bg-[#fff4f4] px-5 py-8 text-center text-sm text-[#a35b68]"
        >
          {error}
        </p>
      ) : result && result.total === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-[#8c7e99]">
          {query
            ? "ไม่พบนักเรียนที่ตรงกับคำค้นหา"
            : "ยังไม่มีนักเรียนในรายการนี้"}
        </p>
      ) : result ? (
        <>
          <p className="px-5 pb-2 text-xs text-[#9486a2] desk:hidden">
            <ArrowLeftRight
              size={14}
              className="mr-1 inline"
              aria-hidden="true"
            />
            เลื่อนตารางซ้าย–ขวาเพื่อดูข้อมูลทั้งหมด
          </p>
          <div
            data-swipe-ignore
            className="touch-auto overflow-x-auto overscroll-x-contain"
          >
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <caption className="sr-only">
                {completed
                  ? "รายชื่อนักเรียนที่แก้ไขเรียบร้อยแล้ว"
                  : "รายชื่อนักเรียนที่ยังไม่เรียบร้อย"}
              </caption>
              <thead className="bg-[#f8f5fc] text-xs font-semibold text-[#6d5b80]">
                <tr>
                  <th scope="col" className="px-5 py-3.5 desk:pl-7">
                    นักเรียน
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    ชั้น/ห้อง
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    ปี/ภาคเรียนล่าสุด
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    รายการทั้งหมด
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    ยังคงค้าง
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-right desk:pr-7">
                    เรียบร้อยแล้ว
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ebf5]">
                {result.items.map((student) => (
                  <tr key={student.student_code} className="hover:bg-[#fcfaff]">
                    <th
                      scope="row"
                      className="px-5 py-4 font-medium text-[#3d2d52] desk:pl-7"
                    >
                      <span className="block">{student.student_name}</span>
                      <span className="mt-1 block text-xs font-normal tabular-nums text-[#9587a3]">
                        เลขประจำตัว {student.student_code}
                      </span>
                    </th>
                    <td className="px-4 py-4 text-[#756782]">
                      {student.classroom}
                      <span className="mt-1 block text-xs text-[#9587a3]">
                        เลขที่ {student.roll_number}
                      </span>
                    </td>
                    <td className="px-4 py-4 tabular-nums text-[#756782]">
                      {student.academic_year} / {student.semester}
                    </td>
                    <td className="px-4 py-4 text-right font-medium tabular-nums text-[#5d4c70]">
                      {format(student.total_records)}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums text-[#8654c5]">
                      {format(student.incomplete_records)}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold tabular-nums text-[#32977c] desk:pr-7">
                      {format(student.completed_records)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0ebf5] px-5 py-4 text-xs text-[#8c7e99] desk:px-7">
            <span>
              แสดง {format((page - 1) * managerStudentPageSize + 1)}–
              {format(Math.min(page * managerStudentPageSize, result.total))}{" "}
              จาก {format(result.total)} คน
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="หน้าก่อนหน้า"
                disabled={page <= 1}
                onClick={() => {
                  setResult(null);
                  setPage((value) => value - 1);
                }}
                className="grid size-9 cursor-pointer place-items-center rounded-lg border border-[#e5dced] text-[#765a9b] hover:bg-[#f7f1fd] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
              <span className="min-w-16 text-center tabular-nums">
                {format(page)} / {format(totalPages)}
              </span>
              <button
                type="button"
                aria-label="หน้าถัดไป"
                disabled={page >= totalPages}
                onClick={() => {
                  setResult(null);
                  setPage((value) => value + 1);
                }}
                className="grid size-9 cursor-pointer place-items-center rounded-lg border border-[#e5dced] text-[#765a9b] hover:bg-[#f7f1fd] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ManagerMetric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | null;
  icon: ReactNode;
  tone: "purple" | "amber" | "green";
}) {
  return (
    <section className="rounded-2xl border border-[#e9e1f2] bg-white p-5 shadow-[0_8px_24px_#40206f08] desk:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium leading-6 text-[#756782]">
          {label}
        </h2>
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone === "green" ? "bg-[#e8f6f0] text-[#2c9379]" : tone === "amber" ? "bg-[#fff4df] text-[#b7832b]" : "bg-[#f1eafb] text-[#7849b9]"}`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 text-4xl font-semibold tracking-tight text-[#3d2d52] tabular-nums">
        {value === null ? "—" : value.toLocaleString("th-TH")}
        <span className="ml-2 text-sm font-normal text-[#9486a2]">คน</span>
      </p>
    </section>
  );
}

function ManagerDashboardStats({ stats }: { stats: ManagerStats }) {
  // Older database responses can be summed only when every student has a level.
  const completedStudents =
    stats.completed_students ??
    (stats.unclassified_students === 0
      ? stats.by_level.reduce((total, row) => total + row.completed_students, 0)
      : null);
  const incompleteStudents =
    stats.incomplete_students ??
    (completedStudents === null
      ? null
      : stats.total_students - completedStudents);
  const maxStudents = Math.max(
    1,
    ...stats.by_level.flatMap((row) => [
      row.completed_students,
      row.incomplete_students,
    ]),
  );
  const intervals = Math.min(4, Math.max(2, maxStudents));
  const tickStep = Math.max(1, Math.ceil(maxStudents / intervals));
  const axisMax = tickStep * intervals;
  const format = (count: number) => count.toLocaleString("th-TH");
  const statusCounts = stats.outstanding_by_status;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <ManagerMetric
          label="นักเรียนที่มีผลการเรียนคงค้างทั้งหมด"
          value={stats.total_students}
          icon={<ClipboardList size={21} aria-hidden="true" />}
          tone="purple"
        />
        <ManagerMetric
          label="นักเรียนที่ยังแก้ไขไม่เรียบร้อย"
          value={incompleteStudents}
          icon={<Clock3 size={21} aria-hidden="true" />}
          tone="amber"
        />
        <ManagerMetric
          label="นักเรียนที่แก้ไขเรียบร้อยแล้ว"
          value={completedStudents}
          icon={<CheckCircle2 size={21} aria-hidden="true" />}
          tone="green"
        />
      </div>

      <section className="mt-6 rounded-2xl border border-[#e9e1f2] bg-white px-4 py-6 shadow-[0_8px_24px_#40206f08] desk:px-7 desk:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#6e45a8]">
              <BarChart3 size={21} aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[#3d2d52]">
                สถิติจำนวนนักเรียนตามระดับชั้น
              </h2>
            </div>
            <p className="mt-1 text-sm text-[#8c7e99]">
              แผนภูมิแสดงจำนวนนักเรียนที่มีผลการเรียนคงค้างตามระดับชั้น
            </p>
          </div>
          <span className="rounded-full bg-[#f3ecfb] px-3 py-1.5 text-sm font-medium text-[#6b449f]">
            นักเรียนทั้งหมด {format(stats.total_students)} คน
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#746782]">
          <span className="inline-flex items-center gap-2">
            <span className="size-4 bg-[#44a98c]" />
            แก้ไขเรียบร้อยแล้ว
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-4 bg-[#8c5bd3]" />
            ยังแก้ไขไม่เรียบร้อย
          </span>
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-[#8e819a] desk:hidden">
          <ArrowLeftRight size={15} aria-hidden="true" />
          เลื่อนกราฟซ้าย–ขวาเพื่อดู ม.1–ม.6
        </p>

        <div
          data-swipe-ignore
          className="mt-5 touch-auto overflow-x-auto overscroll-x-contain pb-1"
        >
          <div className="min-w-[690px]">
            <BarChart
              height={360}
              borderRadius={6}
              hideLegend
              grid={{ horizontal: true }}
              margin={{ top: 24, right: 20, bottom: 12, left: 8 }}
              xAxis={[
                {
                  id: "grade-level",
                  scaleType: "band",
                  data: stats.by_level.map((row) => `ม.${row.level}`),
                  categoryGapRatio: 0.4,
                  barGapRatio: 0.2,
                  disableLine: true,
                  disableTicks: true,
                },
              ]}
              yAxis={[
                {
                  min: 0,
                  max: axisMax,
                  tickMinStep: 1,
                  tickNumber: intervals + 1,
                  label: "จำนวนนักเรียน (คน)",
                  width: 78,
                  disableLine: true,
                  disableTicks: true,
                  valueFormatter: (value: number) => format(value),
                },
              ]}
              series={[
                {
                  id: "completed",
                  data: stats.by_level.map((row) => row.completed_students),
                  label: "แก้ไขเรียบร้อยแล้ว",
                  color: "#44a98c",
                  barLabel: (item) => (item.value ? format(item.value) : ""),
                  barLabelPlacement: "outside",
                  valueFormatter: (value) => `${format(value ?? 0)} คน`,
                },
                {
                  id: "incomplete",
                  data: stats.by_level.map((row) => row.incomplete_students),
                  label: "ยังแก้ไขไม่เรียบร้อย",
                  color: "#8c5bd3",
                  barLabel: (item) => (item.value ? format(item.value) : ""),
                  barLabelPlacement: "outside",
                  valueFormatter: (value) => `${format(value ?? 0)} คน`,
                },
              ]}
              className="[&_.MuiChartsSurface-root]:touch-auto! [&_.MuiChartsAxis-tickLabel]:fill-[#877995]! [&_.MuiChartsAxis-tickLabel]:font-[inherit]! [&_.MuiChartsAxis-label]:fill-[#746782]! [&_.MuiChartsAxis-label]:font-[inherit]! [&_.MuiChartsGrid-line]:stroke-[#eae4f1]! [&_.MuiChartsGrid-line]:[stroke-dasharray:4_5] [&_.MuiBarChart-label]:fill-[#5d506d]! [&_.MuiBarChart-label]:font-[inherit]! [&_.MuiBarChart-label]:text-xs! [&_.MuiBarChart-label]:font-semibold!"
            />
          </div>
        </div>

        <p className="mt-3 border-t border-[#f0ebf5] pt-4 text-xs leading-6 text-[#8e819a]">
          นักเรียนหนึ่งคนนับเพียงครั้งเดียวตามระดับชั้นล่าสุด
          และถือว่าแก้ไขเรียบร้อยแล้วเมื่อทุกรายวิชาที่คงค้างเสร็จสิ้น
          {stats.unclassified_students > 0 &&
            ` · ไม่แสดง ${format(stats.unclassified_students)} คนที่ไม่มีข้อมูลระดับชั้น ม.1–ม.6`}
        </p>
        {stats.total_records === 0 && (
          <p className="mt-2 text-sm text-[#8e819a]">
            ยังไม่มีรายการผลการเรียนคงค้างในระบบ
          </p>
        )}
        <table className="sr-only">
          <caption>จำนวนนักเรียนตามระดับชั้นและสถานะการแก้ไข</caption>
          <thead>
            <tr>
              <th>ระดับชั้น</th>
              <th>แก้ไขเรียบร้อยแล้ว (คน)</th>
              <th>ยังแก้ไขไม่เรียบร้อย (คน)</th>
            </tr>
          </thead>
          <tbody>
            {stats.by_level.map((row) => (
              <tr key={row.level}>
                <th>ม.{row.level}</th>
                <td>{format(row.completed_students)}</td>
                <td>{format(row.incomplete_students)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-2xl border border-[#e9e1f2] bg-white px-4 py-6 shadow-[0_8px_24px_#40206f08] desk:px-7 desk:py-7">
        <div className="flex items-center gap-2 text-[#6e45a8]">
          <PieChartIcon size={21} aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[#3d2d52]">
            สัดส่วนนักเรียนตามสถานะการแก้ไข
          </h2>
        </div>
        <p className="mt-1 text-sm text-[#8c7e99]">
          เปรียบเทียบนักเรียนที่แก้ไขครบทุกวิชา กับนักเรียนที่ยังมีวิชาค้าง
        </p>
        {completedStudents === null || incompleteStudents === null ? (
          <p className="mt-8 rounded-xl bg-[#faf8fd] px-5 py-10 text-center text-sm text-[#8c7e99]">
            ยังไม่สามารถแสดงจำนวนนักเรียนแยกตามสถานะได้
          </p>
        ) : stats.total_students === 0 ? (
          <p className="mt-8 rounded-xl bg-[#faf8fd] px-5 py-10 text-center text-sm text-[#8c7e99]">
            ยังไม่มีข้อมูลนักเรียนสำหรับแสดงแผนภูมิ
          </p>
        ) : (
          <div className="mt-6 flex flex-col items-center justify-center gap-6 md:flex-row md:gap-12">
            <PieChart
              width={260}
              height={260}
              hideLegend
              series={[
                {
                  id: "student-completion",
                  data: [
                    {
                      id: "completed",
                      value: completedStudents,
                      label: "แก้ไขเรียบร้อยแล้ว",
                      color: "#44a98c",
                    },
                    {
                      id: "incomplete",
                      value: incompleteStudents,
                      label: "ยังแก้ไขไม่เรียบร้อย",
                      color: "#8c5bd3",
                    },
                  ],
                  arcLabel: (item) =>
                    item.value > 0
                      ? `${Math.round((item.value / stats.total_students) * 100)}%`
                      : "",
                  arcLabelMinAngle: 18,
                  valueFormatter: (item) => `${format(item.value)} คน`,
                },
              ]}
              className="[&_.MuiPieChart-arcLabel]:fill-white! [&_.MuiPieChart-arcLabel]:font-[inherit]! [&_.MuiPieChart-arcLabel]:text-sm! [&_.MuiPieChart-arcLabel]:font-semibold!"
            />
            <div className="grid w-full max-w-[360px] gap-3">
              {[
                {
                  label: "แก้ไขเรียบร้อยแล้ว",
                  value: completedStudents,
                  color: "bg-[#44a98c]",
                },
                {
                  label: "ยังแก้ไขไม่เรียบร้อย",
                  value: incompleteStudents,
                  color: "bg-[#8c5bd3]",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-xl border border-[#f0ebf5] bg-[#fcfbfe] px-4 py-3"
                >
                  <span className="flex items-center gap-2 text-sm text-[#665978]">
                    <span
                      className={`size-3 shrink-0 rounded-sm ${item.color}`}
                    />
                    {item.label}
                  </span>
                  <strong className="whitespace-nowrap text-base font-semibold tabular-nums text-[#3d2d52]">
                    {format(item.value)} คน
                  </strong>
                </div>
              ))}
              <p className="px-1 text-xs leading-6 text-[#8e819a]">
                นับนักเรียนหนึ่งคนเพียงครั้งเดียว
                และนับว่าเสร็จสิ้นเมื่อแก้ไขครบทุกรายวิชา
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-[#e9e1f2] bg-white px-4 py-6 shadow-[0_8px_24px_#40206f08] desk:px-7 desk:py-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[#6e45a8]">
              <ClipboardList size={21} aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[#3d2d52]">
                รายการที่ยังคงค้างตามสถานะ
              </h2>
            </div>
            <p className="mt-1 text-sm text-[#8c7e99]">
              นับตามรายวิชา นักเรียนหนึ่งคนอาจมีหลายรายการ
            </p>
          </div>
          <span className="rounded-full bg-[#f3ecfb] px-3 py-1.5 text-sm font-medium text-[#6b449f]">
            รวม {format(stats.incomplete_records)} รายการ
          </span>
        </div>
        {statusCounts ? (
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {outstandingStatuses.map((status) => (
              <div
                key={status}
                className="rounded-xl border border-[#ece5f3] bg-[#fcfbfe] px-4 py-5 last:col-span-2 lg:last:col-span-1"
              >
                <p className="min-h-10 text-sm leading-5 text-[#756782]">
                  {statuses[status].label}
                </p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-[#54357d]">
                  {format(statusCounts[status])}
                  <span className="ml-2 text-sm font-normal text-[#9587a3]">
                    รายการ
                  </span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-xl bg-[#faf8fd] px-5 py-8 text-center text-sm text-[#8c7e99]">
            ยังไม่สามารถแสดงจำนวนรายการแยกตามสถานะได้
          </p>
        )}
      </section>
    </>
  );
}
