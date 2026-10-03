"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import AdminAccountRow from "./admin-account-row";
import {
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  Search,
  UserPlus,
} from "lucide-react";
import { listStudents, saveStudents } from "@/app/student-actions";
import { previewStudentImport } from "@/app/student-lifecycle-actions";
import { summarizeStudentImport } from "@/lib/student-import-preview";
import { readStudentWorkbook } from "@/lib/student-workbook";
import {
  studentColumns,
  studentFullName,
  studentLevel,
  studentSchema,
  compareStudents,
  type StudentInput,
  type StudentList,
  type StudentRow,
  type StudentSaveResult,
} from "@/lib/students";
import {
  STUDENT_BATCH_SIZE,
  runStudentBatch,
  type StudentBatchResult,
} from "@/lib/student-import";

const fields = Object.entries(studentColumns);
const prefixOptions = ["เด็กชาย", "เด็กหญิง", "นาย", "นางสาว"].map(
  (prefix) => ({
    value: prefix,
    label: prefix,
  }),
);
const inputStyle =
  "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10";
const buttonStyle =
  "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const emptyList: StudentList = {
  total: 0,
  items: [],
  levels: [],
  classrooms: [],
};
const demoStudents: StudentRow[] = [
  {
    id: "demo-student-1",
    student_code: "10001",
    full_name: "เด็กชายศุภพล แดงประทีป",
    classroom: "ม.3/8",
    roll_number: 17,
    name_prefix: "เด็กชาย",
    first_name: "ศุภพล",
    last_name: "แดงประทีป",
  },
  {
    id: "demo-student-2",
    student_code: "10002",
    full_name: "นางสาววรัญญา ใจดี",
    classroom: "ม.5/2",
    roll_number: 2,
    name_prefix: "นางสาว",
    first_name: "วรัญญา",
    last_name: "ใจดี",
  },
  {
    id: "demo-student-3",
    student_code: "10003",
    full_name: "เด็กหญิงกมลชนก แสงทอง",
    classroom: "ม.1/1",
    roll_number: 1,
    name_prefix: "เด็กหญิง",
    first_name: "กมลชนก",
    last_name: "แสงทอง",
  },
];

