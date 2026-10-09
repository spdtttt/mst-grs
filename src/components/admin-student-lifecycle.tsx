"use client";

import { Skeleton, SkeletonTableRows } from "@/components/skeleton";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  GraduationCap,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  changeStudentStatus,
  listStudentLifecycle,
} from "@/app/student-lifecycle-actions";
import {
  studentStatusLabels,
  type LifecycleList,
  type LifecycleStudent,
  type LifecycleChangeResult,
  type StudentStatus,
} from "@/lib/student-lifecycle";
import { compareStudents, studentLevel } from "@/lib/students";

const empty: LifecycleList = {
  items: [],
  total: 0,
  classrooms: [],
  counts: { active: 0, graduated: 0, transferred: 0, not_graduated: 0 },
};
const samples: LifecycleStudent[] = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    student_code: "10001",
    full_name: "นายสมชาย ใจดี",
    classroom: "ม.6/1",
    roll_number: 1,
    student_status: "active",
    student_status_year: null,
    account_revision: 0,
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    student_code: "10002",
    full_name: "นางสาวสมใจ รักเรียน",
    classroom: "ม.6/1",
    roll_number: 2,
    student_status: "active",
    student_status_year: null,
    account_revision: 0,
  },
  {
    id: "60000000-0000-4000-8000-000000000003",
    student_code: "10003",
    full_name: "เด็กหญิงกมลชนก แสงทอง",
    classroom: "ม.1/1",
    roll_number: 1,
    student_status: "active",
    student_status_year: null,
    account_revision: 0,
  },
  {
    id: "60000000-0000-4000-8000-000000000004",
    student_code: "09001",
    full_name: "นายวิทยา ตั้งใจ",
    classroom: "ม.6/2",
    roll_number: 3,
    student_status: "graduated",
    student_status_year: 2568,
    account_revision: 0,
  },
];
const controlClass =
  "w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand disabled:opacity-50";
