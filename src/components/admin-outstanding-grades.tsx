"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import {
  deleteOutstandingGrades,
  listOutstandingGrades,
} from "@/app/actions";
import type { AdminOutstandingGradePage } from "@/lib/domain";
import { statuses } from "@/lib/domain";

const empty: AdminOutstandingGradePage = {
  items: [],
  total: 0,
  classrooms: [],
};
const pageSize = 50;
const controlClass =
  "w-full border border-[#e1dce9] bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] disabled:cursor-not-allowed disabled:bg-[#f8f7fa] disabled:text-muted";
const buttonClass =
  "inline-flex items-center justify-center gap-2 border border-[#e3ddea] bg-white px-3.5 py-2.5 text-sm font-medium text-[#625670] transition hover:bg-[#f8f5fc] focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminOutstandingGrades({
  refreshVersion,
}: {
  refreshVersion: number;
}) {
  const [data, setData] = useState(empty);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [classroom, setClassroom] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const pageIds = data.items.map((row) => row.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const result = await listOutstandingGrades({
          search,
          level: level ? Number(level) : null,
          classroom: classroom || null,
          page,
        });
        if (cancelled) return;
        if (result.error || !result.data) {
          setData(empty);
          setError(result.error ?? "โหลดรายการผลการเรียนไม่สำเร็จ");
        } else {
          setData(result.data);
          if (page > Math.max(1, Math.ceil(result.data.total / pageSize)))
            setPage(Math.max(1, Math.ceil(result.data.total / pageSize)));
        }
      } catch {
        if (!cancelled) {
          setData(empty);
          setError("โหลดรายการผลการเรียนไม่สำเร็จ กรุณาลองใหม่");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, level, classroom, page, refresh, refreshVersion]);

  function changeFilter(change: () => void) {
    setPage(1);
    setSelected([]);
    setNotice("");
    setError("");
    change();
  }

  function deleteSelected() {
    if (!selected.length || busy) return;
    const count = selected.length;
    if (!window.confirm(
      `ยืนยันนำ ${count.toLocaleString("th-TH")} รายการออกจากรายการคงค้าง?\n\nระบบจะเก็บข้อมูลผลการเรียน งาน ไฟล์แนบ และประวัติเดิมไว้สำหรับผู้ดูแลก่อนดำเนินการ`,
    )) return;

    startTransition(async () => {
      setError("");
      setNotice("");
      try {
        const result = await deleteOutstandingGrades(selected);
        if (result.error) {
          setError(result.error);
          setRefresh((value) => value + 1);
          setSelected([]);
          return;
        }
        setSelected([]);
        setNotice(`นำ ${result.deleted?.toLocaleString("th-TH") ?? count.toLocaleString("th-TH")} รายการออกจากรายการคงค้างแล้ว · เก็บข้อมูลเดิมไว้ในประวัติผู้ดูแล`);
        setRefresh((value) => value + 1);
      } catch {
        setError("ไม่สามารถลบรายการได้ กรุณาลองใหม่");
        setRefresh((value) => value + 1);
        setSelected([]);
      }
    });
  }

  return (
    <section className="mt-6 overflow-hidden rounded-[13px] border border-line bg-white shadow-[0_3px_14px_#27203c08]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6 pb-4 max-desk:px-4 max-desk:pt-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">รายการผลการเรียนคงค้าง</h2>
          <p className="mt-1 text-sm text-secondary">ค้นหา กรองตามชั้น/ห้อง และจัดการรายการในรอบปัจจุบัน</p>
        </div>
        <span className="rounded-md bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
          {data.total.toLocaleString("th-TH")} รายการ
        </span>
      </div>

      <div className="grid grid-cols-[minmax(220px,1fr)_170px_170px] gap-3 px-6 pb-4 max-desk:grid-cols-1 max-desk:px-4">
        <label className="relative block text-sm">
          <span className="sr-only">ค้นหารายการผลการเรียน</span>
          <Search size={17} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#9b90a8]" />
          <input
            className={`${controlClass} pl-9`}
            type="search"
            value={search}
            placeholder="ค้นหาชื่อ รหัสนักเรียน วิชา หรือครู"
            onChange={(event) => changeFilter(() => setSearch(event.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">กรองระดับชั้น</span>
          <select
            className={controlClass}
            aria-label="ระดับชั้น"
            value={level}
            onChange={(event) => changeFilter(() => {
              setLevel(event.target.value);
              setClassroom("");
            })}
          >
            <option value="">ทุกระดับชั้น</option>
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>ม.{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">กรองห้อง</span>
          <select
            className={controlClass}
            aria-label="ห้อง"
            value={classroom}
            disabled={!level}
            onChange={(event) => changeFilter(() => setClassroom(event.target.value))}
          >
            <option value="">ทุกห้อง</option>
            {data.classrooms.map((room) => <option key={room} value={room}>{room}</option>)}
          </select>
        </label>
      </div>

      {notice ? <p role="status" className="mx-6 mb-3 rounded-lg bg-[#eef8f1] px-4 py-3 text-sm text-[#287848] max-desk:mx-4">{notice}</p> : null}
      {error ? <p role="alert" className="mx-6 mb-3 rounded-lg bg-[#fff4f4] px-4 py-3 text-sm text-red-700 max-desk:mx-4">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line bg-[#fcfbfd] px-6 py-3 max-desk:px-4">
        <p className="text-sm text-secondary">
          เลือกแล้ว {selected.length.toLocaleString("th-TH")} รายการ
          {selected.length > 0 ? " · เก็บรายละเอียดเดิมไว้ในประวัติผู้ดูแล" : ""}
        </p>
        <button type="button" className="inline-flex items-center gap-2 bg-[#fff1f1] px-3.5 py-2.5 text-sm font-medium text-[#a8444e] transition hover:bg-[#ffe3e4] focus-visible:outline-3 cursor-pointer focus-visible:outline-[#ed9aa1] disabled:cursor-not-allowed disabled:opacity-50" disabled={!selected.length || busy || loading} onClick={deleteSelected}>
          <Trash2 size={16} />
          {busy ? "กำลังลบ…" : `ลบรายการที่เลือก${selected.length ? ` (${selected.length})` : ""}`}
        </button>
      </div>

      <div className="overflow-x-auto" aria-busy={loading}>
        <table className="w-full min-w-[1250px] border-collapse text-left text-sm">
          <thead className="bg-[#f8f6fc] text-secondary">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="เลือกทุกรายการในหน้านี้"
                  disabled={loading || busy || !pageIds.length}
                  checked={allPageSelected}
                  onChange={(event) => setSelected((current) => event.target.checked
                    ? [...new Set([...current, ...pageIds])]
                    : current.filter((id) => !pageIds.includes(id)))}
                />
              </th>
              {["รหัสนักเรียน", "ชื่อ-นามสกุล", "ชั้น/ห้อง", "รายวิชา", "ปี/ภาคเรียน", "ผลเดิม", "สถานะ", "ครูผู้สอน"].map((title) => (
                <th key={title} className="whitespace-nowrap px-4 py-3 font-medium">{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-10 text-center text-secondary">กำลังโหลดรายการผลการเรียน…</td></tr>
            ) : data.items.length ? data.items.map((row) => (
              <tr key={row.id} className="border-t border-line hover:bg-brand-soft/15">
                <td className="px-4 py-3">
                  <input type="checkbox" aria-label={`เลือกรายการ ${row.student_code} ${row.course_code}`} checked={selected.includes(row.id)} disabled={busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />
                </td>
                <td className="px-4 py-3 font-medium text-brand">{row.student_code}</td>
                <td className="min-w-52 px-4 py-3 font-medium">{row.student_name}</td>
                <td className="whitespace-nowrap px-4 py-3">{row.classroom}</td>
                <td className="min-w-56 px-4 py-3">{row.course_code} {row.course_name}</td>
                <td className="whitespace-nowrap px-4 py-3">{row.academic_year}/{row.semester}</td>
                <td className="px-4 py-3">{row.original_grade}</td>
                <td className="whitespace-nowrap px-4 py-3">{statuses[row.status].label}</td>
                <td className="min-w-48 px-4 py-3">{row.teacher_name.join(", ")}</td>
              </tr>
            )) : (
              <tr><td colSpan={9} className="p-10 text-center text-secondary">ไม่พบรายการผลการเรียนคงค้างตามตัวกรอง</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3 max-desk:px-4">
        <p className="text-sm text-secondary">หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</p>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} aria-label="หน้าก่อนหน้า" disabled={page <= 1 || loading || busy} onClick={() => { setPage((current) => current - 1); setSelected([]); }}>
            <ChevronLeft size={16} /> ก่อนหน้า
          </button>
          <button type="button" className={buttonClass} aria-label="หน้าถัดไป" disabled={page >= totalPages || loading || busy} onClick={() => { setPage((current) => current + 1); setSelected([]); }}>
            ถัดไป <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
