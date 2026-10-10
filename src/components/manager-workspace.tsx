"use client";

import { Skeleton, SkeletonRows } from "@/components/skeleton";
import {
  startTransition,
  useEffect,
  useRef,
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
  Download,
  ChevronRight,
  ArrowLeftRight,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import styles from "./dashboard.module.css";
import LogoutOverlay from "@/components/logout-overlay";
import InstallAppControl from "@/components/install-app-control";
import ManagerCompletionSummary from "@/components/manager-completion-summary";
import { signOut } from "@/app/actions";
import {
  exportManagerStudents,
  loadManagerStudentCourses,
  loadManagerStudents,
} from "@/app/manager-actions";
import { saveCsv } from "@/lib/save-csv";
import {
  roles,
  statuses,
  statusText,
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
  type ManagerStudentCourse,
  type ManagerStudentList,
  type ManagerStudentRow,
} from "@/lib/manager-stats";

const BarChart = dynamic(
  () => import("@mui/x-charts/BarChart").then((module) => module.BarChart),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-[360px] items-end gap-4 rounded-xl bg-[#faf8fd] p-6"
      >
        <span className="sr-only">กำลังโหลดกราฟ</span>
        {["h-[55%]", "h-[80%]", "h-[40%]", "h-[90%]", "h-[65%]", "h-[30%]"].map((height) => (
          <Skeleton key={height} className={`flex-1 ${height}`} />
        ))}
      </div>
    ),
  },
);

type ManagerView = "dashboard" | "incomplete" | "completed";

const pages = [
  {
    id: "dashboard",
    label: "ภาพรวมสถิติ",
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
  const [loggingOut, setLoggingOut] = useState(false);
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
  } = useSwipeSidebar(245);
  const currentPage = pages.find((page) => page.id === view) ?? pages[0];
  const title = "title" in currentPage ? currentPage.title : currentPage.label;

  function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    if (demo) {
      window.location.assign("/");
      return;
    }
    startTransition(async () => {
      try {
        await signOut();
      } catch (err) {
        console.error("Logout failed:", err);
        setLoggingOut(false);
      }
    });
  }

  return (
    <div
      className={`${styles.app} min-h-screen touch-auto`}
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
        className={`${styles.sidebar} fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col border-r border-[#e8e0f1] bg-white px-4 py-6 duration-300 ease-out motion-reduce:transition-none desk:translate-x-0 ${phase === "idle" ? (mobileMenuOpen ? "translate-x-0 transition-transform" : "-translate-x-full transition-transform") : `translate-x-[var(--sidebar-offset)] ${phase === "dragging" ? "transition-none" : "transition-transform"}`}`}
      >
        <div className="flex items-start justify-between gap-1">
          <a
            href={demo ? "/demo" : "/dashboard"}
            className="focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 mx-2 flex items-center gap-[11px] text-2xl leading-[1.2] font-[650] tracking-[-0.5px] [&_b]:font-normal [&_b]:text-brand [&_small]:mt-[7px] [&_small]:block [&_small]:text-[8px] [&_small]:font-medium [&_small]:tracking-[1.4px] [&_small]:text-[#9a90ac] max-wide:text-[21px] max-wide:[&_small]:text-[7px] max-desk:text-2xl "
          >
            <Image
              src="/icon.svg"
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
                title={page.label}
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
                <span>{page.label}</span>
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
          <div className="px-3 py-2 font-sans">
            <strong className="block truncate text-[15px] font-semibold">
              {profile.full_name}
            </strong>
            <span className="text-[13px] text-[#8b7e99]">{roles.manager}</span>
          </div>
          <button
            type="button"
            disabled={pending || loggingOut}
            onClick={logout}
            className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#756782] hover:bg-[#faf7fe] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loggingOut ? (
              <Loader2 size={17} className="animate-spin text-brand" aria-hidden="true" />
            ) : (
              <LogOut size={17} aria-hidden="true" />
            )}
            {loggingOut ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}
          </button>
        </div>
        <button className={styles.tabletLogout} onClick={logout} disabled={pending || loggingOut} aria-label="ออกจากระบบ" title="ออกจากระบบ"><LogOut size={20} /></button>
      </aside>

      <div className={`${styles.shell} ${styles.managerShell}`}>
        <header className={`${styles.mobileTopbar} flex h-[76px] items-center justify-between gap-4 border-b border-[#e8e0f1] bg-white px-5 desk:px-9`}>
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
        <main className={styles.page}>
          <div className={styles.managerHeading}>
            <h1>{title}</h1>
            <p>ติดตามภาพรวมการแก้ไขผลการเรียนของนักเรียน โรงเรียนเมืองสุราษฎร์ธานี</p>
          </div>
          {!demo && (
            <div className="mb-5">
              <InstallAppControl />
            </div>
          )}
          {view === "dashboard" ? (
            <ManagerStatsContent stats={stats} />
          ) : (
            <ManagerStudentsView
              key={view}
              completed={view === "completed"}
              demoRecords={demo ? (demoRecords ?? []) : null}
            />
          )}
        </main>
      </div>
      {loggingOut && <LogoutOverlay />}
    </div>
  );
}

