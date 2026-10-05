"use client";
import { twMerge } from "tailwind-merge";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  GraduationCap,
  LayoutDashboard,
  History,
  Loader2,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  FileCheck2,
  Clock3,
  Check,
  CheckCircle2,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  CalendarDays,
  ShieldCheck,
  Settings2,
  Menu,
  X,
  Info,
  FileSpreadsheet,
  ClipboardList,
  UsersRound,
} from "lucide-react";
import LogoutOverlay from "@/components/logout-overlay";
import { advance, correctFinalGrade, saveSchedule, signOut, importGrades } from "@/app/actions";
import {
  type GradeRecord,
  type ArchivedGradeRecord,
  type GradeCorrection,
  type Profile,
  type Schedule,
  type Role,
  type Status,
  statuses,
  roles,
  nextStatus,
  isOpen,
  resetForNewPeriod,
  thaiDate,
  safeCell,
} from "@/lib/domain";
import { demoProfiles } from "@/lib/demo";
import ManagerWorkspace from "@/components/manager-workspace";
import styles from "./dashboard.module.css";
import RecoveryRail from "./recovery-rail";
import { useSwipeSidebar } from "@/lib/use-swipe-sidebar";
import { summarizeManagerStats } from "@/lib/manager-stats";
import { worksheetRows } from "@/lib/import-excel";
import PushNotificationControl from "@/components/push-notification-control";
import {
  columns,
  parseRows,
  parseDelimited,
  type ImportRow,
} from "@/lib/import";
import Image from "next/image";
import { bangkokDate, normalizeSchedule, scheduleClosingDate, scheduleClosingDisplay, scheduleDates } from "@/lib/schedule-dates";

// Student data and import dialogs are loaded on the client. Keep the first
// server response independent of this interactive component's browser bundle.
const AdminStudents = dynamic(() => import("./admin-students"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-line bg-white p-6 text-sm text-secondary" role="status">
      กำลังโหลดรายชื่อนักเรียน...
    </div>
  ),
});
const AdminTeachers = dynamic(() => import("./admin-teachers"), {
  ssr: false,
  loading: () => <div role="status" className="rounded-xl border border-line bg-white p-6 text-sm text-secondary">กำลังโหลดรายชื่อคุณครู...</div>,
});
const AdminStudentLifecycle = dynamic(() => import("./admin-student-lifecycle"), { ssr: false });
const AdminManagers = dynamic(() => import("./admin-managers"), { ssr: false });
const AdminAcademics = dynamic(() => import("./admin-academics"), { ssr: false });