const demoOutstanding: Record<string, number> = {
  "60000000-0000-4000-8000-000000000001": 2,
};
const buttonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 border border-line px-4 py-2.5 text-sm font-medium transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminStudentLifecycle({
  demo = false,
  onImport,
}: {
  demo?: boolean;
  onImport: () => void;
}) {
  const [data, setData] = useState<LifecycleList>(empty);
  const [demoRows, setDemoRows] = useState(samples);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StudentStatus | "all">("active");
  const [level, setLevel] = useState("");
  const [classroom, setClassroom] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notGraduated, setNotGraduated] = useState<
    LifecycleChangeResult["notGraduated"]
  >([]);
  const [selected, setSelected] = useState<Record<string, LifecycleStudent>>(
    {},
  );
  const [nextStatus, setNextStatus] = useState<StudentStatus>("graduated");
  const [year, setYear] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selectedRows = Object.values(selected);
  const pages = Math.max(1, Math.ceil(data.total / 50));
  const disabled = busy || review;

  function filterChanged() {
    setPage(1);
    setSelected({});
    setReview(false);
    setLoading(true);
    setError("");
    setNotice("");
    setNotGraduated([]);
  }
  function demoList(pageSize: number, requestedPage: number): LifecycleList {
    const rows = demoRows
      .filter(
        (row) =>
          (status === "all" || row.student_status === status) &&
          (!level || studentLevel(row.classroom) === Number(level)) &&
          (!classroom || row.classroom === classroom) &&
          (row.full_name.toLowerCase().includes(search.trim().toLowerCase()) ||
            row.student_code.includes(search.trim())),
      )
      .sort(compareStudents);
    return {
      items: rows.slice(
        (requestedPage - 1) * pageSize,
        requestedPage * pageSize,
      ),
      total: rows.length,
      classrooms: [
        ...new Set(
          demoRows
            .filter(
              (row) => !level || studentLevel(row.classroom) === Number(level),
            )
            .flatMap((row) => (row.classroom ? [row.classroom] : [])),
        ),
      ].sort((a, b) =>
        compareStudents(
          { classroom: a, roll_number: null, student_code: "" },
          { classroom: b, roll_number: null, student_code: "" },
        ),
      ),
      counts: {
        not_graduated: demoRows.filter(
          (row) => row.student_status === "not_graduated",
        ).length,
        active: demoRows.filter((row) => row.student_status === "active")
          .length,
        graduated: demoRows.filter((row) => row.student_status === "graduated")
          .length,
        transferred: demoRows.filter(
          (row) => row.student_status === "transferred",
        ).length,
      },
    };
  }
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError("");
      try {
        const result = demo
          ? { data: demoList(50, page) }
          : await listStudentLifecycle({
              search,
              status,
              level: level ? Number(level) : null,
              classroom: classroom || null,
              page,
              pageSize: 50,
            });
        if (cancelled) return;
        if (result.error || !result.data) {
          setData(empty);
          setLoadError(result.error ?? "โหลดรายชื่อไม่สำเร็จ");
        } else {
          setData(result.data);
          if (page > Math.max(1, Math.ceil(result.data.total / 50)))
            setPage(Math.max(1, Math.ceil(result.data.total / 50)));
        }
      } catch {
        if (!cancelled) {
          setData(empty);
          setLoadError("โหลดรายชื่อไม่สำเร็จ กรุณาลองใหม่");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // demoList uses exactly these filter and row dependencies.
  }, [demo, demoRows, search, status, level, classroom, page, refresh]);

  async function selectAll() {
    if (lock.current || disabled || loading) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = demo
        ? { data: demoList(2000, 1) }
        : await listStudentLifecycle({
            search,
            status,
            level: level ? Number(level) : null,
            classroom: classroom || null,
            page: 1,
            pageSize: 2000,
          });
      if (result.error || !result.data) {
        setError(result.error ?? "เลือกรายชื่อไม่สำเร็จ");
        return;
      }
      if (result.data.total > 2000) {
        setError("เลือกได้ครั้งละ 2,000 คน กรุณากรองระดับชั้นหรือห้องให้แคบลง");
        return;
      }
      setSelected(
        Object.fromEntries(result.data.items.map((row) => [row.id, row])),
      );
    } catch {
      setError("เลือกรายชื่อไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function openReview() {
    setError("");
    setNotice("");
    setNotGraduated([]);
    if (!selectedRows.length) {
      setError("กรุณาเลือกนักเรียนอย่างน้อย 1 คน");
      return;
    }
    if (selectedRows.length > 2000) {
      setError("เลือกได้ครั้งละ 2,000 คน");
      return;
    }
    if (
      nextStatus !== "active" &&
      (!/^\d{4}$/.test(year) || Number(year) < 2500 || Number(year) > 2800)
    ) {
      setError("กรุณาระบุปีการศึกษา พ.ศ. ระหว่าง 2500–2800");
      return;
    }
    setReview(true);
  }
  async function save() {
    if (lock.current || !review) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const targetYear = nextStatus === "active" ? null : Number(year);
      const demoNotGraduated =
        nextStatus === "graduated"
          ? selectedRows
              .filter((row) => demoOutstanding[row.id])
              .map((row) => ({
                id: row.id,
                student_code: row.student_code,
                full_name: row.full_name,
                outstanding_count: demoOutstanding[row.id],
              }))
          : [];
      const demoStatus = (row: LifecycleStudent): StudentStatus =>
        nextStatus === "graduated" && demoOutstanding[row.id]
          ? "not_graduated"
          : nextStatus;
      const changed = selectedRows.filter(
        (row) =>
          row.student_status !== demoStatus(row) ||
          row.student_status_year !== targetYear,
      );
      const result = demo
        ? {
            updated: changed.length,
            graduated: changed.filter((row) => demoStatus(row) === "graduated")
              .length,
            notGraduated: demoNotGraduated,
          }
        : await changeStudentStatus({
            students: selectedRows.map((row) => ({
              id: row.id,
              revision: row.account_revision,
            })),
            status: nextStatus,
            year: targetYear,
          });
      if (
        result.error ||
        result.updated === undefined ||
        result.graduated === undefined ||
        !result.notGraduated
      ) {
        setError(result.error ?? "ไม่สามารถยืนยันผลได้ กรุณาโหลดรายชื่อใหม่");
        setReview(false);
        return;
      }
      if (demo)
        setDemoRows((rows) =>
          rows.map((row) =>
            changed.some((changedRow) => changedRow.id === row.id)
              ? {
                  ...row,
                  student_status: demoStatus(row),
                  student_status_year: targetYear,
                  account_revision: row.account_revision + 1,
                }
              : row,
          ),
        );
      setNotice(
        (nextStatus === "graduated"
          ? `บันทึกข้อมูลเปลี่ยนแปลง ${result.updated.toLocaleString("th-TH")} คน · จบการศึกษา ${result.graduated.toLocaleString("th-TH")} คน · ไม่จบการศึกษาเพราะมีผลการเรียนคงค้าง ${result.notGraduated.length.toLocaleString("th-TH")} คน`
          : `บันทึกสถานะ${studentStatusLabels[nextStatus]}แล้ว ${result.updated.toLocaleString("th-TH")} คน`) +
          (demo ? " · ข้อมูลทดลอง" : ""),
      );
      setNotGraduated(result.notGraduated);
      setSelected({});
      setReview(false);
      setRefresh((v) => v + 1);
      setLoading(true);
    } catch {
      setError("ไม่สามารถยืนยันผลได้ กรุณาโหลดรายชื่อใหม่ก่อนลองอีกครั้ง");
      setReview(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <GraduationCap className="shrink-0 text-brand" size={22} />
          จัดการนักเรียนปีการศึกษาใหม่
        </h2>
        <p className="mt-2 text-sm leading-7 text-secondary">
          เปลี่ยนสถานะนักเรียนที่จบหรือย้ายออก
          แล้วนำเข้าไฟล์รายชื่อปีใหม่เพื่ออัปเดตชั้น/ห้องและเพิ่มนักเรียนใหม่
          ประวัติผลการเรียนและบัญชีเดิมยังใช้ติดตามงานค้างได้
        </p>
        <button
          type="button"
          className={`${buttonClass} mt-4 text-brand`}
          disabled={busy || review}
          onClick={onImport}
        >
          ไปนำเข้ารายชื่อ
          <ArrowRight size={16} />
        </button>
        <p className="mt-2 text-sm leading-6 text-secondary">
          ใช้รหัสนักเรียนเดิมเพื่อจับคู่บัญชี การนำเข้าจะคงสถานะเดิมไว้
          หากกลับมาเรียนให้เปลี่ยนเป็น “กำลังศึกษา” ในหน้านี้ก่อน
          นักเรียนที่ไม่อยู่ในไฟล์จะคงสถานะเดิม
        </p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(studentStatusLabels) as StudentStatus[]).map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => {
              filterChanged();
              setStatus(key);
            }}
            aria-pressed={status === key}
            className={`cursor-pointer rounded-xl border p-5 text-left transition-colors disabled:opacity-50 ${status === key ? "border-brand bg-brand-soft" : "border-line bg-white hover:bg-brand-soft/40"}`}
          >
            <span className="text-sm text-secondary">
              {studentStatusLabels[key]}ทั้งหมด
            </span>
            <strong className="mt-2 block text-3xl text-brand">
              {loading
                ? <><Skeleton className="h-8 w-14" /><span className="sr-only">กำลังโหลด</span></>
                : loadError
                  ? "—"
                  : (data.counts[key]?.toLocaleString("th-TH") ?? "—")}
            </strong>
          </button>
        ))}
      </div>
      <section
        className="overflow-hidden rounded-xl border border-line bg-white"
        aria-label="รายชื่อตามสถานะการศึกษา"
      >
        <fieldset
          disabled={disabled}
          className="grid gap-3 border-b border-line p-5 sm:grid-cols-2 xl:grid-cols-4"
        >
          <label className="text-sm">
            ค้นหานักเรียน
            <div className="relative mt-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-3.5 left-3 text-secondary"
              />
              <input
                className={`${controlClass} pl-9`}
                value={search}
                maxLength={150}
                placeholder="ชื่อหรือรหัสนักเรียน"
                onChange={(e) => {
                  filterChanged();
                  setSearch(e.target.value);
                }}
              />
            </div>
          </label>
          <label className="text-sm">
            สถานะ
            <select
              className={`${controlClass} mt-1`}
              aria-label="สถานะ"
              value={status}
              onChange={(e) => {
                filterChanged();
                setStatus(e.target.value as StudentStatus | "all");
              }}
            >
              <option value="all">ทุกสถานะ</option>
              {Object.entries(studentStatusLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            ระดับชั้น
            <select
              className={`${controlClass} mt-1`}
              aria-label="ระดับชั้น"
              value={level}
              onChange={(e) => {
                filterChanged();
                setLevel(e.target.value);
                setClassroom("");
              }}
            >
              <option value="">ทุกระดับชั้น</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  ม.{n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            ชั้น/ห้อง
            <select
              className={`${controlClass} mt-1`}
              aria-label="ชั้น/ห้อง"
              value={classroom}
              onChange={(e) => {
                filterChanged();
                setClassroom(e.target.value);
              }}
            >
              <option value="">ทุกห้อง</option>
              {data.classrooms.map((room) => (
                <option key={room}>{room}</option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            พบ {data.total.toLocaleString("th-TH")} คน · เลือกแล้ว{" "}
            {selectedRows.length.toLocaleString("th-TH")} คน
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || loading || !!loadError || !data.total}
              onClick={selectAll}
            >
              เลือกทุกคนตามตัวกรอง
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || !selectedRows.length}
              onClick={() => setSelected({})}
            >
              ยกเลิกการเลือก
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={disabled}
              onClick={() => {
                setSelected({});
                setLoading(true);
                setRefresh((v) => v + 1);
                setError("");
              }}
            >
              <RefreshCw size={15} />
              โหลดใหม่
            </button>
          </div>
        </div>
        {loadError ? (
          <p role="alert" className="p-5 text-sm text-red-700">
            {loadError}
          </p>
        ) : (
          <div className="overflow-x-auto" aria-busy={loading}>
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f6fc] text-secondary">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="เลือกทุกคนในหน้านี้"
                      disabled={disabled || loading || !data.items.length}
                      checked={
                        data.items.length > 0 &&
                        data.items.every((row) => !!selected[row.id])
                      }
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelected((current) => {
                          const next = { ...current };
                          for (const row of data.items) {
                            if (checked) next[row.id] = row;
                            else delete next[row.id];
                          }
                          return next;
                        });
                      }}
                    />
                  </th>
                  {[
                    "รหัสนักเรียน",
                    "ชื่อ-นามสกุล",
                    "ชั้น/ห้อง",
                    "เลขที่",
                    "สถานะ",
                    "ปีการศึกษา พ.ศ.",
                  ].map((title) => (
                    <th
                      className="whitespace-nowrap px-4 py-3 font-medium"
                      key={title}
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRows columns={7} />
                ) : data.items.length ? (
                  data.items.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-line hover:bg-brand-soft/20"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`เลือก ${row.student_code} ${row.full_name}`}
                          checked={!!selected[row.id]}
                          disabled={disabled}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelected((current) => {
                              const next = { ...current };
                              if (checked) next[row.id] = row;
                              else delete next[row.id];
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-brand">
                        {row.student_code}
                      </td>
                      <td className="min-w-56 px-4 py-3 font-medium">
                        {row.full_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.classroom ?? "—"}
                      </td>
                      <td className="px-4 py-3">{row.roll_number ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {studentStatusLabels[row.student_status]}
                      </td>
                      <td className="px-4 py-3">
                        {row.student_status_year ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-secondary">
                      ไม่พบนักเรียนตามตัวกรอง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line p-4 text-sm">
          <span>
            หน้า {page} / {pages}
          </span>
          <div className="flex gap-2">
            <button
              className={buttonClass}
              disabled={disabled || loading || page <= 1}
              onClick={() => {
                setLoading(true);
                setPage((p) => p - 1);
              }}
            >
              ก่อนหน้า
            </button>
            <button
              className={buttonClass}
              disabled={disabled || loading || page >= pages}
              onClick={() => {
                setLoading(true);
                setPage((p) => p + 1);
              }}
            >
              ถัดไป
            </button>
          </div>
        </div>
      </section>
      <section
        className="rounded-xl border border-line bg-white p-5"
        aria-label="เปลี่ยนสถานะนักเรียน"
      >
        <h2 className="text-lg font-semibold">
          เปลี่ยนสถานะที่เลือก · {selectedRows.length.toLocaleString("th-TH")}{" "}
          คน
        </h2>
        <fieldset
          disabled={disabled}
          className="mt-4 grid gap-4 sm:grid-cols-2"
        >
          <label className="text-sm">
            สถานะใหม่
            <select
              className={`${controlClass} mt-1`}
              aria-label="สถานะใหม่"
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as StudentStatus)}
            >
              {Object.entries(studentStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {key === "active" ? "กลับมาเป็นนักเรียนที่กำลังศึกษา" : label}
                </option>
              ))}
            </select>
          </label>
          {nextStatus !== "active" && (
            <label className="text-sm">
              ปีการศึกษาที่บันทึกสถานะ (พ.ศ.)
              <input
                className={`${controlClass} mt-1`}
                value={year}
                inputMode="numeric"
                maxLength={4}
                placeholder="เช่น 2569"
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
          )}
        </fieldset>
        {nextStatus === "graduated" && (
          <p className="mt-3 text-sm leading-7 text-amber-800">
            ระบบจะตรวจผลการเรียนทุกปีและทุกภาคเรียนตอนบันทึก
            หากยังมีรายการที่แก้ไขไม่เสร็จ จะเปลี่ยนเป็น “ไม่จบการศึกษา”
            รวมถึงรายการที่รอฝ่ายวัดผลอนุมัติ
          </p>
        )}
        {!review && (
          <button
            type="button"
            className={`${buttonClass} mt-4 bg-brand text-white hover:bg-brand/90`}
            disabled={busy || loading || !selectedRows.length}
            onClick={openReview}
          >
            ตรวจสอบก่อนบันทึก
          </button>
        )}
        {review && (
          <div className="mt-4 rounded-lg border border-brand/30 bg-brand-soft/40 p-4">
            <h3 className="font-semibold">ตรวจสอบการเปลี่ยนสถานะ</h3>
            <p className="mt-2 text-sm leading-7">
              นักเรียนที่เลือก {selectedRows.length.toLocaleString("th-TH")} คน
              → {studentStatusLabels[nextStatus]}
              {nextStatus !== "active" ? ` ปีการศึกษา ${year}` : ""}
            </p>
            <p className="text-sm leading-7 text-secondary">
              {nextStatus === "active"
                ? "รายชื่อจะกลับมาแสดงในหน้ารายชื่อนักเรียนปัจจุบัน"
                : nextStatus === "graduated"
                  ? "ผู้ที่แก้ผลการเรียนครบแล้วจะเป็นจบการศึกษา ผู้ที่ยังมีรายการค้างจะเป็นไม่จบการศึกษา ทั้งสองกลุ่มดูได้จากตัวกรองสถานะในหน้านี้ และจะไม่แสดงในรายชื่อนักเรียนปัจจุบัน"
                  : nextStatus === "not_graduated"
                    ? "นักเรียนจะไม่แสดงในรายชื่อนักเรียนปัจจุบัน ดูได้จากตัวกรองไม่จบการศึกษาในหน้านี้ และยังติดตามผลการเรียนคงค้างได้"
                    : "รายชื่อจะย้ายไปอยู่ในตัวกรองย้อนหลัง บัญชีและผลการเรียนค้างยังใช้งานต่อได้"}
            </p>
            <ul className="mt-3 max-h-52 overflow-y-auto rounded border border-line bg-white p-3 text-sm">
              {selectedRows.map((row) => (
                <li key={row.id} className="py-1.5">
                  {row.student_code} · {row.full_name} ·{" "}
                  {row.classroom ?? "ไม่ระบุห้อง"} · เดิม
                  {studentStatusLabels[row.student_status]}
                  {row.student_status_year ? ` ${row.student_status_year}` : ""}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={`${buttonClass} bg-brand text-white hover:bg-brand/90`}
                disabled={busy}
                onClick={save}
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                ยืนยันบันทึกสถานะ
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => setReview(false)}
              >
                กลับไปแก้ไข
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 text-sm text-brand">
            {notice}
          </p>
        )}
        {notGraduated.length > 0 && (
          <div
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
            aria-label="รายชื่อนักเรียนที่ไม่จบการศึกษา"
          >
            <h3 className="font-semibold text-amber-900">
              ไม่จบการศึกษา · ยังมีผลการเรียนคงค้าง
            </h3>
            <ul className="mt-2 max-h-60 overflow-y-auto text-sm text-amber-900">
              {notGraduated.map((row) => (
                <li key={row.id} className="py-1.5">
                  {row.student_code} · {row.full_name} · คงค้าง{" "}
                  {row.outstanding_count.toLocaleString("th-TH")} รายการ
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-amber-900">
              เมื่อแก้ผลการเรียนครบแล้ว ให้เลือกนักเรียนจากสถานะ “ไม่จบการศึกษา”
              และกดจบการศึกษาอีกครั้ง
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