export default function AdminStudents({
  demo = false,
  onManageYear,
}: {
  demo?: boolean;
  onManageYear?: () => void;
}) {
  const [data, setData] = useState<StudentList>(emptyList);
  const [demoRows, setDemoRows] = useState(demoStudents);
  const [namePrefix, setNamePrefix] = useState("");
  const [search, setSearch] = useState(""),
    [level, setLevel] = useState("all"),
    [page, setPage] = useState(1);
  const [classroom, setClassroom] = useState("");
  const [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(""),
    [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<StudentInput[]>([]),
    [fileName, setFileName] = useState("");
  const [importSummary, setImportSummary] = useState<{
    created: number;
    updated: number;
    archived: number;
  } | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [fileErrors, setFileErrors] = useState<string[]>([]),
    [results, setResults] = useState<StudentSaveResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0),
    [sheetCount, setSheetCount] = useState(0);
  const [sheetProgress, setSheetProgress] = useState({
    name: "",
    completed: 0,
    total: 0,
  });
  const fileVersion = useRef(0),
    formRef = useRef<HTMLFormElement>(null);
  const operationLock = useRef(false),
    stopRequested = useRef(false),
    currentRun = useRef<string | null>(null);
  const readerAbort = useRef<AbortController | null>(null),
    cancelPending = useRef<string | null>(null);
  const [cancelling, setCancelling] = useState(false),
    [cancelError, setCancelError] = useState("");
  const [cancelNotice, setCancelNotice] = useState("");
  const sortedPreview = useMemo(
    () => [...preview].sort(compareStudents),
    [preview],
  );
  const processDialog = useRef<HTMLDialogElement>(null);
  const processing = busy || reading;

  useEffect(() => {
    let cancelled = false;
    setImportSummary(null);
    setSummaryError("");
    if (!preview.length) return;
    async function summarize() {
      try {
        const existing = new Set(demoRows.map((row) => row.student_code));
        const result = await summarizeStudentImport(
          preview.map((row) => row.student_code),
          async (codes) => {
            if (!demo) return previewStudentImport(codes);
            const updated = codes.filter((code) => existing.has(code)).length;
            return {
              data: { created: codes.length - updated, updated, archived: 0 },
            };
          },
          () => !cancelled,
        );
        if (!cancelled) {
          if (result.error || !result.data)
            setSummaryError(result.error ?? "ตรวจสอบบัญชีก่อนนำเข้าไม่สำเร็จ");
          else setImportSummary(result.data);
        }
      } catch {
        if (!cancelled)
          setSummaryError("ตรวจสอบบัญชีก่อนนำเข้าไม่สำเร็จ กรุณาลองใหม่");
      }
    }
    void summarize();
    return () => {
      cancelled = true;
    };
  }, [preview, demo, demoRows, summaryRefresh]);

  useEffect(() => {
    const dialog = processDialog.current;
    if (processing && dialog && !dialog.open) dialog.showModal();
    else if (!processing && dialog?.open) dialog.close();
  }, [processing]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError("");
      try {
        if (demo) {
          const rows = demoRows
            .filter(
              (s) =>
                (level === "all" ||
                  studentLevel(s.classroom) === Number(level)) &&
                (!classroom || s.classroom === classroom) &&
                (s.full_name
                  .toLowerCase()
                  .includes(search.trim().toLowerCase()) ||
                  s.student_code.includes(search.trim())),
            )
            .sort(compareStudents);
          if (!cancelled)
            setData({
              total: rows.length,
              items: rows.slice((page - 1) * 50, page * 50),
              classrooms: [
                ...new Set(
                  demoRows
                    .filter(
                      (row) =>
                        level === "all" ||
                        studentLevel(row.classroom) === Number(level),
                    )
                    .flatMap((row) => (row.classroom ? [row.classroom] : [])),
                ),
              ].sort((a, b) =>
                compareStudents(
                  { classroom: a, roll_number: null, student_code: "" },
                  { classroom: b, roll_number: null, student_code: "" },
                ),
              ),
              levels: [
                ...new Set(
                  demoRows
                    .map((s) => studentLevel(s.classroom))
                    .filter((v): v is number => v !== null),
                ),
              ].sort(),
            });
        } else {
          const response = await listStudents({
            search,
            level: level === "all" ? null : Number(level),
            classroom: classroom || null,
            page,
          });
          if (!cancelled) {
            if (response.error) {
              setData(emptyList);
              setLoadError(response.error);
            } else if (response.data) setData(response.data);
          }
        }
      } catch {
        if (!cancelled) {
          setData(emptyList);
          setLoadError("ไม่สามารถโหลดรายชื่อได้ กรุณาตรวจสอบการเชื่อมต่อ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [demo, demoRows, search, level, classroom, page, refresh]);

  useEffect(() => {
    if (
      !loading &&
      !loadError &&
      page > Math.max(1, Math.ceil(data.total / 50))
    )
      setPage(Math.max(1, Math.ceil(data.total / 50)));
  }, [loading, loadError, page, data.total]);

  async function control(
    operation: "start" | "cancel" | "finish",
    importId?: string,
  ) {
    const response = await fetch("/api/admin/students/import-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, ...(importId ? { importId } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "ควบคุมการนำเข้าไม่สำเร็จ");
    return data as { importId: string; status: string };
  }

  async function sendCancel(id: string) {
    if (cancelPending.current === id) return;
    cancelPending.current = id;
    setCancelError("");
    try {
      await control("cancel", id);
    } catch {
      if (currentRun.current === id)
        setCancelError(
          "ยังยืนยันการหยุดฝั่งเซิร์ฟเวอร์ไม่ได้ หยุดส่งชุดใหม่แล้ว กำลังรอชุดปัจจุบันจบ",
        );
    } finally {
      if (cancelPending.current === id) cancelPending.current = null;
    }
  }

  async function cancelProcess() {
    stopRequested.current = true;
    if (reading) {
      ++fileVersion.current;
      readerAbort.current?.abort();
      operationLock.current = false;
      setReading(false);
      setFileName("");
      setPreview([]);
      setFileErrors([]);
      setCancelNotice("ยกเลิกการอ่านไฟล์แล้ว ยังไม่มีบัญชีถูกบันทึก");
      return;
    }
    if (busy) {
      setCancelling(true);
      if (!demo && currentRun.current) await sendCancel(currentRun.current);
    }
  }

  async function startRun() {
    if (demo) {
      currentRun.current = "demo";
      return "demo";
    }
    const started = await control("start");
    currentRun.current = started.importId;
    if (stopRequested.current) await sendCancel(started.importId);
    return started.importId;
  }

  async function endRun() {
    const id = currentRun.current;
    try {
      if (!demo && id) await control("finish", id);
    } catch {
      setProblem(
        "ไม่สามารถยืนยันการปิดรอบนำเข้าได้ กรุณาตรวจสอบรายชื่อก่อนลองใหม่",
      );
    } finally {
      currentRun.current = null;
      operationLock.current = false;
      setBusy(false);
      setCancelling(false);
    }
  }

  function prepareSave(total: number) {
    operationLock.current = true;
    stopRequested.current = false;
    currentRun.current = null;
    setCancelling(false);
    setCancelError("");
    setCancelNotice("");
    setSaveTotal(total);
    setProgress(0);
    setBusy(true);
  }

  async function save(
    rows: StudentInput[],
    importId: string,
  ): Promise<Partial<StudentBatchResult>> {
    if (demo) {
      return runStudentBatch(
        rows,
        async (s) => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const outcome: StudentSaveResult = {
            student_code: s.student_code,
            status: demoRows.some((r) => r.student_code === s.student_code)
              ? "updated"
              : "created",
          };
          setDemoRows((old) => {
            const next = [...old];
            const index = next.findIndex(
              (r) => r.student_code === s.student_code,
            );
            const { citizen_id: _credential, ...profile } = s;
            const value: StudentRow = {
              ...profile,
              id: index >= 0 ? next[index].id : `demo-${s.student_code}`,
              full_name: studentFullName(s),
            };
            if (index >= 0) next[index] = value;
            else next.push(value);
            return next;
          });
          return outcome;
        },
        async () => !stopRequested.current,
      );
    }
    return saveStudents(rows, importId);
  }

  async function addStudent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (operationLock.current) return;
    setProblem("");
    setResults([]);
    const parsed = studentSchema.safeParse(
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    if (!parsed.success) {
      setProblem(
        "กรุณาตรวจสอบ " +
          [
            ...new Set(
              parsed.error.issues.map(
                (issue) =>
                  fields.find(([, key]) => key === issue.path[0])?.[0] ??
                  "ข้อมูล",
              ),
            ),
          ].join(", "),
      );
      return;
    }
    prepareSave(1);
    try {
      const importId = await startRun();
      const result = stopRequested.current
        ? { results: [], cancelled: true }
        : await save([parsed.data], importId);
      setResults(result.results ?? []);
      setProgress(result.results?.length ?? 0);
      if (stopRequested.current || result.cancelled)
        setCancelNotice(
          `หยุดการบันทึกแล้ว · ยังไม่ได้ดำเนินการ ${1 - (result.results?.length ?? 0)} รายการ`,
        );
      if (result.error) setProblem(result.error);
      else {
        if (result.results?.[0] && result.results[0].status !== "failed")
          formRef.current?.reset();
        setRefresh((v) => v + 1);
      }
    } catch {
      setProblem("ไม่สามารถยืนยันการบันทึกได้ กรุณาตรวจสอบรายชื่อก่อนลองใหม่");
    } finally {
      await endRun();
    }
  }

  async function readFile(file: File) {
    if (operationLock.current) return;
    operationLock.current = true;
    stopRequested.current = false;
    setCancelNotice("");
    setCancelError("");
    setCancelling(false);
    const controller = new AbortController();
    readerAbort.current = controller;
    const version = ++fileVersion.current;
    setReading(true);
    setPreview([]);
    setFileErrors([]);
    setFileName(file.name);
    setProblem("");
    setResults([]);
    setSheetCount(0);
    setSheetProgress({ name: "", completed: 0, total: 0 });
    try {
      if (!/\.xlsx$/i.test(file.name))
        throw new Error("รองรับไฟล์ .xlsx เท่านั้น");
      const ExcelJS = (await import("exceljs")).default;
      controller.signal.throwIfAborted();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      const parsed = await readStudentWorkbook(
        workbook,
        async (name, completed, total) => {
          if (version !== fileVersion.current) return;
          setSheetProgress({ name, completed, total });
          // Give the loading popup a paint between sheets, including large files.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        },
        controller.signal,
      );
      if (version !== fileVersion.current) return;
      setSheetCount(parsed.sheets);
      setPreview(parsed.rows);
      setFileErrors(parsed.errors);
    } catch (error) {
      if (version === fileVersion.current)
        setFileErrors([
          error instanceof Error &&
          /^(รองรับ|ไม่พบ|แถว|หัวคอลัมน์|นำเข้า)/.test(error.message)
            ? error.message
            : "อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ XLSX ที่เปิดใน Excel ได้",
        ]);
    } finally {
      if (version === fileVersion.current) {
        setReading(false);
        operationLock.current = false;
      }
      if (readerAbort.current === controller) readerAbort.current = null;
    }
  }

  async function importStudents() {
    if (
      !preview.length ||
      fileErrors.length ||
      !importSummary ||
      summaryError ||
      operationLock.current
    )
      return;
    prepareSave(preview.length);
    setProblem("");
    setResults([]);
    setProgress(0);
    const outcomes: StudentSaveResult[] = [];
    try {
      const importId = await startRun();
      for (
        let offset = 0;
        offset < preview.length;
        offset += STUDENT_BATCH_SIZE
      ) {
        if (stopRequested.current) break;
        const response = await save(
          preview.slice(offset, offset + STUDENT_BATCH_SIZE),
          importId,
        );
        outcomes.push(...(response.results ?? []));
        setProgress(outcomes.length);
        setResults([...outcomes]);
        if (response.error) {
          setProblem(response.error);
          break;
        }
        if (response.cancelled) {
          stopRequested.current = true;
          break;
        }
      }
    } catch {
      setProblem(
        "การเชื่อมต่อขัดข้อง บางบัญชีอาจบันทึกแล้ว กรุณาตรวจสอบรายชื่อก่อนลองใหม่",
      );
    } finally {
      const completed = new Set(
        outcomes
          .filter((r) => r.status !== "failed")
          .map((r) => r.student_code),
      );
      const remaining = preview.filter((s) => !completed.has(s.student_code));
      setPreview(remaining);
      if (!remaining.length) setFileName("");
      if (stopRequested.current)
        setCancelNotice(
          `หยุดนำเข้าแล้ว · ยังไม่ได้ดำเนินการ ${preview.length - outcomes.length} รายการ`,
        );
      await endRun();
      setRefresh((v) => v + 1);
    }
  }

  async function template() {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      for (let n = 1; n <= 6; n++) {
        const sheet = book.addWorksheet(`ม.${n}`);
        sheet.columns = fields.map(([header]) => ({
          header,
          width: header === "เลขประจำตัวประชาชน" ? 24 : 20,
        }));
        sheet.getColumn(1).numFmt = "@";
        sheet.getColumn(2).numFmt = "@";
        if (n === 4)
          sheet.addRow([
            "1-0000-00000-00-1",
            "10001",
            "เด็กชาย",
            "ศุภพล",
            "แดงประทีป",
            "ม.4/9",
            9,
          ]);
        sheet.getRow(1).font = { bold: true };
      }
      const bytes = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "student-template.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setProblem("ดาวน์โหลดแม่แบบไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
  }

  const pages = Math.max(1, Math.ceil(data.total / 50));
  const percent = reading
    ? sheetProgress.total
      ? Math.round((sheetProgress.completed / sheetProgress.total) * 100)
      : 0
    : saveTotal
      ? Math.round((progress / saveTotal) * 100)
      : 0;
  return (
    <section className="space-y-6" aria-label="จัดการรายชื่อนักเรียน">
      {onManageYear && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
          <div>
            <h2 className="font-semibold">เตรียมรายชื่อสำหรับปีการศึกษาใหม่</h2>
            <p className="mt-1 text-sm text-secondary">
              จัดการนักเรียนจบการศึกษา ย้ายออก และดูรายชื่อย้อนหลัง
            </p>
          </div>
          <button
            type="button"
            onClick={onManageYear}
            disabled={processing}
            className={`${buttonStyle} cursor-pointer rounded-lg border border-line text-brand hover:bg-brand-soft`}
          >
            จัดการนักเรียนปีใหม่
          </button>
        </div>
      )}
      <dialog
        ref={processDialog}
        aria-labelledby="student-process-title"
        onCancel={(e) => {
          e.preventDefault();
          void cancelProcess();
        }}
        className="fixed top-1/2 left-1/2 z-50 w-[calc(100%_-_32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-7 text-ink shadow-2xl backdrop:bg-[#24163666]"
      >
        <div className="mb-5 flex justify-center">
          <span className="rounded-full bg-brand-soft p-4">
            <Loader2 size={30} className="animate-spin text-brand" />
          </span>
        </div>
        <h2
          id="student-process-title"
          className="text-center text-lg font-semibold"
        >
          {cancelling
            ? "กำลังหยุด…"
            : reading
              ? "กำลังอ่านและตรวจไฟล์"
              : "กำลังบันทึกบัญชีนักเรียน"}
        </h2>
        <div
          className="mt-3 space-y-3 text-center text-sm text-secondary"
          role="status"
          aria-live="polite"
        >
          <p>
            {reading
              ? sheetProgress.name
                ? `กำลังตรวจชีท ${sheetProgress.name}`
                : "กำลังเปิดไฟล์ XLSX..."
              : `ดำเนินการแล้ว ${progress.toLocaleString()} / ${saveTotal.toLocaleString()} รายการ`}
          </p>
          {reading && sheetProgress.total > 0 && (
            <p className="text-xs">
              ตรวจแล้ว {sheetProgress.completed} / {sheetProgress.total} ชีท
            </p>
          )}
          <progress
            aria-label={
              reading ? "ความคืบหน้าการตรวจชีท" : "ความคืบหน้าการบันทึก"
            }
            className="h-2.5 w-full accent-[#713cd1]"
            max={100}
            value={reading && !sheetProgress.total ? undefined : percent}
          />
          {(!reading || sheetProgress.total > 0) && (
            <p className="text-sm font-semibold text-brand">{percent}%</p>
          )}
          <p className="text-xs">
            {cancelling
              ? cancelError
                ? "กำลังรอชุดปัจจุบันจบ"
                : "รอเฉพาะบัญชีที่เริ่มแล้วสูงสุด 5 คนให้บันทึกครบ"
              : "กรุณารอและเปิดหน้านี้ไว้จนกว่าจะเสร็จ"}
          </p>
          {cancelError && (
            <p className="text-xs text-red-700" role="alert">
              {cancelError}
            </p>
          )}
          <button
            type="button"
            className={`${buttonStyle} w-full border border-line text-ink`}
            onClick={() => void cancelProcess()}
            disabled={cancelling && !cancelError}
          >
            {cancelError
              ? "ลองส่ง Cancel อีกครั้ง"
              : cancelling
                ? "กำลังหยุด…"
                : "Cancel"}
          </button>
        </div>
      </dialog>
      <div className="grid gap-5 min-[1100px]:grid-cols-2">
        <section className="rounded-xl border border-line bg-white p-5 max-desk:p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserPlus size={20} className="text-brand" />
            เพิ่มข้อมูลนักเรียน
          </h2>
          <form
            ref={formRef}
            onSubmit={addStudent}
            onReset={() => setNamePrefix("")}
            className="mt-4 grid grid-cols-2 gap-3"
            autoComplete="off"
          >
            <fieldset
              disabled={busy}
              className="col-span-2 grid grid-cols-2 gap-3"
            >
              {fields.map(([label, key]) => (
                <div
                  key={key}
                  className={`text-xs font-medium ${key === "citizen_id" ? "col-span-2" : ""}`}
                >
                  <label htmlFor={`student-${key}`}>{label}</label>
                  {key === "name_prefix" ? (
                    <Select
                      inputId={`student-${key}`}
                      instanceId="student-name-prefix"
                      name={key}
                      required
                      options={prefixOptions}
                      value={
                        prefixOptions.find(
                          (option) => option.value === namePrefix,
                        ) ?? null
                      }
                      onChange={(option) => setNamePrefix(option?.value ?? "")}
                      isSearchable={false}
                      isDisabled={busy || reading}
                      placeholder="เลือกคำนำหน้าชื่อ"
                      menuPlacement="auto"
                      className="mt-1 text-sm font-normal"
                      styles={{
                        control: (base, state) => ({
                          ...base,
                          minHeight: 42,
                          borderRadius: 0,
                          borderColor: state.isFocused
                            ? "var(--color-brand)"
                            : "var(--color-line)",
                          boxShadow: state.isFocused
                            ? "0 0 0 2px rgb(125 30 138 / 10%)"
                            : "none",
                          "&:hover": { borderColor: "var(--color-brand)" },
                        }),
                      }}
                      theme={(theme) => ({
                        ...theme,
                        colors: {
                          ...theme.colors,
                          primary: "var(--color-brand)",
                          primary25: "var(--color-brand-soft)",
                          primary50: "var(--color-brand-soft)",
                          neutral80: "var(--color-ink)",
                        },
                      })}
                    />
                  ) : (
                    <input
                      id={`student-${key}`}
                      className={inputStyle}
                      name={key}
                      required
                      inputMode={
                        ["citizen_id", "student_code", "roll_number"].includes(
                          key,
                        )
                          ? "numeric"
                          : "text"
                      }
                      maxLength={
                        key === "citizen_id"
                          ? 17
                          : key === "student_code"
                            ? 10
                            : key === "roll_number"
                              ? 3
                              : key === "classroom"
                                ? 40
                                : 80
                      }
                      placeholder={
                        key === "citizen_id"
                          ? "1-0000-00000-00-1 หรือเลข 13 หลัก"
                          : key === "classroom"
                            ? "ม.4/9"
                            : undefined
                      }
                    />
                  )}
                </div>
              ))}
            </fieldset>
            <button
              className={`${buttonStyle} col-span-2 mt-1 bg-brand text-white hover:bg-brand/90 cursor-pointer`}
              disabled={busy || reading}
              type="submit"
            >
              {busy ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <UserPlus size={17} />
              )}
              บันทึกนักเรียน
            </button>
          </form>
        </section>
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-white p-5 max-desk:p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileSpreadsheet size={20} className="text-brand" />
            นำเข้านักเรียนจาก XLSX
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            อ่านครบทุกชีท รวม ม.1–ม.6 ตรวจข้อมูลก่อนบันทึก รองรับชีทละ 2,000 แถว
          </p>
          <div className="mt-4 flex flex-1 flex-col justify-start rounded-lg border border-dashed border-brand/30 bg-brand-soft/40 p-5">
            <label
              htmlFor="student-xlsx"
              className="mb-3 block text-sm font-medium"
            >
              เลือกไฟล์รายชื่อนักเรียน
            </label>
            <input
              id="student-xlsx"
              type="file"
              accept=".xlsx"
              disabled={busy || reading}
              className="block w-full text-sm cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:text-brand"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void readFile(file);
              }}
            />
            {reading && (
              <p className="mt-3 flex items-center gap-2 text-xs" role="status">
                <Loader2 size={15} className="animate-spin" />
                กำลังตรวจไฟล์...
              </p>
            )}
            {fileName && (
              <p className="mt-3 break-all text-xs text-secondary">
                {fileName}
              </p>
            )}
          </div>
          <button
            type="button"
            className={`${buttonStyle} cursor-pointer mt-3 self-start border border-line text-brand`}
            onClick={template}
            disabled={busy}
          >
            <Download size={16} />
            ดาวน์โหลดไฟล์แม่แบบ
          </button>
          <p className="mt-4 text-xs leading-6 text-secondary">
            คอลัมน์: {Object.keys(studentColumns).join(" · ")}
          </p>
        </section>
      </div>
      {cancelNotice && (
        <p
          role="status"
          className="rounded-lg border border-line bg-brand-soft p-4 text-sm text-brand"
        >
          {cancelNotice}
        </p>
      )}
      {problem && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {problem}
        </p>
      )}
      {fileErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          <strong>ยังไม่สามารถนำเข้าได้</strong>
          <ul className="mt-2 max-h-44 list-disc overflow-auto pl-5">
            {fileErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <h2 className="text-lg font-semibold">
                ตรวจสอบก่อนนำเข้า · {preview.length.toLocaleString()} รายการ ·{" "}
                {sheetCount} ชีท
              </h2>
              <p className="mt-1 text-sm text-secondary">
                รหัสซ้ำกับระบบจะอัปเดตข้อมูลรายชื่อ คงรหัสผ่านเดิม
                และคงสถานะการศึกษาเดิม หากนักเรียนกลับมาเรียน ให้คืนสถานะในหน้า
                “จัดการนักเรียนปีใหม่”
              </p>
              <p className="mt-2 text-sm text-brand" role="status">
                {importSummary
                  ? `คาดว่าจะเพิ่มใหม่ ${importSummary.created.toLocaleString()} คน · อัปเดต ${importSummary.updated.toLocaleString()} คน · เปลี่ยนสถานะ 0 คน`
                  : summaryError
                    ? "ยังตรวจสอบบัญชีก่อนนำเข้าไม่สำเร็จ"
                    : "กำลังตรวจสอบบัญชีก่อนนำเข้า..."}
              </p>
              {!!importSummary?.archived && (
                <p className="mt-1 text-sm text-amber-800">
                  ในกลุ่มอัปเดตมีนักเรียนที่ไม่ได้อยู่ในสถานะกำลังศึกษา{" "}
                  {importSummary.archived} คน
                  ซึ่งจะคงสถานะเดิมและอยู่ในรายชื่อย้อนหลัง
                </p>
              )}
              {summaryError && (
                <div role="alert" className="mt-2 text-sm text-red-700">
                  {summaryError}
                  <button
                    type="button"
                    className="ml-2 cursor-pointer underline"
                    onClick={() => setSummaryRefresh((value) => value + 1)}
                  >
                    ลองตรวจสอบใหม่
                  </button>
                </div>
              )}
            </div>
            <button
              className={`${buttonStyle} cursor-pointer hover:bg-brand/90 bg-brand text-white`}
              onClick={importStudents}
              disabled={
                busy ||
                reading ||
                fileErrors.length > 0 ||
                !importSummary ||
                !!summaryError
              }
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={16} />
              )}
              ยืนยันนำเข้า
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#f8f6fc]">
                <tr>
                  {["รหัสนักเรียน", "ชื่อ-นามสกุล", "ชั้น/ห้อง", "เลขที่"].map(
                    (h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-3 font-medium"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedPreview.slice(0, 50).map((s) => (
                  <tr key={s.student_code} className="border-t border-line">
                    <td className="px-4 py-3">{s.student_code}</td>
                    <td className="min-w-48 px-4 py-3">{studentFullName(s)}</td>
                    <td className="px-4 py-3">{s.classroom}</td>
                    <td className="px-4 py-3">{s.roll_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 50 && (
            <p className="p-3 text-sm text-secondary">
              แสดงตัวอย่าง 50 รายการแรก · นำเข้าทุกรายการที่ตรวจผ่าน
            </p>
          )}
        </section>
      )}
      {(results.length > 0 || busy) && (
        <div
          className="rounded-lg border border-line bg-white p-4 text-sm"
          aria-live="polite"
        >
          {busy && (
            <p className="mb-2">
              กำลังบันทึก{progress ? ` · ตรวจแล้ว ${progress} รายการ` : "..."}
            </p>
          )}
          {results.length > 0 && (
            <p>
              เพิ่มใหม่ {results.filter((r) => r.status === "created").length} ·
              อัปเดต {results.filter((r) => r.status === "updated").length} ·
              ไม่สำเร็จ {results.filter((r) => r.status === "failed").length}
              {demo && " · ข้อมูลทดลอง"}
            </p>
          )}
          {results.some((r) => r.status === "failed") && (
            <ul className="mt-2 max-h-44 list-disc overflow-auto pl-5 text-xs text-red-700">
              {results
                .filter((r) => r.status === "failed")
                .map((r) => (
                  <li key={r.student_code}>
                    {r.student_code}: {r.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      <section
        className="overflow-hidden rounded-xl border border-line bg-white"
        aria-label="ตารางรายชื่อนักเรียน"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-lg font-semibold">รายชื่อนักเรียนปัจจุบัน</h2>
            <p className="mt-1 text-sm text-secondary">
              พบ {data.total.toLocaleString()} คน · แสดงหน้าละ 50 คน
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 min-[800px]:w-auto">
            <label className="flex min-w-40 flex-1 items-center gap-2 border border-line px-3">
              <Search size={16} className="text-secondary" />
              <input
                aria-label="ค้นหาชื่อนักเรียน"
                value={search}
                maxLength={150}
                placeholder="ค้นหาชื่อหรือรหัสนักเรียน"
                className="w-full bg-transparent py-2.5 text-sm outline-none"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setLoading(true);
                }}
              />
            </label>
            <label className="flex items-center gap-2 border border-line px-3">
              <Filter size={16} className="text-secondary" />
              <select
                aria-label="กรองระดับชั้น"
                className="bg-transparent py-2.5 text-sm outline-none"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setClassroom("");
                  setPage(1);
                  setLoading(true);
                }}
              >
                <option value="all">ทุกระดับชั้น</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    ม.{n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 border border-line px-3">
              <Filter size={16} className="text-secondary" />
              <select
                aria-label="กรองห้อง"
                className="bg-transparent py-2.5 text-sm outline-none"
                value={classroom}
                disabled={loading || busy || reading}
                onChange={(event) => {
                  setClassroom(event.target.value);
                  setPage(1);
                  setLoading(true);
                }}
              >
                <option value="">ทุกห้อง</option>
                {classroom && !data.classrooms.includes(classroom) && (
                  <option value={classroom}>{classroom}</option>
                )}
                {data.classrooms.map((room) => (
                  <option key={room} value={room}>
                    {room}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {loadError ? (
          <div className="p-6 text-center text-sm text-red-700" role="alert">
            {loadError}
            <button
              type="button"
              className={`${buttonStyle} ml-3 border border-line`}
              onClick={() => setRefresh((v) => v + 1)}
            >
              ลองโหลดใหม่
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto" aria-busy={loading}>
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f6fc] text-sm text-secondary">
                <tr>
                  {[
                    "รหัสนักเรียน",
                    "ชื่อ-นามสกุล",
                    "ชั้น/ห้อง",
                    "เลขที่",
                    "ดำเนินการ",
                  ].map((h) => (
                    <th
                      className="whitespace-nowrap px-5 py-3 font-medium"
                      key={h}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-secondary">
                      <Loader2
                        className="mx-auto mb-2 animate-spin"
                        size={22}
                      />
                      กำลังโหลดรายชื่อ...
                    </td>
                  </tr>
                ) : data.items.length ? (
                  data.items.map((s) => (
                    <AdminAccountRow
                      key={s.id}
                      row={s}
                      role="student"
                      demo={demo}
                      disabled={busy || reading}
                      onSaved={(updated) => {
                        if (demo)
                          setDemoRows((rows) =>
                            rows.map((row) =>
                              row.id === updated.id
                                ? {
                                    ...row,
                                    ...updated,
                                    student_code: row.student_code,
                                  }
                                : row,
                            ),
                          );
                        else setRefresh((value) => value + 1);
                      }}
                      onDeleted={(id) => {
                        if (demo)
                          setDemoRows((rows) =>
                            rows.filter((row) => row.id !== id),
                          );
                        else setRefresh((value) => value + 1);
                        if (data.items.length === 1 && page > 1)
                          setPage((value) => value - 1);
                      }}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-secondary">
                      {search || level !== "all" || classroom
                        ? "ไม่พบนักเรียนตามตัวกรอง"
                        : "ยังไม่มีข้อมูลนักเรียน"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-line p-4 text-sm text-secondary">
          <span>
            หน้า {page} / {pages}
          </span>
          <div className="flex gap-2">
            <button
              className={`${buttonStyle} border border-line`}
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ก่อนหน้า
            </button>
            <button
              className={`${buttonStyle} border border-line`}
              disabled={loading || page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