type View = "overview" | "outstanding" | "history" | "export" | "import" | "schedule" | "students" | "teachers" | "academics" | "managers" | "student-lifecycle";
const emptyHistory: ArchivedGradeRecord[] = [];
const emptyCorrections: GradeCorrection[] = [];
const validFinalGrades = ["0", "ร", "มผ", "1", "1.5", "2", "2.5", "3", "3.5", "4", "ผ"];
const navTitles: Record<View, string> = {
  overview: "ภาพรวมผลการเรียน",
  outstanding: "รายการคงค้าง",
  history: "ประวัติแก้ไขผลการเรียน",
  export: "ส่งออกรายการผลการเรียน",
  import: "นำเข้าข้อมูล",
  schedule: "ตั้งค่าเวลาเปิด–ปิดระบบ",
  "student-lifecycle": "จัดการนักเรียนใหม่",
  students: "รายชื่อนักเรียน",
  teachers: "รายชื่อคุณครู",
  managers: "รายชื่อผู้บริหาร",
  academics: "รายชื่อฝ่ายวิชาการ",
};
function localBangkok(value: string | null) {
  if (!value) return "";
  return new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16);
}
function saveCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv =
    "\uFEFF" +
    [headers, ...rows]
      .map((row) =>
        row.map((v) => '"' + safeCell(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Workspace({
  profile,
  records,
  schedule,
  historyRecords = emptyHistory,
  gradeCorrections = emptyCorrections,
  initialView = profile.role === "admin" ? "students" : "overview",
  demo = false,
}: {
  profile: Profile;
  records: GradeRecord[];
  schedule: Schedule;
  historyRecords?: ArchivedGradeRecord[];
  gradeCorrections?: GradeCorrection[];
  initialView?: "overview" | "history" | "import" | "students" | "teachers" | "academics" | "managers" | "student-lifecycle";
  demo?: boolean;
}) {
  const router = useRouter();
  const [demoActor, setActor] = useState(profile);
  const actor = demo ? demoActor : profile;
  const [items, setItems] = useState(records);
  const [archives, setArchives] = useState(historyRecords);
  const [corrections, setCorrections] = useState(gradeCorrections);
  const [settings, setSettings] = useState(() => normalizeSchedule(schedule));
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [year, setYear] = useState("all");
  const [semester, setSemester] = useState("all");
  const [page, setPage] = useState(1);
  const {
    open: mobile,
    setOpen: setMobile,
    phase: mobilePhase,
    visible: mobileVisible,
    asideRef,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onTransitionEnd,
  } = useSwipeSidebar(245);
  const [selected, setSelected] = useState<GradeRecord | null>(null);
  const [toast, setToast] = useState("");
  const [problem, setProblem] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [busy, startTransition] = useTransition();
  const [assignment, setAssignment] = useState("");
  const [due, setDue] = useState("");
  const [finalGrade, setFinalGrade] = useState("1");
  const [editingFinalGrade, setEditingFinalGrade] = useState(false);
  const [opens, setOpens] = useState(bangkokDate(schedule.opens_at));
  const [closes, setCloses] = useState(scheduleClosingDate(schedule.closes_at));
  const [notice, setNotice] = useState(schedule.notice);
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const processedClosings = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!demo) setItems(records);
  }, [records, demo]);
  useEffect(() => {
    if (!demo) setArchives(historyRecords);
  }, [historyRecords, demo]);
  useEffect(() => {
    if (!demo) setCorrections(gradeCorrections);
  }, [gradeCorrections, demo]);
  useEffect(() => {
    if (!demo) setSettings(normalizeSchedule(schedule));
  }, [schedule, demo]);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (!demo && settings.closes_at && Date.now() >= Date.parse(settings.closes_at)) router.refresh();
    }, 30000);
    return () => clearInterval(t);
  }, [demo, settings.closes_at, router]);
  useEffect(() => {
    if (!demo || !settings.closes_at || now < Date.parse(settings.closes_at)) return;
    if (processedClosings.current.has(settings.closes_at)) return;
    processedClosings.current.add(settings.closes_at);
    const completed = items.filter((record) => record.status === "completed");
    setArchives((previous) => [...completed.map((record) => ({
      ...record, archived_at: new Date(now).toISOString(), archived_closes_at: settings.closes_at!,
    })), ...previous]);
    setItems((previous) => previous.filter((record) => record.status !== "completed").map(resetForNewPeriod));
  }, [demo, items, settings.closes_at, now]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setPage(1);
  }, [query, filter, year, semester, view]);
  useEffect(() => {
    if (selected) {
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [selected]);
  const role = actor.role;
  const open = isOpen(settings, now);
  const scope = items.filter((r) =>
    role === "student"
      ? r.student_id === actor.id
      : role === "teacher"
        ? r.teacher_id.includes(actor.id)
        : role === "academic",
  );
  const historyScope = archives.filter((r) => role === "student"
    ? r.student_id === actor.id
    : role === "teacher" ? r.teacher_id.includes(actor.id) : role === "academic");
  const visibleScope = view === "history" ? historyScope : scope;
  const outstanding = scope.filter((r) => r.status !== "completed");
  const completed = scope.filter((r) => r.status === "completed");
  const awaiting = scope.filter((r) =>
    role === "student"
      ? r.status === "pending"
      : role === "teacher"
        ? ["requested", "assigned", "submitted"].includes(r.status)
        : r.status === "teacher_approved",
  );
  const available: View[] =
    role === "student"
      ? ["overview", "history"]
      : role === "teacher"
        ? ["overview", "history", "export"]
        : role === "admin"
          ? ["students", "student-lifecycle", "teachers", "academics", "managers", "import", "schedule"]
          : ["overview", "outstanding", "history", "export"];
  const filtered = useMemo(
    () => {
      const rows = visibleScope.filter((r) => {
        if (view === "outstanding" && r.status === "completed") return false;
        if (view === "history" && r.status !== "completed") return false;
        if (view === "export" && role === "academic" && r.status !== "completed")
          return false;
        if (
          view === "overview" &&
          role === "academic" &&
          r.status !== "teacher_approved"
        )
          return false;
        return (
          (role === "academic" || filter === "all" || r.status === filter) &&
          (year === "all" || String(r.academic_year) === year) &&
          (semester === "all" || String(r.semester) === semester) &&
          [
            r.course_name,
            r.course_code,
            r.student_name,
            r.student_code,
            ...r.teacher_name,
          ].some((v) => v.toLowerCase().includes(query.toLowerCase()))
        );
      });
      if (view === "outstanding") {
        rows.sort((a, b) =>
          statuses[a.status].progress - statuses[b.status].progress ||
          a.classroom.localeCompare(b.classroom, "th", { numeric: true }) ||
          a.student_code.localeCompare(b.student_code, "th", { numeric: true }) ||
          a.course_code.localeCompare(b.course_code, "th", { numeric: true }) ||
          a.id.localeCompare(b.id),
        );
      }
      return rows;
    },
    [visibleScope, view, role, filter, year, semester, query],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const shown = filtered.slice(
    (Math.min(page, pages) - 1) * 8,
    Math.min(page, pages) * 8,
  );
  function navigate(v: View) {
    setView(v);
    setFilter("all");
    setQuery("");
    setMobile(false);
    setProblem("");
    if (v === "history") {
      setYear("all");
      setSemester("all");
      if (!demo) router.refresh();
    }
  }
  function switchRole(r: Role) {
    setActor(demoProfiles[r]);
    setView(r === "admin" ? "students" : "overview");
    setFilter("all");
    setYear("all");
    setSemester("all");
    setQuery("");
    setProblem("");
  }
  function show(r: GradeRecord) {
    if (
      (role === "teacher" && r.status === "requested") ||
      (role === "student" && r.status === "assigned")
    ) {
      const base = demo ? "/demo" : "/dashboard";
      const roleQuery = demo ? `?role=${role}` : "";
      window.location.assign(`${base}/assignments/${r.id}${roleQuery}`);
      return;
    }
    setSelected(r);
    setAssignment(r.assignment ?? "");
    setDue(localBangkok(r.due_at));
    setFinalGrade(r.final_grade ?? "1");
    setEditingFinalGrade(false);
    setProblem("");
  }
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
  function actionLabel(r: GradeRecord) {
    if (view === "history") return "ดูประวัติ";
    if (role === "student")
      return r.status === "pending"
        ? "ยื่นคำร้อง"
        : r.status === "requested"
          ? "ยื่นคำร้องแล้ว"
          : r.status === "assigned"
            ? "ดูรายละเอียดงาน"
            : r.status === "completed"
              ? "เรียบร้อย"
              : "ส่งงานแล้ว";
    if (role === "teacher")
      return r.status === "requested"
        ? "มอบหมายงาน"
        : r.status === "assigned"
          ? "ยืนยันรับงาน"
        : r.status === "submitted"
          ? "อนุมัติ"
          : r.status === "teacher_approved"
            ? "ดู/แก้ไขผลการเรียน"
            : "ดูรายละเอียด";
    return r.status === "teacher_approved" ? "อนุมัติ" : "เรียบร้อย";
  }
  function act() {
    if (!selected) return;
    const target = nextStatus[role]?.[selected.status];
    if (!target) return;
    setProblem("");
    if (
      target === "assigned" &&
      (assignment.trim().length < 10 ||
        !due ||
        Date.parse(due + "+07:00") <= Date.now())
    ) {
      setProblem(
        "กรุณาระบุรายละเอียดงานอย่างน้อย 10 ตัวอักษร และกำหนดส่งในอนาคต",
      );
      return;
    }
    startTransition(async () => {
      if (demo) {
        const stamp = new Date().toISOString();
        const timestampKey = {
          requested: "requested_at",
          assigned: "assigned_at",
          submitted: "submitted_at",
          teacher_approved: "teacher_approved_at",
          completed: "completed_at",
        }[target as Exclude<Status, "pending">];
        setItems((old) =>
          old.map((r) =>
            r.id === selected.id
              ? {
                  ...r,
                  status: target,
                  ...(timestampKey ? { [timestampKey]: stamp } : {}),
                  ...(target === "assigned"
                    ? {
                        assignment: assignment.trim(),
                        due_at: new Date(due + "+07:00").toISOString(),
                      }
                    : {}),
                  ...(target === "teacher_approved"
                    ? { final_grade: finalGrade }
                    : {}),
                }
              : r,
          ),
        );
      } else {
        const result = await advance({
          id: selected.id,
          expected: selected.status,
          assignment,
          due_at: due ? new Date(due + "+07:00").toISOString() : undefined,
          final_grade: finalGrade,
        });
        if (result.error) {
          setProblem(result.error);
          return;
        }
      }
      setSelected(null);
      setToast(
        demo ? "บันทึกการเปลี่ยนแปลงในโหมดทดลองแล้ว" : "บันทึกเรียบร้อยแล้ว",
      );
    });
  }
  function saveCorrectedGrade() {
    if (!selected || role !== "teacher" || view !== "overview" ||
      selected.status !== "teacher_approved") return;
    if (!open) {
      setProblem("ระบบปิดรับดำเนินการแล้ว");
      return;
    }
    if (finalGrade === selected.final_grade) {
      setProblem("กรุณาเลือกผลการเรียนที่ต่างจากเดิม");
      return;
    }
    setProblem("");
    startTransition(async () => {
      const previousGrade = selected.final_grade!;
      const result = demo
        ? { correction: {
            id: crypto.randomUUID(), record_id: selected.id,
            student_id: selected.student_id, teacher_id: selected.teacher_id,
            previous_grade: previousGrade, new_grade: finalGrade,
            changed_by: actor.id, changed_by_name: actor.full_name,
            changed_at: new Date().toISOString(),
          } satisfies GradeCorrection }
        : await correctFinalGrade({
            id: selected.id, expectedGrade: previousGrade, newGrade: finalGrade,
          });
      if (result.error) {
        setProblem(result.error);
        return;
      }
      const correction = result.correction!;
      setItems((old) => old.map((r) => r.id === selected.id
        ? { ...r, final_grade: correction.new_grade } : r));
      setSelected((r) => r?.id === selected.id
        ? { ...r, final_grade: correction.new_grade } : r);
      setCorrections((old) => old.some((item) => item.id === correction.id)
        ? old : [correction, ...old]);
      setEditingFinalGrade(false);
      setToast(demo ? "บันทึกการแก้ไขในโหมดทดลองแล้ว" : "บันทึกผลการเรียนใหม่และประวัติการแก้ไขแล้ว");
    });
  }
  function exportData() {
    const extra = role === "academic" || view === "history";
    saveCsv(
      `MST-GRS-${extra ? "completed" : "outstanding"}-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ...Object.keys(columns),
        "สถานะ",
        ...(extra ? ["ผลการเรียนใหม่", "วันที่ฝ่ายวิชาการอนุมัติ"] : []),
        ...(view === "history" ? ["วันที่เก็บเข้าประวัติ"] : []),
      ],
      filtered.map((r) => [
        ...Object.values(columns).map((k) =>
          k === "teacher_name" ? r.teacher_name.join(", ") : r[k],
        ),
        statuses[r.status].label,
        ...(extra ? [r.final_grade, thaiDate(r.completed_at, true)] : []),
        ...(view === "history" ? [thaiDate((r as ArchivedGradeRecord).archived_at, true)] : []),
      ]),
    );
    setToast(`ส่งออก ${filtered.length} รายการแล้ว`);
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setPreview([]);
    setFileErrors([]);
    setFileName(file.name);
    try {
      let table: unknown[][];
      if (/\.(csv|tsv)$/i.test(file.name)) {
        table = parseDelimited(await file.text());
      } else if (/\.xlsx$/i.test(file.name)) {
        const ExcelJS = await import("exceljs");
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(await file.arrayBuffer());
        const sheet = book.worksheets[0];
        if (!sheet) throw new Error("ไฟล์ไม่มีแผ่นงาน");
        table = worksheetRows(sheet);
      } else throw new Error("รองรับไฟล์ .xlsx, .csv และ .tsv เท่านั้น");
      if (!table.length) throw new Error("ไฟล์ไม่มีข้อมูล");
      const result = parseRows(table[0].map(String), table.slice(1));
      setPreview(result.rows);
      setFileErrors(result.errors);
      if (!result.rows.length && !result.errors.length)
        throw new Error("ไม่พบรายการในไฟล์");
    } catch (e) {
      setFileErrors([e instanceof Error ? e.message : "ไม่สามารถอ่านไฟล์ได้"]);
    } finally {
      setReading(false);
    }
  }
  function confirmImport() {
    if (!open) {
      setProblem("ระบบยังไม่เปิดรับการนำเข้าข้อมูล กรุณาตั้งวันที่เปิดระบบก่อน");
      return;
    }
    startTransition(async () => {
      setProblem("");
      if (demo) {
        setToast(
          `ตรวจสอบผ่าน ${preview.length} รายการ — โหมดทดลองไม่บันทึกฐานข้อมูล`,
        );
        return;
      }
      const result = await importGrades(preview);
      if (result.error) {
        setProblem(result.error);
        return;
      }
      setToast(
        `เพิ่มใหม่ ${result.inserted} รายการ เขียนทับและเริ่มใหม่ ${result.updated} รายการ${result.skipped ? ` ข้ามรายการในประวัติ ${result.skipped} รายการ` : ""}`,
      );
      setPreview([]);
      setFileName("");
      if (fileInput.current) fileInput.current.value = "";
    });
  }
  function submitSchedule(e: React.FormEvent) {
    e.preventDefault();
    setProblem("");
    const range = scheduleDates(opens, closes);
    if (!range) {
      setProblem("กรุณาระบุวันที่ให้ครบ โดยวันปิดต้องเป็นวันเดียวกับหรือหลังวันเปิดระบบ");
      return;
    }
    startTransition(async () => {
      const value = {
        ...range,
        notice,
      };
      if (!demo) {
        const result = await saveSchedule({ opens_on: opens, closes_on: closes, notice });
        if (result.error) {
          setProblem(result.error);
          return;
        }
      }
      setSettings({ id: 1, ...value });
      setToast("บันทึกช่วงเวลาให้บริการแล้ว");
    });
  }
  if (role === "manager") {
    return (
      <ManagerWorkspace
        profile={actor}
        demo={demo}
        demoRecords={demo ? items : undefined}
        onRoleChange={demo ? switchRole : undefined}
        stats={demo ? summarizeManagerStats(items) : null}
      />
    );
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
        className={twMerge(
          "fixed inset-0 z-[39] cursor-pointer border-0 bg-[#24163666] transition-opacity duration-300 motion-reduce:transition-none desk:hidden",
          mobileVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-label="ปิดเมนู"
        aria-hidden={!mobileVisible}
        tabIndex={mobileVisible ? 0 : -1}
        onClick={() => setMobile(false)}
      />
      <aside
        id="role-aside"
        ref={asideRef}
        onTransitionEnd={onTransitionEnd}
        className={twMerge(
          styles.sidebar,
          "fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col border-r border-line bg-white px-[19px] pt-[30px] max-roomy:w-[220px] max-roomy:px-[13px] max-wide:w-[205px] max-wide:px-2.5 max-desk:w-[245px] max-desk:px-[18px] max-desk:duration-300 max-desk:ease-out motion-reduce:transition-none",
          mobilePhase === "idle"
            ? mobile
              ? "max-desk:translate-x-0 max-desk:transition-transform"
              : "max-desk:-translate-x-full max-desk:transition-transform"
            : `max-desk:translate-x-[var(--sidebar-offset)] ${mobilePhase === "dragging" ? "max-desk:transition-none" : "max-desk:transition-transform"}`,
        )}
      >
        <a
          href={demo ? "/demo" : role === "admin" ? "/dashboard/admin" : "/dashboard"}
          className="focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 mx-2 flex items-center gap-[11px] text-2xl leading-[1.2] font-[650] tracking-[-0.5px] [&_b]:font-normal [&_b]:text-brand [&_small]:mt-[7px] [&_small]:block [&_small]:text-[8px] [&_small]:font-medium [&_small]:tracking-[1.4px] [&_small]:text-[#9a90ac] max-wide:text-[21px] max-wide:[&_small]:text-[7px] max-desk:text-2xl"
        >
          <Image
            src="/icon.svg"
            alt="โรงเรียนเมืองสุราษฎร์ธานี"
            width={45}
            height={45}
            className="ring-2 ring-white shadow-sm"
          />
          <span>
            MST <b>GRS</b>
            <small className="text-xs">GRADE RECOVERY SYSTEM</small>
          </span>
        </a>
        <div className="mx-2.5 mt-5 mb-[30px] border-b border-line pb-[25px] text-sm text-secondary">
          ระบบแก้ไขผลการเรียน
        </div>
        <div className="mx-[15px] mb-3 text-xs text-secondary">
          {roles[role]}
        </div>
        <nav aria-label="เมนูหลัก">
          {available.map((v) => {
            const Icon =
              v === "student-lifecycle" || v === "students" || v === "teachers" || v === "academics" || v === "managers"
                ? UsersRound
                : v === "overview"
                ? LayoutDashboard
                : v === "outstanding"
                  ? ClipboardList
                : v === "history"
                  ? History
                  : v === "export"
                    ? Download
                    : v === "import"
                      ? Upload
                      : Settings2;
            return (
              <button
                className={twMerge(
                  "cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3",
                  twMerge(
                    "mb-[7px] flex w-full items-center gap-[11px] border-0 bg-transparent px-3.5 py-[13px] text-left text-sm leading-[1.65] text-[#81788e] hover:bg-[#f7f3fc] [&_svg]:shrink-0 [&_b]:ml-auto [&_b]:grid [&_b]:h-5 [&_b]:min-w-5 [&_b]:place-items-center [&_b]:rounded-[5px] [&_b]:bg-brand [&_b]:text-[10px] [&_b]:text-white max-wide:gap-2 max-wide:px-2.5 max-wide:text-xs max-desk:text-sm",
                    view === v && "bg-brand-soft font-semibold text-brand",
                  ),
                )}
                aria-current={view === v ? "page" : undefined}
                title={v === "overview" ? role === "student" ? "ผลการเรียนของฉัน" : role === "teacher" ? "คำร้องของนักเรียน" : "รายการรออนุมัติ" : navTitles[v]}
                onClick={() => navigate(v)}
                key={v}
              >
                <Icon size={20} />
                <span>
                  {v === "overview"
                    ? role === "student"
                      ? "ผลการเรียนของฉัน"
                      : role === "teacher"
                        ? "คำร้องของนักเรียน"
                        : "รายการรออนุมัติ"
                    : v === "export"
                      ? "ส่งออกข้อมูล"
                      : v === "import"
                        ? "นำเข้าข้อมูล"
                        : navTitles[v]}
                </span>
                {v === "overview" && awaiting.length > 0 && (
                  <b>{awaiting.length}</b>
                )}
              </button>
            );
          })}
        </nav>
        <div className={styles.school}><strong>โรงเรียนเมืองสุราษฎร์ธานี</strong><p>ระบบแก้ไขผลการเรียนคงค้าง<br />ติดตามทุกขั้นตอนในที่เดียว</p></div>
        <div className="-mx-[19px] flex items-center gap-[9px] border-t border-line px-[17px] py-5 [&>div]:min-w-0 [&>div]:flex-1 [&_strong]:block [&_strong]:truncate [&_strong]:text-md [&_small]:text-xs [&_small]:text-muted max-roomy:-mx-[13px] max-roomy:px-[13px] max-wide:-mx-2.5 max-desk:-mx-[18px]">
          <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#ece3f9] font-semibold text-brand">
            {actor.full_name.slice(0, 1)}
          </span>
          <div>
            <strong className="font-semibold font-[Sarabun]">{actor.full_name}</strong>
            {role === "teacher" && <small className="block leading-5" title={actor.learning_subject_group || "ยังไม่ระบุกลุ่มสาระการเรียนรู้"}>{actor.learning_subject_group || "ยังไม่ระบุกลุ่มสาระการเรียนรู้"}</small>}
            <small className="text-md font-[Sarabun]">{roles[role]}</small>
          </div>
          <button
            className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex size-[34px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-1.5 text-muted enabled:hover:bg-brand-soft enabled:hover:text-brand"
            aria-label={loggingOut ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}
            disabled={loggingOut}
            onClick={logout}
          >
            {loggingOut ? (
              <Loader2 size={19} className="animate-spin text-brand" />
            ) : (
              <LogOut size={19} />
            )}
          </button>
        </div>
        <button className={styles.tabletLogout} onClick={logout} disabled={loggingOut} aria-label="ออกจากระบบ" title="ออกจากระบบ"><LogOut size={20} /></button>
      </aside>
      <div className={styles.shell}>
        <header className={`${styles.topbar} ${styles.mobileTopbar} flex h-[77px] items-center justify-between gap-5 border-b border-line bg-white px-9 max-roomy:px-6 max-desk:h-[66px] max-desk:gap-2.5 max-desk:px-4`}>
          <div className="flex items-center gap-3 text-xs text-[#a49bad] [&_strong]:font-[450] [&_strong]:text-[#776b87] max-desk:gap-1.5 max-desk:text-[11px] max-desk:[&>span]:hidden max-desk:[&>svg]:hidden">
            <button
              className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 size-[34px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-1.5 text-muted enabled:hover:bg-brand-soft enabled:hover:text-brand hidden max-desk:inline-flex"
              aria-label="เปิดเมนู"
              aria-controls="role-aside"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>{roles[role]}</span>
            <ChevronRight size={14} />
            <strong className="font-semibold">{navTitles[view]}</strong>
          </div>
          <div className="flex items-center gap-5 max-desk:gap-2.5">
            <span
              className={twMerge(
                "flex items-center gap-[7px] text-xs whitespace-nowrap [&>span]:size-1.5 [&>span]:rounded-full max-desk:text-[10px]",
                open
                  ? "text-[#598472] [&>span]:bg-[#39a782]"
                  : "text-[#a58356] [&>span]:bg-[#c79754]",
              )}
            >
              <span />
              {open ? "ระบบเปิดให้บริการ" : "ระบบปิดให้บริการ"}
            </span>
            <span className="h-6 w-px bg-line max-desk:hidden" />
            <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#ece3f9] font-semibold text-brand size-8">
              {actor.full_name.slice(0, 1)}
            </span>
            {role === "teacher" && <div className="hidden max-desk:block max-w-40 text-right"><strong className="block truncate text-xs">{actor.full_name}</strong><small className="block text-[10px] text-secondary">{actor.learning_subject_group || "ยังไม่ระบุกลุ่มสาระการเรียนรู้"}</small></div>}
          </div>
        </header>
        {demo && (
          <div className="flex items-center gap-2 border-b border-[#f1e4c6] bg-[#fff8e9] px-[35px] py-[7px] text-xs text-[#846527] [&_label]:m-0 [&_label]:ml-auto [&_label]:flex [&_label]:items-center [&_label]:gap-2 [&_label]:text-xs [&_select]:border-[#ecddb8] [&_select]:bg-[#fffcf5] [&_select]:px-1.5 [&_select]:py-[3px] [&_select]:text-xs [&_select]:text-[#896b38] [&_a]:ml-4 [&_a]:flex [&_a]:items-center [&_a]:gap-1 max-wide:flex-wrap max-wide:px-6 max-wide:py-2 max-wide:[&_label]:ml-0 max-wide:[&>span]:flex-1 max-wide:[&_a]:ml-auto max-desk:gap-1.5 max-desk:px-4 max-desk:[&>span]:text-[10px] max-desk:[&>svg]:w-3.5 max-desk:[&_label]:text-[10px] max-desk:[&_select]:text-[11px] max-desk:[&_a]:text-[10px]">
            <Info size={16} />
            <span>โหมดทดลอง · ข้อมูลสมมติ ไม่บันทึกลงฐานข้อมูล</span>
            <label className="mt-4 mb-2 block font-[550]">
              ทดลองบทบาท{" "}
              <select
                className="max-w-full rounded-lg border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115]"
                value={role}
                onChange={(e) => switchRole(e.target.value as Role)}
              >
                {(Object.keys(roles) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {roles[r]}
                  </option>
                ))}
              </select>
            </label>
            <a
              className="focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3"
              href="/"
            >
              เข้าสู่ระบบจริง <ArrowRight size={14} />
            </a>
          </div>
        )}
        <main className={styles.page}>
          <div className={styles.heading}>
            <div>
              <h1 className="text-[29px] leading-normal font-[650] tracking-[-0.5px] font-thai">
                {view === "overview"
                  ? role === "student"
                    ? "ผลการเรียนของฉัน"
                    : role === "teacher"
                      ? "คำร้องของนักเรียน"
                      : "รายการรออนุมัติ"
                  : navTitles[view]}
              </h1>
            </div>
            {view !== "schedule" && view !== "import" && view !== "students" && view !== "teachers" && view !== "academics" && view !== "managers" && view !== "student-lifecycle" && (
              <div className="flex w-full flex-wrap items-center gap-3 desk:w-auto">
                <div className="relative flex min-w-[174px] flex-1 items-center gap-2 border border-[#e5e0ec] bg-white px-[11px] py-2 text-gray-600 focus-within:outline-1 focus-within:outline-gray-500 desk:flex-none">
                  <CalendarDays className="shrink-0" size={17} />
                  <span className="min-w-0 flex-1 truncate py-0.5 text-sm">
                    {year === "all" ? "ทุกปีการศึกษา" : `ปีการศึกษา ${year}`}
                  </span>
                  <ChevronDown className="shrink-0" size={15} />
                  <select
                    className="absolute inset-0 z-10 h-full w-full appearance-none opacity-0"
                    aria-label="ปีการศึกษา"
                    value={year}
                    onChange={(e) => {
                      setYear(e.target.value);
                      setSemester("all");
                    }}
                  >
                    <option value="all">ทุกปีการศึกษา</option>
                    {[...new Set(visibleScope.map((r) => r.academic_year))]
                      .sort((a, b) => b - a)
                      .map((y) => (
                        <option key={y} value={y}>
                          ปีการศึกษา {y}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="relative flex min-w-[154px] flex-1 items-center gap-2 border border-[#e5e0ec] bg-white px-[11px] py-2 text-gray-600 focus-within:outline-1 focus-within:outline-gray-500 desk:flex-none">
                  <span className="min-w-0 flex-1 truncate py-0.5 text-sm">
                    {semester === "all"
                      ? "ทุกภาคเรียน"
                      : `ภาคเรียนที่ ${semester}`}
                  </span>
                  <ChevronDown className="shrink-0" size={15} />
                  <select
                    className="absolute inset-0 z-10 h-full w-full appearance-none opacity-0"
                    aria-label="ภาคเรียน"
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                  >
                    <option value="all">ทุกภาคเรียน</option>
                    <option value="1">ภาคเรียนที่ 1</option>
                    <option value="2">ภาคเรียนที่ 2</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className={twMerge(styles.columns, role === "admin" && styles.adminColumns)}>
          <div className={styles.content}>
          {!open && role !== "admin" && view !== "history" ? (
            <div className="rounded-[14px] border border-line bg-white px-[25px] py-[60px] text-center text-[#9481aa] [&>svg]:mx-auto [&_h2]:m-[15px] [&_h2]:text-ink [&>div]:m-5 [&>div]:text-sm max-desk:px-4 max-desk:py-10 max-desk:[&_h2]:text-[19px]">
              <Clock3 size={42} />
              <h2 className="text-lg leading-normal font-[650]">
                อยู่นอกช่วงเวลาให้บริการ
              </h2>
              <p>{settings.notice}</p>
              <button className="mt-4 rounded-lg bg-brand px-4 py-2 text-white" onClick={() => navigate("history")}>เปิดประวัติการแก้ไข</button>
              <p className="mt-3 text-sm">ประวัติเปิดอ่านได้ตลอดเวลา รายการที่แก้สำเร็จจะย้ายเข้าประวัติอัตโนมัติหลังถึงเวลาปิด</p>
              <div>
                เปิด {thaiDate(settings.opens_at)}
                <br />
                ปิด {thaiDate(scheduleClosingDisplay(settings.closes_at))}
              </div>
            </div>
          ) : (
            <>
              {view === "history" && (
                <div className="mb-5 rounded-xl border border-line bg-white p-4 text-sm text-secondary">
                  <p>ประวัติการแก้ไขจะเก็บเมื่อถึงเวลาปิดระบบ · เปิดอ่านได้ตลอดเวลา</p>
                </div>
              )}
              {role === "admin" && view === "students" && <AdminStudents demo={demo} onManageYear={() => setView("student-lifecycle")} />}
              {role === "admin" && view === "student-lifecycle" && <AdminStudentLifecycle demo={demo} onImport={() => setView("students")} />}
              {role === "admin" && view === "teachers" && <AdminTeachers demo={demo} currentUserId={actor.id} />}
              {role === "admin" && view === "managers" && <AdminManagers demo={demo} currentUserId={actor.id} />}
              {role === "admin" && view === "academics" && <AdminAcademics demo={demo} currentUserId={actor.id} />}
              {view !== "schedule" && view !== "import" && view !== "history" && view !== "students" && view !== "teachers" && view !== "academics" && view !== "managers" && view !== "student-lifecycle" && (
                <>
                  <section className={styles.hero}>
                    <div>
                      <h2 className="text-lg leading-normal font-[650]">
                        {role === "student"
                          ? `สวัสดี ${actor.full_name}`
                          : role === "teacher"
                            ? `สวัสดี ${actor.full_name}`
                            : "ศูนย์ตรวจสอบผลการเรียน"}
                      </h2>
                      <p>
                        {role === "student" ? (
                          <span className="text-[15px] flex gap-3 items-center">
                            <span>รหัสนักเรียน {actor.student_code}</span>
                            <i />
                            {actor.classroom}
                          </span>
                        ) : role === "teacher" ? (
                          "แสดงเฉพาะคำร้องที่นักเรียนยื่นแล้วในรายวิชาของคุณ"
                        ) : view === "outstanding" ? (
                          "ติดตามผลการเรียนที่ยังแก้ไขไม่เสร็จสิ้นทุกสถานะ"
                        ) : (
                          "ยืนยันการแก้ไขผลการเรียนหลังครูประจำวิชาอนุมัติ"
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-[13px] border-l border-[#dfd0ee] py-2 pr-1.5 pl-7 text-[#9c7abd] [&_small]:block [&_small]:text-md [&_small]:text-[#806196] [&_strong]:mt-[3px] [&_strong]:block [&_strong]:text-lg [&_strong]:text-[#664587]">
                      <CalendarDays size={20} />
                      <div>
                        <small className="text-sm">กำหนดปิดรับดำเนินการ</small>
                        <strong className="font-semibold">
                          {thaiDate(scheduleClosingDisplay(settings.closes_at))}
                        </strong>
                      </div>
                    </div>
                  </section>
                  <section className={styles.metrics} aria-label="ภาพรวมผลการเรียน">
                    <Stat
                      title="รายวิชาทั้งหมด"
                      value={scope.length}
                      unit="รายวิชา"
                      icon={<BookOpen size={21} />}
                      tone="purple"
                      detail="ผลการเรียนในระบบ"
                    />
                    <Stat
                      title="ต้องดำเนินการ"
                      value={awaiting.length}
                      unit="รายวิชา"
                      icon={<ClipboardList size={21} />}
                      tone="amber"
                      detail={
                        role === "student"
                          ? "รอยื่นคำร้องแก้ไขผลการเรียน"
                          : "รอการดำเนินการจากคุณ"
                      }
                    />
                    <Stat
                      title="อยู่ระหว่างดำเนินการ"
                      value={
                        outstanding.filter((r) => r.status !== "pending").length
                      }
                      unit="รายวิชา"
                      icon={<Clock3 size={21} />}
                      tone="blue"
                      detail="ยื่นคำร้องและกำลังแก้ไข"
                    />
                    <Stat
                      title="แก้ไขสำเร็จแล้ว"
                      value={completed.length}
                      unit="รายวิชา"
                      icon={<FileCheck2 size={21} />}
                      tone="green"
                      detail="ฝ่ายวิชาการอนุมัติแล้ว"
                    />
                  </section>
                </>
              )}
              {(view === "overview" ||
                view === "outstanding" ||
                view === "history" ||
                view === "export") && (
                <section className={styles.tableCard}>
                  <div className="flex items-center justify-between gap-[18px] px-6 pt-[23px] pb-[17px] [&_h2]:flex [&_h2]:items-center [&_h2]:gap-[9px] [&_h2]:text-base [&_p]:mt-[5px] [&_p]:text-sm [&_p]:text-secondary max-desk:flex-col max-desk:items-start max-desk:px-[17px] max-desk:pt-5 max-desk:pb-[15px] max-desk:[&_h2]:text-[15px] max-desk:[&_p]:text-xs">
                    <div>
                      <h2 className="text-lg leading-normal font-[650]">
                        {view === "outstanding"
                          ? "รายการผลการเรียนคงค้าง"
                          : view === "history"
                          ? "ประวัติการแก้ไข"
                          : view === "export"
                            ? role === "academic"
                              ? "ผลการเรียนที่แก้ไขสำเร็จ"
                              : "นักเรียนที่มีผลการเรียนคงค้าง"
                            : role === "student"
                              ? "รายการผลการเรียนคงค้าง"
                              : role === "teacher"
                                ? "คำร้องที่ต้องติดตาม"
                                : "รอตรวจสอบและอนุมัติ"}{" "}
                        <span className="ml-2 px-2 min-w-6 items-center font-[650] justify-center rounded-md bg-brand-soft font-medium text-[#8a5fc7]">
                          {filtered.length} รายการ
                        </span>
                      </h2>
                      <p>
                        {view === "outstanding"
                          ? ""
                          : view === "export"
                          ? "ไฟล์ CSV รองรับการเปิดใน Microsoft Excel"
                          : view === "history"
                            ? "ค้นหาและดูรายละเอียดผลการเรียนที่ย้ายเข้าประวัติแล้ว"
                            : "ตรวจสอบรายละเอียดและดำเนินการตามสถานะของแต่ละรายวิชา"}
                      </p>
                    </div>
                    {(view === "export" || view === "history" && role !== "student") && (
                      <button
                        className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] border border-transparent px-[18px] py-[11px] font-[550] whitespace-nowrap bg-brand text-white shadow-[0_3px_6px_#713cd112] enabled:hover:bg-brand/90 enabled:hover:shadow-[0_3px_12px_#713cd126]"
                        onClick={exportData}
                        disabled={!filtered.length}
                      >
                        <Download size={17} /> ส่งออก {filtered.length} รายการ
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-[13px] px-6 pb-[21px] max-desk:flex-wrap max-desk:gap-2 max-desk:px-4 max-desk:pb-[17px]">
                    <div className="flex max-w-[390px] flex-1 items-center gap-2.5 border border-[#e9e4ef] px-3 text-[#b3a8bf] focus-within:border-[#a97ddf] [&_input]:min-w-0 [&_input]:w-full [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0 [&_input]:py-[9px] [&_input]:text-sm [&_input]:shadow-none [&_input]:placeholder:text-[#8e819b] max-desk:max-w-none max-desk:basis-full max-desk:[&_input]:text-[13px]">
                      <Search size={18} />
                      <input
                        className="max-w-full border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand"
                        aria-label="ค้นหารายการ"
                        placeholder={
                          role === "student"
                            ? "ค้นหารหัสวิชา หรือชื่อวิชา…"
                            : "ค้นหาชื่อนักเรียน รหัสนักเรียน หรือรายวิชา…"
                        }
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    {role !== "academic" && view !== "history" && (
                      <div className="relative max-w-full">
                        <select
                          className="min-w-[153px] max-w-full appearance-none border border-[#e1dce9] bg-white py-[9px] pr-10 pl-[13px] text-sm text-[#796788] outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] max-desk:min-w-0 max-desk:py-2 max-desk:text-[13px]"
                          aria-label="กรองสถานะ"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">สถานะทั้งหมด</option>
                          {Object.entries(statuses).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#796788]"
                          size={15}
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto [&_tbody_tr]:hover:bg-[#fdfbff] max-desk:[&_table]:min-w-[800px]">
                    <table className={`${styles.records} w-full border-collapse text-left`}>
                      <thead>
                        <tr>
                          <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                            {role === "student"
                              ? "รายวิชา"
                              : "นักเรียน / รายวิชา"}
                          </th>
                          <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                            {role === "student" ? "ครูประจำวิชา" : "ชั้น/ห้อง"}
                          </th>
                          <th className="border-y border-line text-center bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                            ผลการเรียนเดิม
                          </th>
                          <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                            ความคืบหน้า
                          </th>
                          <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                            การดำเนินการ
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => {
                          const s = statuses[r.status];
                          const disabled =
                            role === "student"
                              ? !["pending", "assigned"].includes(r.status)
                              : !nextStatus[role]?.[r.status] &&
                                !(role === "teacher" && view === "overview" &&
                                  ["teacher_approved", "completed"].includes(r.status));
                          return (
                            <tr key={r.id}>
                              <td data-label="รายวิชา" className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                <div className="flex items-center gap-3 [&_strong]:block [&_strong]:text-sm [&_strong]:font-[550] [&_strong]:text-[#4b3a5b] [&_small]:mt-[3px] [&_small]:block [&_small]:min-w-[180px] [&_small]:text-xs [&_small]:whitespace-normal [&_small]:text-secondary [&_small_span]:mx-[5px] [&_small_span]:text-[#d4c9de]">
                                  <span
                                    className={twMerge(
                                      "grid size-[39px] shrink-0 place-items-center rounded-[9px] border border-[#eee6f8] bg-[#f5f0fc] text-[#a384cb]",
                                      r.status === "completed" &&
                                        "border-[#e4f2e9] bg-[#f0f9f4] text-[#68a58c]",
                                    )}
                                  >
                                    <BookOpen size={21} />
                                  </span>
                                  <div>
                                    {role !== "student" && (
                                      <strong className="font-semibold">
                                        {r.student_name}{" "}
                                        <small className="text-xs [&&]:ml-1 [&&]:inline [&&]:min-w-0 [&&]:text-[10px] [&&]:font-normal">
                                          {r.student_code}
                                        </small>
                                      </strong>
                                    )}
                                    <strong className="font-semibold">
                                      {r.course_name}
                                    </strong>
                                    <small className="text-xs">
                                      {r.course_code} <span>·</span>{" "}
                                      {r.credits.toFixed(1)} หน่วยกิต{" "}
                                      <span>·</span> {r.semester}/
                                      {r.academic_year}
                                    </small>
                                    {view === "history" && <small className="text-xs text-secondary">เก็บเข้าประวัติ {thaiDate((r as ArchivedGradeRecord).archived_at, true)}</small>}
                                  </div>
                                </div>
                              </td>
                              <td data-label={role === "student" ? "ครูประจำวิชา" : "ชั้น/ห้อง"} className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                {role === "student" ? (
                                  <>
                                    <span>{r.teacher_name.join(", ")}</span>
                                    <small className="text-xs block text-muted">
                                      ชั้น {r.classroom}
                                    </small>
                                  </>
                                ) : (
                                  r.classroom
                                )}
                              </td>
                              <td data-label="ผลการเรียนเดิม" className="border-b border-[#f0edf5] px-[22px] py-[21px] text-center align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 large:py-[23px]">
                                <span className="inline-grid h-[30px] min-w-[30px] place-items-center rounded-[7px] bg-[#fff0f0] px-1.5 font-semibold text-[#c2656f]">
                                  {r.original_grade}
                                </span>
                                {r.status === "completed" && (
                                  <small className="mt-2 block text-xs text-status-green">
                                    ผลใหม่ {r.final_grade}
                                  </small>
                                )}
                              </td>
                              <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                <div className="mb-2 flex min-w-[156px] items-center justify-between gap-3 text-xs [&_strong]:font-numeric [&_strong]:text-xs [&_strong]:font-medium [&_strong]:text-[#776783]">
                                  <span
                                    className={
                                      s.tone === "gray"
                                        ? "text-[#81738f]"
                                        : s.tone === "purple"
                                          ? "text-[#7542b5]"
                                          : s.tone === "amber"
                                            ? "text-[#986814]"
                                            : s.tone === "blue"
                                              ? "text-[#396f9f]"
                                              : s.tone === "green"
                                                ? "text-[#287e63]"
                                                : ""
                                    }
                                  >
                                    {s.label}
                                  </span>
                                  <strong className="font-semibold">
                                    {s.progress}%
                                  </strong>
                                </div>
                                <div
                                  className="h-[5px] overflow-hidden rounded bg-[#f0ecf5]"
                                  role="progressbar"
                                  aria-label={`ความคืบหน้า ${r.course_name}`}
                                  aria-valuenow={s.progress}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <span
                                    className={twMerge(
                                      "block h-full rounded transition-[width] duration-400 motion-reduce:transition-none",
                                      s.tone === "gray"
                                        ? "bg-[#ad8cde]"
                                        : s.tone === "purple"
                                          ? "bg-[#ad8cde]"
                                          : s.tone === "amber"
                                            ? "bg-[#e4bd6b]"
                                            : s.tone === "blue"
                                              ? "bg-[#82addb]"
                                              : s.tone === "green"
                                                ? "bg-[#73b9a0]"
                                                : "",
                                      s.progress === 0
                                        ? "w-0"
                                        : s.progress === 25
                                          ? "w-1/4"
                                          : s.progress === 50
                                            ? "w-1/2"
                                            : s.progress === 75
                                              ? "w-3/4"
                                              : s.progress === 100
                                                ? "w-full"
                                                : "",
                                    )}
                                  />
                                </div>
                              </td>
                              <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                {view === "export" || view === "history" || view === "outstanding" ? (
                                  <button
                                    className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] border font-[550] whitespace-nowrap border-[#e3ddea] bg-white text-[#625670] enabled:hover:bg-[#f8f5fc] px-3 py-[7px]"
                                    onClick={() => show(r)}
                                  >
                                    ดูรายละเอียด
                                    <ArrowUpRight size={15} />
                                  </button>
                                ) : (
                                  <button
                                    className={twMerge(
                                      "cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3",
                                      twMerge(
                                        "inline-flex min-w-[118px] items-center justify-center gap-[7px] border border-[#d9c3f0] bg-[#f2eafb] px-3 py-2 text-sm text-[#713bb5] enabled:hover:bg-[#eee3fc]",
                                        disabled &&
                                          "border-[#ede9f2] bg-[#faf9fc] text-[#b7acbf] disabled:opacity-100",
                                      ),
                                    )}
                                    disabled={disabled || busy}
                                    onClick={() => show(r)}
                                  >
                                    {r.status === "completed" && (
                                      <Check size={15} />
                                    )}{" "}
                                    {actionLabel(r)}
                                    {!disabled && <ArrowUpRight size={15} />}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!shown.length && (
                      <div className="px-5 py-[50px] text-center text-[#b1a1c1] [&>svg]:mx-auto [&_h3]:mt-3 [&_h3]:mb-[5px] [&_h3]:text-[#847292] [&_p]:text-[13px]">
                        <FileCheck2 size={36} />
                        <h3 className="text-base leading-normal font-[650]">
                          {query || filter !== "all"
                            ? "ไม่พบรายการที่ตรงกับการค้นหา"
                            : "ยังไม่มีรายการในหน้านี้"}
                        </h3>
                        <p>
                          {view === "history" ? "รายการที่แก้สำเร็จจะเข้าประวัติเมื่อถึงเวลาปิดระบบ" : role === "teacher"
                            ? "คำร้องจะแสดงเมื่อนักเรียนยื่นคำร้องเข้ามาแล้ว"
                            : role === "academic"
                              ? "รายการจะแสดงตามขั้นตอนการอนุมัติของระบบ"
                              : "เมื่อมีข้อมูล รายการจะแสดงที่นี่"}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-[23px] py-[13px] text-xs text-secondary [&>div]:flex [&>div]:items-center [&>div]:gap-2 max-desk:px-4 max-desk:py-3 max-desk:text-[11px]">
                    <span>
                      แสดง{" "}
                      {filtered.length
                        ? (Math.min(page, pages) - 1) * 8 + 1
                        : 0}
                      –{Math.min(Math.min(page, pages) * 8, filtered.length)}{" "}
                      จาก {filtered.length} รายการ
                    </span>
                    <div>
                      <button
                        className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex size-[34px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-1.5 text-muted enabled:hover:bg-brand-soft enabled:hover:text-brand"
                        aria-label="หน้าก่อนหน้า"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <span className="grid size-[27px] place-items-center rounded-md border border-[#e8def4] bg-[#f8f3fe] text-[#9a72cd]">
                        {Math.min(page, pages)}
                      </span>
                      <button
                        className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex size-[34px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-1.5 text-muted enabled:hover:bg-brand-soft enabled:hover:text-brand"
                        aria-label="หน้าถัดไป"
                        disabled={page >= pages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                </section>
              )}
              {view === "overview" && (
                <section className="mt-[25px] rounded-xl border border-line bg-white px-[26px] py-[22px] max-desk:p-5">
                  <div className="flex items-center justify-between gap-4 [&_h2]:text-sm [&>span]:text-xs [&>span]:text-[#aa9fb6] max-wide:[&>span]:hidden">
                    <h2 className="text-lg leading-normal font-[650]">
                      ขั้นตอนการแก้ไขผลการเรียน
                    </h2>
                    <span>ติดตามได้ตั้งแต่เริ่มต้นจนสำเร็จ</span>
                  </div>
                  <div className="mt-6 grid grid-cols-5 max-wide:gap-3 max-desk:mt-5 max-desk:grid-cols-1 max-desk:gap-0">
                    {[
                      ["0%", "ยื่นคำร้อง", "เลือกวิชาที่ต้องการแก้ไข"],
                      ["25%", "รอมอบหมายงาน", "ครูประจำวิชากำหนดภาระงาน"],
                      ["50%", "ดำเนินการแก้ไข", "ทำงานตามที่ได้รับมอบหมาย"],
                      [
                        "75%",
                        "ส่งงานและรออนุมัติ",
                        "ครูตรวจรับและเสนอฝ่ายวิชาการ",
                      ],
                      ["100%", "แก้ไขสำเร็จ", "ฝ่ายวิชาการยืนยันผลการเรียน"],
                    ].map(([percent, title, detail], i) => (
                      <div
                        key={percent}
                        className="relative pr-2.5 [&_strong]:block [&_strong]:text-xs [&_strong]:font-medium [&_strong]:text-[#6c527e] [&_small]:mt-[3px] [&_small]:block [&_small]:text-xs [&_small]:text-secondary [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:top-3.5 [&:not(:last-child)]:after:right-[13px] [&:not(:last-child)]:after:left-10 [&:not(:last-child)]:after:border-t [&:not(:last-child)]:after:border-dashed [&:not(:last-child)]:after:border-[#e2d7f0] [&:not(:last-child)]:after:content-[''] max-roomy:[&_small]:text-[10px] max-roomy:[&_strong]:text-[11px] max-wide:[&_small]:hidden max-desk:grid max-desk:grid-cols-[38px_1fr] max-desk:items-start max-desk:gap-x-2.5 max-desk:pr-0 max-desk:pb-[18px] max-desk:last:pb-0 max-desk:[&_strong]:text-[13px] max-desk:[&_small]:col-start-2 max-desk:[&_small]:block max-desk:[&_small]:text-[11px] max-desk:[&:not(:last-child)]:after:top-[29px] max-desk:[&:not(:last-child)]:after:right-auto max-desk:[&:not(:last-child)]:after:bottom-0 max-desk:[&:not(:last-child)]:after:left-3.5 max-desk:[&:not(:last-child)]:after:border-t-0 max-desk:[&:not(:last-child)]:after:border-l"
                      >
                        <div
                          className={twMerge(
                            "mb-3 grid size-[29px] place-items-center rounded-full border border-[#e2d6f3] bg-[#f7f3fd] text-[11px] text-[#a180ca] max-desk:row-span-2 max-desk:m-0",
                            i === 4 &&
                              "border-[#dceee5] bg-[#eef8f4] text-[#7bb59c]",
                          )}
                        >
                          {i === 4 ? <Check size={17} /> : i + 1}
                        </div>
                        <span className="absolute top-1 right-[15px] z-[1] bg-white px-[5px] text-xs text-[#8d779f] max-wide:hidden">
                          {percent}
                        </span>
                        <strong className="font-semibold">{title}</strong>
                        <small className="text-xs">{detail}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {view === "import" && (
                <>
                  {!open && (
                    <p className="mb-4 rounded-lg border border-[#f1dfb8] bg-[#fff8e9] p-4 text-sm text-[#886628]">
                      ระบบยังไม่เปิดรับการนำเข้าข้อมูล ตั้งวันที่เปิดระบบในเมนูตั้งค่าเวลาเปิด–ปิดระบบก่อน
                    </p>
                  )}
                  <section className={styles.tableCard}>
                    <div className="flex items-center justify-between gap-[18px] px-6 pt-[23px] pb-[17px] [&_h2]:flex [&_h2]:items-center [&_h2]:gap-[9px] [&_h2]:text-base [&_p]:mt-[5px] [&_p]:text-sm [&_p]:text-secondary max-desk:flex-col max-desk:items-start max-desk:px-[17px] max-desk:pt-5 max-desk:pb-[15px] max-desk:[&_h2]:text-[15px] max-desk:[&_p]:text-xs">
                      <div>
                        <h2 className="text-lg leading-normal font-[650]">
                          นำเข้าจากไฟล์ผลการเรียน
                        </h2>
                        <p>
                          รองรับ Excel (.xlsx), CSV และ TSV · ไม่เกิน 2,000 แถวต่อครั้ง
                        </p>
                      </div>
                      <button
                        className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] rounded-lg border px-[18px] py-[11px] font-[550] whitespace-nowrap border-[#e3ddea] bg-white text-[#625670] enabled:hover:bg-[#f8f5fc]"
                        onClick={() =>
                          saveCsv(
                            "MST-GRS-template.csv",
                            Object.keys(columns),
                            [],
                          )
                        }
                      >
                        <Download size={16} /> ดาวน์โหลดแม่แบบ
                      </button>
                    </div>
                    <button
                      className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 mx-6 mt-2 mb-6 flex w-[calc(100%-48px)] flex-col items-center justify-center rounded-xl border-[1.5px] border-dashed border-[#d6c2f0] bg-[#fcfaff] px-5 py-[38px] text-[#795a9e] [&_h3]:mt-[15px] [&_h3]:mb-[5px] [&_h3]:max-w-full [&_h3]:wrap-anywhere [&_p]:mb-[19px] [&_p]:text-xs [&_p]:text-[#b0a1be] max-desk:mx-4 max-desk:mt-1.5 max-desk:mb-5 max-desk:w-[calc(100%-32px)] max-desk:px-3 max-desk:py-[26px] max-desk:[&_h3]:text-sm"
                      onClick={() => fileInput.current?.click()}
                      disabled={reading || busy}
                    >
                      <span className="grid size-14 place-items-center rounded-[15px] bg-[#f0e7fc] text-[#a179d1]">
                        <Upload size={27} />
                      </span>
                      <h3 className="text-base leading-normal font-[650]">
                        {reading
                          ? "กำลังตรวจสอบไฟล์…"
                          : fileName || "เลือกไฟล์ผลการเรียนที่ต้องการนำเข้า"}
                      </h3>
                      <p>คลิกเพื่อเลือกไฟล์จากเครื่องของคุณ</p>
                      <span className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] rounded-lg border px-[18px] py-[11px] font-[550] whitespace-nowrap border-[#e3ddea] bg-white text-[#625670] enabled:hover:bg-[#f8f5fc]">
                        เลือกไฟล์
                      </span>
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".xlsx,.csv,.tsv"
                      className="max-w-full rounded-lg border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] sr-only"
                      aria-label="ไฟล์ผลการเรียน"
                      onChange={(e) => readFile(e.target.files?.[0])}
                    />
                    <div className="m-6 flex gap-3 rounded-[10px] bg-[#f8f5fd] px-5 py-[18px] text-[#876c9f] [&>svg]:mt-[3px] [&>svg]:shrink-0 [&_p]:mt-2 [&_p]:text-xs [&_p]:leading-[1.95] [&_p]:text-[#a18bae] max-desk:m-4 max-desk:p-[15px] max-desk:[&_p]:text-[11px]">
                      <Info size={20} />
                      <div>
                        <strong className="font-semibold">
                          บันทึกเฉพาะ 11 คอลัมน์ที่จำเป็น
                        </strong>
                        <p>{Object.keys(columns).join(" · ")}</p>
                        <p>
                          ต้องมีบัญชีนักเรียนและครูในระบบก่อนนำเข้า
                          ชื่อครูทุกคนต้องตรงกับบัญชีและไม่ซ้ำ หากมีหลายคนให้ใช้รูปแบบ
                          1.ชื่อครูคนแรก, 2.ชื่อครูคนที่สอง รองรับผลการเรียน 0, ร,
                          มส, มผ
                        </p>
                        <p>
                          เมื่อเลขนักเรียน รหัสวิชา ปีการศึกษา และภาคเรียนตรงกัน
                          จะเขียนทับรายการปัจจุบัน กลับเป็น Pending และล้างคำร้อง
                          งาน ไฟล์แนบ และผลการเรียนใหม่จากรอบปัจจุบัน
                          โดยเก็บข้อมูลเดิมไว้ย้อนหลัง รายการในหน้าประวัติจะถูกข้าม
                        </p>
                      </div>
                    </div>
                    {fileErrors.length > 0 && (
                      <div
                        className="m-6 rounded-[10px] bg-[#fff4f4] p-[18px] text-xs text-[#bd6771] wrap-anywhere [&_ul]:max-h-[250px] [&_ul]:list-disc [&_ul]:overflow-auto [&_ul]:pl-5 max-desk:m-4"
                        role="alert"
                      >
                        <strong className="font-semibold">
                          พบข้อผิดพลาด {fileErrors.length} รายการ —
                          ยังไม่นำเข้าข้อมูล
                        </strong>
                        <ul>
                          {fileErrors.slice(0, 20).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                        {fileErrors.length > 20 && (
                          <p>และอีก {fileErrors.length - 20} รายการ</p>
                        )}
                      </div>
                    )}
                    {preview.length > 0 && (
                      <>
                        <div className="flex items-center justify-between gap-[18px] px-6 pt-[23px] pb-[17px] [&_h2]:flex [&_h2]:items-center [&_h2]:gap-[9px] [&_h2]:text-base [&_p]:mt-[5px] [&_p]:text-sm [&_p]:text-secondary max-desk:flex-col max-desk:items-start max-desk:px-[17px] max-desk:pt-5 max-desk:pb-[15px] max-desk:[&_h2]:text-[15px] max-desk:[&_p]:text-xs">
                          <div>
                            <h2 className="text-lg leading-normal font-[650]">
                              ตัวอย่างข้อมูล{" "}
                              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-brand-soft text-[11px] font-medium text-[#8a5fc7]">
                                {preview.length}
                              </span>
                            </h2>
                            <p>แสดง 10 รายการแรก กรุณาตรวจสอบก่อนยืนยัน</p>
                          </div>
                          <button
                            className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] rounded-lg border border-transparent px-[18px] py-[11px] font-[550] whitespace-nowrap bg-brand text-white shadow-[0_3px_6px_#713cd112] enabled:hover:bg-[#602cbc] enabled:hover:shadow-[0_3px_12px_#713cd126]"
                            disabled={!open || busy || reading || !!fileErrors.length}
                            onClick={confirmImport}
                          >
                            <FileSpreadsheet size={17} />
                            {busy ? "กำลังนำเข้า…" : "ยืนยันนำเข้าข้อมูล"}
                          </button>
                        </div>
                        <div className="overflow-x-auto [&_tbody_tr]:hover:bg-[#fdfbff] max-desk:[&_table]:min-w-[800px]">
                          <table className="w-full border-collapse text-left whitespace-nowrap">
                            <thead>
                              <tr>
                                <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                                  เลขประจำตัว
                                </th>
                                <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                                  ชื่อ-นามสกุล
                                </th>
                                <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                                  รายวิชา
                                </th>
                                <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                                  ครูผู้สอน
                                </th>
                                <th className="border-y border-line bg-[#faf9fc] px-[22px] py-[13px] text-xs font-medium text-[#796d89] first:pl-6 last:pr-6 last:text-right">
                                  ผลการเรียน
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.slice(0, 10).map((r, i) => (
                                <tr key={i}>
                                  <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                    {r.student_code}
                                  </td>
                                  <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                    {r.student_name}
                                  </td>
                                  <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                    {r.course_code} {r.course_name}
                                  </td>
                                  <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                    {r.teacher_name.join(", ")}
                                  </td>
                                  <td className="border-b border-[#f0edf5] px-[22px] py-[21px] align-middle text-sm text-[#796b89] first:pl-6 last:pr-6 last:text-right large:py-[23px]">
                                    {r.original_grade}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </section>
                  <div className="my-[22px] flex gap-2 text-xs text-[#a38db6] max-desk:items-start max-desk:text-[11px] max-desk:[&_svg]:shrink-0">
                    <ShieldCheck size={17} />{" "}
                    คอลัมน์คะแนนและข้อมูลอื่นนอกเหนือจาก 11
                    คอลัมน์จะไม่ถูกส่งไปบันทึกในฐานข้อมูล
                  </div>
                </>
              )}
              {role === "admin" && view === "schedule" && (
                <div className={`${styles.scheduleFormLayout} grid grid-cols-[1fr_280px] gap-[22px] max-roomy:grid-cols-1`}>
                  <section className={styles.tableCard}>
                    <div className="flex items-center justify-between gap-[18px] px-6 pt-[23px] pb-[17px] [&_h2]:flex [&_h2]:items-center [&_h2]:gap-[9px] [&_h2]:text-base [&_p]:mt-[5px] [&_p]:text-sm [&_p]:text-secondary max-desk:flex-col max-desk:items-start max-desk:px-[17px] max-desk:pt-5 max-desk:pb-[15px] max-desk:[&_h2]:text-[15px] max-desk:[&_p]:text-xs">
                      <div>
                        <h2 className="text-lg leading-normal font-[650]">
                          ช่วงเวลาให้บริการ
                        </h2>
                        <p>นับตามวันที่ในประเทศไทย เปิดให้ใช้งานได้ตลอดวันปิดที่เลือก</p>
                      </div>
                      <CalendarDays size={24} />
                    </div>
                    <form
                      onSubmit={submitSchedule}
                      className="px-6 pb-[25px] [&>textarea]:w-full max-desk:px-[17px] max-desk:pb-5"
                    >
                      <div className="grid grid-cols-2 gap-[18px] [&_input]:w-full max-desk:grid-cols-1 max-desk:gap-0">
                        <div>
                          <label
                            className="mt-4 mb-2 block font-[550]"
                            htmlFor="opens"
                          >
                            วันที่เปิดระบบ
                          </label>
                          <input
                            className="max-w-full border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115]"
                            required
                            id="opens"
                            type="date"
                            value={opens}
                            onInput={(e) => setOpens(e.currentTarget.value)}
                            onChange={(e) => setOpens(e.target.value)}
                          />
                        </div>
                        <div>
                          <label
                            className="mt-4 mb-2 block font-[550]"
                            htmlFor="closes"
                          >
                            วันที่ปิดระบบ
                          </label>
                          <input
                            className="max-w-full border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115]"
                            required
                            id="closes"
                            type="date"
                            min={opens || undefined}
                            value={closes}
                            onInput={(e) => setCloses(e.currentTarget.value)}
                            onChange={(e) => setCloses(e.target.value)}
                          />
                        </div>
                      </div>
                      <label
                        className="mt-4 mb-2 block font-[550]"
                        htmlFor="notice"
                      >
                        ข้อความแจ้งผู้ใช้งาน
                      </label>
                      <textarea
                        className="max-w-full border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] min-h-[110px] resize-y"
                        id="notice"
                        rows={4}
                        maxLength={1000}
                        value={notice}
                        onChange={(e) => setNotice(e.target.value)}
                      />
                      <div className="my-5 flex items-start gap-2.5 rounded-lg border border-[#e8dff5] bg-[#f6f2fd] p-[15px] text-sm text-[#6b5788] [&>svg]:mt-[3px] [&>svg]:shrink-0">
                        <Info size={18} />
                        <span>
                          เมื่อพ้นวันที่ปิดระบบ รายการที่แก้สำเร็จจะย้ายเข้าประวัติอัตโนมัติ
                          {" "}รายการที่ยังไม่สำเร็จจะกลับเป็นสถานะยังไม่ยื่นคำร้อง และต้องเริ่มดำเนินการใหม่ในรอบถัดไป{" "}
                          นักเรียน ครู และฝ่ายวิชาการยังเปิดอ่านประวัติได้ตลอดเวลา แต่ดำเนินการแก้ผลการเรียนไม่ได้
                          ผู้ดูแลระบบสามารถปรับช่วงเวลาได้จากเมนูตั้งค่าเวลาเปิด–ปิดระบบ
                        </span>
                      </div>
                      <button
                        type="submit"
                        className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] border border-transparent px-[18px] py-[11px] font-[550] whitespace-nowrap bg-brand text-white shadow-[0_3px_6px_#713cd112] enabled:hover:bg-brand/90 enabled:hover:shadow-[0_3px_12px_#713cd126]"
                        disabled={busy}
                      >
                        <Check size={18} />
                        {busy ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
                      </button>
                    </form>
                  </section>
                  <section className="self-start rounded-[13px] border border-[#e4d8f3] bg-[#f0e9fa] p-[27px] text-[#8c709f] [&_h2]:text-base [&_hr]:my-[21px] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[#ddcdeb] [&_p]:mt-[3px] [&_p]:mb-[19px] [&_p]:text-sm [&>div]:text-xs [&>div]:text-[#a28cb4] max-roomy:hidden">
                    <span className="mb-3 grid size-10 place-items-center rounded-[10px] bg-white text-brand">
                      <Clock3 size={25} />
                    </span>
                    <h2 className="text-lg leading-normal font-[650]">
                      สถานะปัจจุบัน
                    </h2>
                    <span
                      className={twMerge(
                        "my-2 block text-[22px]",
                        open ? "text-status-green" : "text-muted",
                      )}
                    >
                      {open ? "เปิดให้บริการ" : "ปิดให้บริการ"}
                    </span>
                    <hr />
                    <small className="text-xs">เปิดระบบ</small>
                    <p>{thaiDate(settings.opens_at)}</p>
                    <small className="text-xs">ปิดระบบ</small>
                    <p>{thaiDate(scheduleClosingDisplay(settings.closes_at))}</p>
                    <div className="text-muted">
                      ผู้ดูแลระบบสามารถตั้งเวลาเปิด–ปิดระบบได้
                      แม้อยู่นอกช่วงเวลาให้บริการ
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          {problem && !selected && (
            <p
              className="mt-4 rounded-lg border border-[#f4d8dc] bg-[#fff0f0] px-4 py-3 text-[#af313d] wrap-anywhere"
              role="alert"
            >
              {problem}
            </p>
          )}
          <footer className="flex items-center justify-between gap-5 pt-[25px] pb-[22px] text-xs text-secondary [&>span]:flex [&>span]:items-center [&>span]:gap-[7px] [&_i]:mx-[3px] [&_i]:h-[9px] [&_i]:w-px [&_i]:bg-[#d7cedf] max-desk:flex-col max-desk:items-start max-desk:gap-[5px] max-desk:text-[10px]">
            <span>
              MST GRS <i /> ระบบจัดการผลการเรียนคงค้าง
            </span>
            <span>
              <ShieldCheck size={14} /> ข้อมูลตามสิทธิ์ของผู้ใช้งาน
            </span>
          </footer>
          </div>
          {role !== "admin" && (
            <RecoveryRail records={scope} schedule={settings} open={open}>
              {role === "teacher" && !demo && <PushNotificationControl />}
            </RecoveryRail>
          )}
          </div>
        </main>
      </div>
      <dialog
        ref={dialog}
        className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%-32px)] max-w-[620px] overflow-auto rounded-2xl border-0 bg-white p-0 text-ink shadow-[0_20px_100px_#26164340] backdrop:bg-[#24163666] backdrop:backdrop-blur-[3px]"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setSelected(null);
        }}
        onClose={() => {
          if (!busy) setSelected(null);
        }}
      >
        {selected && (
          <>
            <div className="sticky font-[Sarabun] top-0 z-[2] flex items-center justify-between border-b border-line bg-white px-[26px] py-[22px] [&_h2]:text-[21px] max-desk:p-[18px] max-desk:[&_h2]:text-lg">
              <div>
                <div className="mb-[7px] text-[14px] font-semibold tracking-[1.7px] text-brand">
                  {selected.course_code}
                </div>
                <h2 className=" leading-normal font-[650]">
                  {selected.course_name}
                </h2>
              </div>
              <button
                className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex size-[34px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-1.5 text-muted enabled:hover:bg-brand-soft enabled:hover:text-brand"
                disabled={busy}
                aria-label="ปิดรายละเอียด"
                onClick={() => setSelected(null)}
              >
                <X />
              </button>
            </div>
            <div className="px-[26px] font-[Sarabun] py-[23px] [&>input]:w-full [&>textarea]:w-full [&>select]:w-full max-desk:p-[18px]">
              <div className="grid grid-cols-2 gap-[18px] rounded-[10px] bg-[#faf8fd] p-[18px] [&>span]:text-[14px] [&>span]:text-[#84728f] [&_strong]:mt-[3px] [&_strong]:block [&_strong]:text-[14px] max-desk:gap-[15px] max-desk:p-3.5">
                <span>
                  นักเรียน
                  <strong className="font-semibold text-[#574365]">
                    {selected.student_name} ({selected.student_code})
                  </strong>
                </span>
                <span>
                  ครูประจำวิชา
                  <strong className="font-semibold text-[#574365]">
                    {selected.teacher_name.join(", ")}
                  </strong>
                </span>
                <span>
                  ชั้น/ห้อง
                  <strong className="font-semibold text-[#574365]">
                    {selected.classroom}
                  </strong>
                </span>
                <span>
                  ภาคเรียน / ปีการศึกษา
                  <strong className="font-semibold text-[#574365]">
                    {selected.semester} / {selected.academic_year}
                  </strong>
                </span>
                <span className="">
                  ผลการเรียนเดิม
                  <strong className="font-semibold text-red-500">
                    {selected.original_grade}
                  </strong>
                </span>
                <span>
                  สถานะ
                  <strong className="font-semibold text-[#574365]">
                    {statuses[selected.status].label}
                  </strong>
                </span>
              </div>
              {selected.assignment && (
                <div className="my-6 [&_p]:mt-1 [&_p]:mb-3 [&_p]:text-[15px] [&_p]:whitespace-pre-wrap [&_p]:text-[#7c6d8a] [&>div]:flex [&>div]:items-center [&>div]:gap-[7px] [&>div]:rounded-[7px] [&>div]:bg-[#fff8eb] [&>div]:p-2.5 [&>div]:text-sm [&>div]:text-[#a67c3c]">
                  <h3 className="text-base leading-normal font-[650]">
                    ภาระงานที่ได้รับมอบหมาย
                  </h3>
                  <p>{selected.assignment}</p>
                  <div>
                    <CalendarDays size={16} /> กำหนดส่ง{" "}
                    {thaiDate(selected.due_at, true)}
                  </div>
                </div>
              )}
              {role === "teacher" && selected.status === "requested" && (
                <>
                  <label
                    className="mt-4 mb-2 block font-[550]"
                    htmlFor="assignment"
                  >
                    รายละเอียดภาระงาน
                  </label>
                  <textarea
                    className="max-w-full rounded-lg border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] min-h-[110px] resize-y"
                    id="assignment"
                    rows={6}
                    value={assignment}
                    maxLength={10000}
                    onChange={(e) => setAssignment(e.target.value)}
                    placeholder="ระบุชิ้นงาน วิธีดำเนินการ และสถานที่ส่งงาน"
                  />
                  <label className="mt-4 mb-2 block font-[550]" htmlFor="due">
                    กำหนดส่งงาน (เวลาไทย)
                  </label>
                  <input
                    className="max-w-full rounded-lg border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115]"
                    id="due"
                    type="datetime-local"
                    value={due}
                    onInput={(e) => setDue(e.currentTarget.value)}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </>
              )}
              {role === "teacher" && selected.status === "submitted" && (
                <>
                  <label
                    className="mt-4 mb-2 block font-[650] text-[15px]"
                    htmlFor="final-grade"
                  >
                    ผลการเรียนหลังแก้ไข
                  </label>
                  <select
                    className="max-w-full rounded-lg border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115]"
                    id="final-grade"
                    value={finalGrade}
                    onChange={(e) => setFinalGrade(e.target.value)}
                  >
                    {validFinalGrades.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </>
              )}
              {view === "history" && (
                <div className="my-4 rounded-lg border border-line p-4 text-sm text-secondary">
                  <p>เก็บเข้าประวัติเมื่อ {thaiDate((selected as ArchivedGradeRecord).archived_at, true)}</p>
                  {!demo && <a className="mt-2 inline-block text-brand underline" href={`/dashboard/assignments/${selected.id}`}>ดูภาระงานและไฟล์แนบย้อนหลัง</a>}
                </div>
              )}
              {selected.final_grade && (
                <div className="my-5 flex items-start gap-2.5 rounded-lg border border-[#e8dff5] bg-[#f6f2fd] p-[15px] text-sm text-[#6b5788] [&>svg]:mt-[3px] [&>svg]:shrink-0">
                  <CheckCircle2 size={19} />
                  <span>
                    ผลการเรียนใหม่{" "}
                    <strong className="font-semibold">
                      {selected.final_grade}
                    </strong>
                    {selected.completed_at && (
                      <>
                        {" "}
                        · ฝ่ายวิชาการอนุมัติ{" "}
                        {thaiDate(selected.completed_at, true)}
                      </>
                    )}
                  </span>
                </div>
              )}
              {role === "teacher" && selected.status === "completed" && (
                <p className="my-4 text-sm text-secondary">
                  ฝ่ายวิชาการอนุมัติแล้ว ไม่สามารถแก้ไขผลการเรียนได้
                </p>
              )}
              {role === "teacher" && view === "overview" &&
                selected.status === "teacher_approved" &&
                editingFinalGrade && (
                  <div className="my-5 rounded-lg border border-[#e8dff5] bg-[#faf7ff] p-4">
                    <label className="mb-2 block font-semibold" htmlFor="corrected-final-grade">
                      แก้ไขผลการเรียนใหม่
                    </label>
                    <select
                      id="corrected-final-grade"
                      className="w-full rounded-lg border border-[#e1dce9] bg-white px-[13px] py-[11px] text-ink outline-none focus:border-brand sm:w-40"
                      value={finalGrade}
                      onChange={(event) => setFinalGrade(event.target.value)}
                      disabled={busy}
                    >
                      {validFinalGrades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                    </select>
                  </div>
                )}
              {role === "teacher" && corrections.some((item) => item.record_id === selected.id) && (
                <section className="my-5 rounded-lg border border-line p-4" aria-label="ประวัติการแก้ไขผลการเรียนใหม่">
                  <h3 className="mb-3 font-semibold">ประวัติการแก้ไขผลการเรียนใหม่</h3>
                  <ol className="space-y-3 text-sm text-secondary">
                    {corrections.filter((item) => item.record_id === selected.id)
                      .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
                      .map((item) => (
                        <li key={item.id} className="rounded-lg bg-[#f8f5fc] p-3">
                          <strong className="text-ink">{item.previous_grade} → {item.new_grade}</strong>
                          <span className="block">{item.changed_by_name} · {thaiDate(item.changed_at, true)}</span>
                        </li>
                      ))}
                  </ol>
                </section>
              )}
              {selected.requested_at && (
                <div className="mt-[23px] mb-[5px] [&>div]:flex [&>div]:items-center [&>div]:gap-2.5 [&>div]:py-[7px] [&>div]:text-sm [&>div]:text-[#8c799e] [&_strong]:font-[450] [&_small]:ml-auto [&_small]:text-[12px] [&_small]:text-[#ae9eba] [&_small]:font-[Sarabun] max-desk:[&_small]:text-[9px] max-desk:[&_strong]:text-[11px]">
                  {[
                    ["ยื่นคำร้อง", selected.requested_at],
                    ["มอบหมายงาน", selected.assigned_at],
                    ["ครูรับงาน", selected.submitted_at],
                    ["ครูอนุมัติ", selected.teacher_approved_at],
                    ["ฝ่ายวิชาการอนุมัติ", selected.completed_at],
                  ].map(([label, date]) => (
                    <div key={label}>
                      <span
                        className={twMerge(
                          "grid size-[18px] shrink-0 place-items-center rounded-full border border-[#e7def0]",
                          date &&
                            "border-[#daece0] bg-[#eff8f3] text-[#5b9e7b]",
                        )}
                      >
                        {date ? <Check size={12} /> : null}
                      </span>
                      <strong className="font-semibold">{label}</strong>
                      <small className="">{thaiDate(date, true)}</small>
                    </div>
                  ))}
                </div>
              )}
              {role === "student" && selected.status === "pending" && (
                <div className="my-5 flex items-start gap-2.5 rounded-lg border border-[#e8dff5] bg-[#f6f2fd] p-[15px] text-sm text-[#6b5788] [&>svg]:mt-[3px] [&>svg]:shrink-0">
                  <Info size={20} />
                  <p>
                    ยืนยันยื่นคำร้องแก้ไขผลการเรียนรายวิชานี้ หลังยื่นคำร้อง
                    ครูประจำวิชาจะมอบหมายภาระงานให้คุณ
                  </p>
                </div>
              )}
              {role === "teacher" && selected.status === "assigned" && (
                <div className="my-5 flex items-start gap-2.5 rounded-lg border border-[#e8dff5] bg-[#f6f2fd] p-[15px] text-sm text-[#6b5788] [&>svg]:mt-[3px] [&>svg]:shrink-0">
                  <Info size={20} />
                  <p>
                    ยืนยันเมื่อนักเรียนนำงานมาส่งกับคุณแล้วเท่านั้น
                    หลังจากนี้คุณจะสามารถอนุมัติผลการเรียนได้
                  </p>
                </div>
              )}
              {role === "academic" &&
                selected.status === "teacher_approved" && (
                  <div className="my-5 flex items-start gap-2.5 rounded-lg border border-[#e8dff5] bg-[#f6f2fd] p-[15px] text-sm text-[#6b5788] [&>svg]:mt-[3px] [&>svg]:shrink-0">
                    <ShieldCheck size={20} />
                    <p>
                      การยืนยันนี้จะทำให้รายการแก้ไขผลการเรียนเสร็จสมบูรณ์
                      และย้ายเข้าประวัติของนักเรียน
                    </p>
                  </div>
                )}
              {problem && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-[#f4d8dc] bg-[#fff0f0] px-4 py-3 text-[#af313d] wrap-anywhere"
                >
                  {problem}
                </p>
              )}
            </div>
            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2.5 border-t border-line bg-white px-[26px] py-[18px] max-desk:gap-2 max-desk:p-[15px] max-desk:[&_button]:px-3 max-desk:[&_button]:py-2.5 max-desk:[&_button]:text-xs max-desk:[&_button]:whitespace-normal">
              <button
                className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] border px-[18px] py-[11px] font-[550] whitespace-nowrap border-[#e3ddea] bg-white text-[#625670] enabled:hover:bg-[#f8f5fc]"
                disabled={busy}
                onClick={() => {
                  if (editingFinalGrade) {
                    setEditingFinalGrade(false);
                    setFinalGrade(selected.final_grade ?? "1");
                    setProblem("");
                  } else setSelected(null);
                }}
              >
                {editingFinalGrade ? "ยกเลิก" : "ปิด"}
              </button>
              {role === "teacher" && view === "overview" && open &&
                selected.status === "teacher_approved" && (
                  <button
                    className="cursor-pointer bg-brand px-[18px] py-[11px] font-semibold text-white transition enabled:hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy || (editingFinalGrade && finalGrade === selected.final_grade)}
                    onClick={() => editingFinalGrade ? saveCorrectedGrade() : setEditingFinalGrade(true)}
                  >
                    {busy ? "กำลังบันทึก…" : editingFinalGrade ? "บันทึกผลการเรียนใหม่" : "แก้ไขผลการเรียนใหม่"}
                  </button>
                )}
              {role === "teacher" &&
                ["assigned", "submitted"].includes(selected.status) && (
                  <button
                    className="cursor-pointer border border-[#d8c8eb] bg-white px-[18px] py-[11px] font-[550] text-brand transition hover:bg-brand-soft disabled:opacity-60"
                    disabled={busy}
                    onClick={() =>
                      window.location.assign(
                        `${demo ? "/demo" : "/dashboard"}/assignments/${selected.id}${demo ? "?role=teacher" : ""}`,
                      )
                    }
                  >
                    {selected.status === "assigned"
                      ? "แก้ไขรายละเอียดงาน"
                      : "มอบหมายงานเพิ่ม"}
                  </button>
                )}
              {nextStatus[role]?.[selected.status] && (
                <button
                  className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex items-center justify-center gap-[9px] border border-transparent px-[18px] py-[11px] font-[550] whitespace-nowrap bg-brand text-white shadow-[0_3px_6px_#713cd112] enabled:hover:bg-brand/90 enabled:hover:shadow-[0_3px_12px_#713cd126]"
                  disabled={busy}
                  onClick={act}
                >
                  {busy
                    ? "กำลังบันทึก…"
                    : role === "student"
                      ? "ยืนยันยื่นคำร้อง"
                      : selected.status === "requested"
                        ? "ยืนยันมอบหมายงาน"
                        : selected.status === "assigned"
                          ? "ยืนยันรับงาน"
                          : role === "academic"
                            ? "ยืนยันอนุมัติผลการเรียน"
                            : "อนุมัติและส่งฝ่ายวิชาการ"}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </>
        )}
      </dialog>
      {toast && (
        <div
          className="fixed right-7 bottom-[25px] z-[100] flex max-w-[calc(100%-32px)] items-center gap-3 rounded-xl border border-[#dceee5] bg-white px-[18px] py-[15px] text-sm text-[#57896f] shadow-[0_8px_50px_#3120432b] [&>svg]:shrink-0 max-desk:right-4 max-desk:bottom-4 max-desk:text-xs"
          role="status"
        >
          <CheckCircle2 size={20} />
          {toast}
          <button
            className="cursor-pointer transition-[background,box-shadow,transform] duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 inline-flex size-[34px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-1.5 text-muted enabled:hover:bg-brand-soft enabled:hover:text-brand"
            aria-label="ปิดข้อความ"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {loggingOut && <LogoutOverlay />}
    </div>
  );
}
function Stat({
  title,
  value,
  unit,
  icon,
  tone,
  detail,
}: {
  title: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  tone: string;
  detail: string;
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <div className={styles.metricTop}><span>{title}</span><span className={styles.metricIcon}>{icon}</span></div>
      <div className={styles.metricValue}>{value.toLocaleString("th-TH")}<span>{unit}</span></div>
      <p>{detail}</p>
    </div>
  );
}
