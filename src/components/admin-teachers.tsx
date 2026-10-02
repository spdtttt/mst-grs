"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Search } from "lucide-react";
import {
  listTeachers,
  resetTeacherAccount,
  resetAcademicAccount,
} from "@/app/teacher-actions";
import {
  TEACHER_PAGE_SIZE,
  type TeacherList,
  type TeacherRow,
} from "@/lib/teachers";

import { listAcademics } from "@/app/academic-actions";

const emptyList: TeacherList = { total: 0, items: [] };
const demoTeachers = [
  { id: "demo-teacher-1", full_name: "นายสมชาย ใจดี" },
  { id: "demo-teacher-2", full_name: "นางสาววรัญญา แสงทอง" },
  { id: "demo-teacher-3", full_name: "นางกมลพร รักเรียน" },
];
const buttonStyle =
  "rounded-lg border border-line cursor-pointer px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminTeachers({
  demo = false,
  currentUserId,
  staffRole = "teacher",
  refreshKey = 0,
  demoEntries,
  onDemoReset,
}: {
  demo?: boolean;
  currentUserId: string;
  staffRole?: "teacher" | "academic";
  refreshKey?: number;
  demoEntries?: TeacherRow[];
  onDemoReset?: (id: string) => void;
}) {
  const staffLabel = staffRole === "teacher" ? "คุณครู" : "ฝ่ายวิชาการ";
  const [data, setData] = useState<TeacherList>(emptyList);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [demoRows, setDemoRows] = useState(demoEntries ?? demoTeachers);
  const [selected, setSelected] = useState<TeacherRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const resetting = useRef(false);

  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    else if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);

  async function reset() {
    if (!selected || resetting.current) return;
    resetting.current = true;
    setBusy(true);
    setResetError("");
    setNotice("");
    try {
      const result = demo
        ? { success: true }
        : await (
            staffRole === "teacher" ? resetTeacherAccount : resetAcademicAccount
          )(selected);
      if (result.error) {
        setResetError(result.error);
        return;
      }
      if (!result.success) {
        setResetError("ไม่สามารถยืนยันผลการรีเซ็ตได้ กรุณาโหลดรายชื่อใหม่");
        return;
      }
      if (demo) {
        setDemoRows((rows) => rows.filter((row) => row.id !== selected.id));
        onDemoReset?.(selected.id);
      }
      setNotice(
        `ลบบัญชีของ ${selected.full_name} แล้ว สามารถสร้างบัญชีใหม่ได้${demo ? " · ข้อมูลทดลอง" : ""}`,
      );
      setSelected(null);
      if (data.items.length === 1 && page > 1) setPage((value) => value - 1);
      setLoading(true);
      setRefresh((value) => value + 1);
    } catch {
      setResetError(
        "ไม่สามารถยืนยันผลการรีเซ็ตได้ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง",
      );
    } finally {
      resetting.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const items = demoRows
          .filter((teacher) => teacher.full_name.includes(search.trim()))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "th"));
        const result = demo
          ? {
              data: {
                total: items.length,
                items: items.slice(
                  (page - 1) * TEACHER_PAGE_SIZE,
                  page * TEACHER_PAGE_SIZE,
                ),
              },
            }
          : await (staffRole === "teacher" ? listTeachers : listAcademics)({
              search,
              page,
            });
        if (cancelled) return;
        if (result.error) {
          setData(emptyList);
          setError(result.error);
        } else if (result.data) setData(result.data);
      } catch {
        if (!cancelled) {
          setData(emptyList);
          setError("ไม่สามารถโหลดรายชื่อได้ กรุณาตรวจสอบการเชื่อมต่อ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [demo, demoRows, search, page, refresh, refreshKey, staffRole]);

  const pages = Math.max(1, Math.ceil(data.total / TEACHER_PAGE_SIZE));
  return (
    <section
      aria-label={`จัดการรายชื่อ${staffLabel}`}
      className="overflow-hidden rounded-xl border border-line bg-white"
    >
      <dialog
        ref={dialog}
        aria-labelledby="teacher-reset-title"
        onCancel={(event) => {
          if (resetting.current) event.preventDefault();
          else setSelected(null);
        }}
        onClose={() => {
          if (!resetting.current) setSelected(null);
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md border border-line bg-white p-6 text-ink shadow-xl backdrop:bg-black/40"
      >
        <h2 id="teacher-reset-title" className="text-xl font-semibold">
          ยืนยันรีเซ็ทรหัสผ่าน
        </h2>
        <p className="mt-3 text-lg break-words font-medium">{selected?.full_name}</p>
        <p className="mt-3 text-sm leading-7 text-secondary">
          การรีเซ็ตนี้จะลบข้อมูล{staffLabel}และบัญชีเข้าสู่ระบบ
          พร้อมสิทธิ์ทุกบทบาทของบัญชีนี้
          ต้องสร้างบัญชีใหม่เพื่อตั้งรหัสผ่านและกำหนดสิทธิ์ใหม่
        </p>
        <p className="mt-2 text-sm leading-7 text-secondary">
          หากมีผลการเรียน งาน ประวัติ หรือไฟล์ที่อ้างถึงบัญชี ระบบจะไม่ลบข้อมูล
        </p>
        {resetError && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {resetError}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            autoFocus
            className={buttonStyle}
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reset}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg duration-150 bg-red-700 hover:bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "กำลังลบบัญชี..." : "ยืนยันลบบัญชี"}
          </button>
        </div>
      </dialog>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5 max-desk:p-4">
        <div>
          <h2 className="text-lg font-semibold">รายชื่อ{staffLabel}</h2>
          <p className="mt-1 text-sm text-secondary">
            {loading
              ? "กำลังโหลด..."
              : `ทั้งหมด ${data.total.toLocaleString("th-TH")} คน`}
          </p>
        </div>
        <label className="flex w-full items-center gap-2 rounded-lg border border-line px-3 sm:w-72">
          <Search size={16} className="shrink-0 text-secondary" />
          <input
            aria-label={`ค้นหาชื่อ${staffLabel}`}
            placeholder={`ค้นหาชื่อ${staffLabel}`}
            value={search}
            maxLength={150}
            disabled={busy}
            className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              setLoading(true);
            }}
          />
        </label>
      </div>
      {notice && (
        <p
          role="status"
          className="border-b border-line bg-brand-soft p-4 text-sm text-brand"
        >
          {notice}
        </p>
      )}
      {error ? (
        <div role="alert" className="p-6 text-center text-sm text-red-700">
          <p>{error}</p>
          <button
            type="button"
            className={`${buttonStyle} mt-3`}
            onClick={() => setRefresh((value) => value + 1)}
          >
            ลองโหลดใหม่
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f8f6fc] text-sm text-secondary">
              <tr>
                {["ชื่อ-สกุล", "ดำเนินการ"].map((heading) => (
                  <th
                    key={heading}
                    className="whitespace-nowrap px-5 py-3 font-medium"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2} className="p-10 text-center text-secondary">
                    <Loader2 size={22} className="mx-auto mb-2 animate-spin" />
                    กำลังโหลดรายชื่อ...
                  </td>
                </tr>
              ) : data.items.length ? (
                data.items.map((teacher) => (
                  <tr
                    key={teacher.id}
                    className="border-t border-line hover:bg-brand-soft/30"
                  >
                    <td className="min-w-44 px-5 py-4 font-medium">
                      {teacher.full_name}
                    </td>
                    <td className="px-5 py-4 text-xs text-secondary">
                      <button
                        type="button"
                        disabled={busy || teacher.id === currentUserId}
                        aria-label={`รีเซ็ทรหัสผ่าน ${teacher.full_name}`}
                        title={
                          teacher.id === currentUserId
                            ? "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้"
                            : undefined
                        }
                        className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border duration-150 cursor-pointer border-brand/25 px-3 py-2 text-xs font-medium text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                          setResetError("");
                          setSelected(teacher);
                        }}
                      >
                        <RotateCcw size={15} />
                        รีเซ็ทรหัสผ่าน
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="p-10 text-center text-secondary">
                    {search
                      ? `ไม่พบ${staffLabel}ตามคำค้นหา`
                      : `ยังไม่มีข้อมูล${staffLabel}`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 text-sm text-secondary">
        <span>
          หน้า {page} / {pages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonStyle}
            disabled={loading || busy || page <= 1}
            onClick={() => {
              setPage((value) => value - 1);
              setLoading(true);
            }}
          >
            ก่อนหน้า
          </button>
          <button
            type="button"
            className={buttonStyle}
            disabled={loading || busy || page >= pages}
            onClick={() => {
              setPage((value) => value + 1);
              setLoading(true);
            }}
          >
            ถัดไป
          </button>
        </div>
      </div>
    </section>
  );
}