export function ManagerStudentsView({
  completed,
  demoRecords,
}: {
  completed: boolean;
  demoRecords: GradeRecord[] | null;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [academicYear, setAcademicYear] = useState("all");
  const [semester, setSemester] = useState("all");
  const [yearOptions, setYearOptions] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ManagerStudentList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<ManagerStudentRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const format = (value: number) => value.toLocaleString("th-TH");

  // Exports every student matching the current search and filters, not only the visible page.
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const filters = {
        level: level === "all" ? null : Number(level),
        academicYear: academicYear === "all" ? null : Number(academicYear),
        semester: semester === "all" ? null : Number(semester),
      };
      let rows: ManagerStudentRow[];
      if (demoRecords) {
        rows = [];
        for (let next = 1; ; next++) {
          const part = summarizeManagerStudents(demoRecords, completed, query, next, filters);
          rows.push(...part.items);
          if (rows.length >= part.total || part.items.length === 0) break;
        }
      } else {
        const response = await exportManagerStudents({ completed, query, ...filters });
        if (!response.data) {
          setExportError(response.error);
          return;
        }
        rows = response.data;
      }
      saveCsv(
        `MST-GRS-students-${completed ? "completed" : "incomplete"}-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          "เลขประจำตัว",
          "ชื่อ-สกุล",
          "ชั้น/ห้อง",
          "เลขที่",
          "ปีการศึกษาล่าสุด",
          "ภาคเรียนล่าสุด",
          "รายการทั้งหมด",
          ...(completed ? [] : ["ยังคงค้าง"]),
          "เรียบร้อยแล้ว",
        ],
        rows.map((student) => [
          student.student_code,
          student.student_name,
          student.classroom,
          student.roll_number,
          student.academic_year,
          student.semester,
          student.total_records,
          ...(completed ? [] : [student.incomplete_records]),
          student.completed_records,
        ]),
      );
    } catch {
      setExportError("ไม่สามารถส่งออกรายชื่อนักเรียนได้ กรุณาลองอีกครั้ง");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (demoRecords) {
      const summary = summarizeManagerStudents(demoRecords, completed, query, page, {
        level: level === "all" ? null : Number(level),
        academicYear: academicYear === "all" ? null : Number(academicYear),
        semester: semester === "all" ? null : Number(semester),
      });
      setResult(summary);
      setYearOptions(summary.years);
      setLoading(false);
    } else {
      startTransition(async () => {
        try {
          const response = await loadManagerStudents({
            completed,
            page,
            query,
            level: level === "all" ? null : Number(level),
            academicYear: academicYear === "all" ? null : Number(academicYear),
            semester: semester === "all" ? null : Number(semester),
          });
          if (!active) return;
          setResult(response.data);
          if (response.data) setYearOptions(response.data.years);
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
  }, [completed, demoRecords, page, query, level, academicYear, semester, refresh]);

  const totalPages = Math.max(
    1,
    Math.ceil((result?.total ?? 0) / managerStudentPageSize),
  );

  return (
    <section className="overflow-hidden font-sans rounded-2xl border border-[#e9e1f2] bg-white shadow-[0_8px_24px_#40206f08]">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-6 pb-5 desk:px-7">
        <div>
          <h2 className="text-lg font-semibold text-[#3d2d52]">
            {completed
              ? "นักเรียนที่แก้ไขผลการเรียนเรียบร้อยแล้ว"
              : "นักเรียนที่ยังมีผลการเรียนคงค้าง"}
          </h2>
          <p className="mt-1 text-[15px] text-[#8c7e99]">
            {completed
              ? "แก้ไขครบทุกวิชาและฝ่ายวัดผลอนุมัติแล้ว"
              : "มีอย่างน้อยหนึ่งวิชาที่ยังดำเนินการไม่เสร็จ"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <span className="rounded-full bg-[#f3ecfb] px-3 py-1.5 text-sm font-semibold text-[#6b449f]">
            {result ? `${format(result.total)} คน` : (<><Skeleton className="inline-block h-4 w-14 align-middle" /><span className="sr-only">กำลังโหลด</span></>)}
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || !result || result.total === 0}
            className="inline-flex cursor-pointer items-center gap-2 border border-[#d9c8ee] px-3.5 py-2 text-sm font-semibold text-[#7046a4] transition-colors hover:bg-[#f3ecfb] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
          >
            {exporting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            {exporting ? "กำลังส่งออก..." : "ส่งออก CSV"}
          </button>
        </div>
      </div>
      {exportError && (
        <p
          role="alert"
          className="mx-5 mb-4 rounded-xl bg-[#fff4f4] px-4 py-3 text-sm text-[#a35b68] desk:mx-7"
        >
          {exportError}
        </p>
      )}

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
        <label className="min-w-[220px] flex-1 text-sm font-medium text-[#756782]">
          ค้นหานักเรียน
          <span className="mt-1.5 flex items-center gap-2 border border-[#e5dced] bg-white px-3 focus-within:border-[#9d72cf]">
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
        <label className="grid min-w-[125px] gap-1.5 text-sm font-medium text-[#756782]">
          ระดับชั้น
          <select
            value={level}
            onChange={(event) => {
              setResult(null);
              setPage(1);
              setLevel(event.target.value);
            }}
            className="h-10 border border-[#e5dced] bg-white px-3 text-sm text-[#3d2d52] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
          >
            <option value="all">ทุกระดับชั้น</option>
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>ม.{value}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[145px] gap-1.5 text-sm font-medium text-[#756782]">
          ปีการศึกษาล่าสุด
          <select
            value={academicYear}
            onChange={(event) => {
              setResult(null);
              setPage(1);
              setAcademicYear(event.target.value);
            }}
            className="h-10 border border-[#e5dced] bg-white px-3 text-sm text-[#3d2d52] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
          >
            <option value="all">ทุกปีการศึกษา</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[125px] gap-1.5 text-sm font-medium text-[#756782]">
          ภาคเรียนที่
          <select
            value={semester}
            onChange={(event) => {
              setResult(null);
              setPage(1);
              setSemester(event.target.value);
            }}
            className="h-10 border border-[#e5dced] bg-white px-3 text-sm text-[#3d2d52] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
          >
            <option value="all">ทุกภาคเรียน</option>
            {[1, 2].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="cursor-pointer bg-yellow-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-yellow-700 duration-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
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
          className="grid size-10 cursor-pointer place-items-center border border-[#e5dced] text-[#765a9b] transition-colors hover:bg-[#f7f1fd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </form>

      {loading ? (
        <div role="status" className="divide-y divide-[#efe8f6] px-5 py-3">
          <span className="sr-only">กำลังโหลดรายชื่อนักเรียน</span>
          <SkeletonRows rows={6} />
        </div>
      ) : error ? (
        <p
          role="alert"
          className="mx-5 my-8 rounded-xl bg-[#fff4f4] px-5 py-8 text-center text-sm text-[#a35b68]"
        >
          {error}
        </p>
      ) : result && result.total === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-[#8c7e99]">
          {query || level !== "all" || academicYear !== "all" || semester !== "all"
            ? "ไม่พบนักเรียนที่ตรงกับคำค้นหาหรือตัวกรอง"
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
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <caption className="sr-only">
                {completed
                  ? "รายชื่อนักเรียนที่แก้ไขเรียบร้อยแล้ว"
                  : "รายชื่อนักเรียนที่ยังไม่เรียบร้อย"}
              </caption>
              <thead className="bg-[#f8f5fc] text-sm font-semibold text-[#6d5b80]">
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
                  { !completed &&
                    <th scope="col" className="px-4 py-3.5 text-right">
                      ยังคงค้าง
                    </th>
                  }
                  <th scope="col" className="px-5 py-3.5 text-right desk:pr-7">
                    เรียบร้อยแล้ว
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-right desk:pr-7">
                    รายละเอียด
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
                    {!completed &&
                      <td className="px-4 py-4 text-right font-semibold tabular-nums text-red-500">
                        {format(student.incomplete_records)}
                      </td>
                    }
                    <td className="px-5 py-4 text-right font-semibold tabular-nums text-[#32977c] desk:pr-7">
                      {format(student.completed_records)}
                    </td>
                    <td className="px-5 py-4 text-right desk:pr-7">
                      <button
                        type="button"
                        onClick={() => setSelectedStudent(student)}
                        aria-label={`ดูรายละเอียดรายวิชาของ ${student.student_name}`}
                        className="cursor-pointer whitespace-nowrap border border-[#d9c8ee] px-3 py-1.5 text-sm font-semibold text-[#7046a4] transition-colors hover:bg-[#f3ecfb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
                      >
                        ดูรายวิชา
                      </button>
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
      {selectedStudent && (
        <ManagerStudentCoursesDialog
          key={selectedStudent.student_code}
          student={selectedStudent}
          demoRecords={demoRecords}
          completed={completed}
          onClose={() => setSelectedStudent(null)}
        />
      )}
    </section>
  );
}

function ManagerStudentCoursesDialog({
  student,
  demoRecords,
  completed,
  onClose,
}: {
  student: ManagerStudentRow;
  demoRecords: GradeRecord[] | null;
  completed: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [courses, setCourses] = useState<ManagerStudentCourse[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    if (demoRecords) {
      setCourses(
        demoRecords
          .filter((record) => record.student_code === student.student_code)
          .sort(
            (a, b) =>
              Number(a.status === "completed") - Number(b.status === "completed") ||
              b.academic_year - a.academic_year ||
              b.semester - a.semester ||
              a.course_code.localeCompare(b.course_code),
          ),
      );
    } else {
      loadManagerStudentCourses(student.student_code)
        .then((response) => {
          if (!active) return;
          setCourses(response.data);
          setError(response.error ?? "");
        })
        .catch(() => {
          if (active) setError("ไม่สามารถโหลดรายละเอียดรายวิชาได้ กรุณาลองอีกครั้ง");
        });
    }
    return () => {
      active = false;
    };
  }, [demoRecords, student.student_code]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="manager-student-courses-title"
      onClose={onClose}
      className="fixed inset-0 font-sans m-auto max-h-[90vh] w-[calc(100%-32px)] max-w-[900px] overflow-y-auto rounded-2xl border-0 bg-white p-0 text-[#3d2d52] shadow-[0_20px_100px_#26164340] backdrop:bg-[#24163666] backdrop:backdrop-blur-[3px]"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#eee8f5] bg-white px-5 py-4 desk:px-7">
        <div>
          <h2 id="manager-student-courses-title" className="text-xl font-semibold">
            รายละเอียดรายวิชา · {student.student_name}
          </h2>
          <p className="mt-1 text-[15px] text-[#756782]">
            รหัสนักเรียน {student.student_code} · ชั้น/ห้อง {student.classroom}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="ปิดรายละเอียดรายวิชา"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-[#756782] hover:bg-[#f3ecfb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7144b3]"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="px-5 py-5 desk:px-7">
        <div className="mb-5 flex flex-wrap gap-2 text-sm font-medium ">
          { !completed &&
            <span className="rounded-full bg-red-100 px-3 py-1.5 text-red-500">
              ยังแก้ไขไม่ผ่าน {student.incomplete_records} วิชา
            </span>
          }
          <span className="rounded-full bg-[#eaf7f1] px-3 py-1.5 text-[#268467]">
            แก้ไขผ่านแล้ว {student.completed_records} วิชา
          </span>
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-[#fff4f4] p-5 text-[15px] text-[#a35b68]">
            {error}
          </p>
        ) : courses === null ? (
          <div role="status" className="space-y-3">
            <span className="sr-only">กำลังโหลดรายละเอียดรายวิชา</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3 rounded-xl border border-[#e9e1f2] p-4">
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        ) : courses.length === 0 ? (
          <p className="py-10 text-center text-[15px] text-[#8c7e99]">ไม่พบรายวิชาของนักเรียน</p>
        ) : (
          <div className="space-y-3">
            {courses.map((course) => (
              <article key={course.id} className="rounded-xl border border-[#e9e1f2] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-[15px]">{course.course_code} · {course.course_name}</h3>
                    <p className="mt-1 text-sm text-[#756782]">
                      ปีการศึกษา {course.academic_year} · ภาคเรียนที่ {course.semester}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${course.status === "completed" ? "bg-[#eaf7f1] text-[#268467]" : "bg-red-100 text-red-500"}`}>
                    {course.status === "completed" ? "แก้ไขผ่านแล้ว" : "ยังแก้ไขไม่ผ่าน"}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 border-t border-[#f0ebf5] pt-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-[#8c7e99]">หน่วยกิต</dt><dd className="mt-1">{course.credits}</dd></div>
                  <div><dt className="text-xs text-[#8c7e99]">คุณครูประจำวิชา</dt><dd className="mt-1">{course.teacher_name.join(", ")}</dd></div>
                  <div><dt className="text-xs text-[#8c7e99]">ผลการเรียนเดิม</dt><dd className="mt-1">{course.original_grade}</dd></div>
                  <div><dt className="text-xs text-[#8c7e99]">สถานะปัจจุบัน</dt><dd className="mt-1">{statusText(course.status)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
    </dialog>
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
    <section className={styles.metric} data-tone={tone}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-medium leading-6 text-[#756782]">
          {label}
        </h2>
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone === "green" ? "bg-[#e8f6f0] text-[#2c9379]" : tone === "amber" ? "bg-[#fff4df] text-[#b7832b]" : "bg-[#f1eafb] text-[#7849b9]"}`}
        >
          {icon}
        </span>
      </div>
      <div className={styles.metricValue}>
        {value === null ? "—" : value.toLocaleString("th-TH")}
        <span className="ml-2 text-[15px] font-normal text-[#9486a2]">คน</span>
      </div>
    </section>
  );
}

export function ManagerStatsContent({ stats }: { stats: ManagerStats | null }) {
  if (stats) return <ManagerDashboardStats stats={stats} />;
  return (
    <section
      role="alert"
      className="rounded-2xl border border-[#ead7db] bg-white px-6 py-8 text-sm text-[#9b485b] shadow-[0_8px_24px_#40206f08]"
    >
      ยังไม่สามารถโหลดสถิติได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูล
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
  // Bar value labels sit above the bars but are clipped to the plot area, so the
  // axis must end at least ~10% above the tallest bar to leave room for them.
  const headroomMax = Math.ceil(maxStudents * 1.1);
  const intervals = [4, 3, 2].reduce((best, count) =>
    Math.ceil(headroomMax / count) * count < Math.ceil(headroomMax / best) * best
      ? count
      : best,
  );
  const tickStep = Math.max(1, Math.ceil(headroomMax / intervals));
  const axisMax = tickStep * intervals;
  const format = (count: number) => count.toLocaleString("th-TH");
  const statusCounts = stats.outstanding_by_status;

  return (
    <div className={styles.managerDashboard}>
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

      <ManagerCompletionSummary
        stats={stats}
        completedStudents={completedStudents}
      />

      <section className="mt-6 font-sans rounded-2xl border border-[#e9e1f2] bg-white px-4 py-6 shadow-[0_8px_24px_#40206f08] desk:px-7 desk:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#6e45a8]">
              <BarChart3 size={21} aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[#3d2d52]">
                สถิติจำนวนนักเรียนตามระดับชั้น
              </h2>
            </div>
            <p className="mt-1 text-[15px] text-[#8c7e99]">
              แผนภูมิแสดงจำนวนนักเรียนที่มีผลการเรียนคงค้างตามระดับชั้น
            </p>
          </div>
          <span className="rounded-full bg-[#f3ecfb] px-3 py-1.5 text-sm font-medium text-[#6b449f]">
            นักเรียนทั้งหมด {format(stats.total_students)} คน
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#746782]">
          <span className="inline-flex items-center gap-2">
            <span className="size-4 bg-status-green" />
            แก้ไขเรียบร้อยแล้ว
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-4 bg-status-amber" />
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
                  id: "incomplete",
                  data: stats.by_level.map((row) => row.incomplete_students),
                  label: "ยังแก้ไขไม่เรียบร้อย",
                  color: "var(--color-status-amber)",
                  barLabel: (item) => (item.value ? format(item.value) : ""),
                  barLabelPlacement: "outside",
                  valueFormatter: (value) => `${format(value ?? 0)} คน`,
                },
                {
                  id: "completed",
                  data: stats.by_level.map((row) => row.completed_students),
                  label: "แก้ไขเรียบร้อยแล้ว",
                  color: "var(--color-status-green)",
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

      <section className="mt-6 rounded-2xl font-sans border border-[#e9e1f2] bg-white px-4 py-6 shadow-[0_8px_24px_#40206f08] desk:px-7 desk:py-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[#6e45a8]">
              <ClipboardList size={21} aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[#3d2d52]">
                รายการที่ยังคงค้างตามสถานะ
              </h2>
            </div>
            <p className="mt-1 text-[15px] text-[#8c7e99]">
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
                <p className="min-h-10 text-[15px] leading-5 text-[#756782]">
                  {statuses[status].label}
                </p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-[#54357d]">
                  {format(statusCounts[status])}
                  <span className="ml-2 text-[15px] font-normal text-[#9587a3]">
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
    </div>
  );
}
