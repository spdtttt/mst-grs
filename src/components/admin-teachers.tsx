"use client";
import { useEffect, useState } from "react";
import Select from "react-select";
import { Loader2, Search } from "lucide-react";
import { listTeachers } from "@/app/teacher-actions";
import {
  TEACHER_PAGE_SIZE,
  TEACHER_SUBJECT_GROUPS,
  type TeacherList,
  type TeacherRow,
} from "@/lib/teachers";

import AdminAccountRow from "./admin-account-row";
import TeacherRegistryPanel from "./teacher-registry-panel";
import type { AccountRow } from "@/lib/admin-accounts";

import { listAcademics } from "@/app/academic-actions";

const emptyList: TeacherList = { total: 0, items: [] };
const subjectOptions = [
  { value: "", label: "ทุกกลุ่มสาระการเรียนรู้" },
  ...TEACHER_SUBJECT_GROUPS.map((value) => ({ value, label: value })),
];
const demoTeachers: TeacherRow[] = [
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
  onDemoEdit,
}: {
  demo?: boolean;
  currentUserId: string;
  staffRole?: "teacher" | "academic";
  refreshKey?: number;
  demoEntries?: TeacherRow[];
  onDemoReset?: (id: string) => void;
  onDemoEdit?: (row: TeacherRow) => void;
}) {
  const staffLabel = staffRole === "teacher" ? "คุณครู" : "ฝ่ายวัดผล";
  const [data, setData] = useState<TeacherList>(emptyList);
  const [search, setSearch] = useState("");
  const [subjectGroup, setSubjectGroup] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [demoRows, setDemoRows] = useState(demoEntries ?? demoTeachers);
  function saved(row: AccountRow) {
    if (demo) {
      setDemoRows((rows) =>
        rows.map((item) => (item.id === row.id ? { ...item, ...row } : item)),
      );
      onDemoEdit?.(row);
    } else setRefresh((value) => value + 1);
  }
  function deleted(id: string) {
    if (demo) {
      setDemoRows((rows) => rows.filter((row) => row.id !== id));
      onDemoReset?.(id);
    } else setRefresh((value) => value + 1);
    if (data.items.length === 1 && page > 1) setPage((value) => value - 1);
  }
  function imported(rows: AccountRow[]) {
    if (demo)
      setDemoRows((previous) => {
        const merged = new Map(previous.map((row) => [row.id, row]));
        rows.forEach((row) => merged.set(row.id, row));
        return [...merged.values()];
      });
    else setRefresh((value) => value + 1);
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const items = demoRows
          .filter((teacher) => teacher.full_name.includes(search.trim()))
          .filter(
            (teacher) =>
              staffRole !== "teacher" ||
              !subjectGroup ||
              teacher.learning_subject_group?.trim() === subjectGroup,
          )
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "th"));
        const result: { data?: TeacherList; error?: string } = demo
          ? {
              data: {
                total: items.length,
                items: items.slice(
                  (page - 1) * TEACHER_PAGE_SIZE,
                  page * TEACHER_PAGE_SIZE,
                ),
              },
            }
          : staffRole === "teacher"
            ? await listTeachers({ search, page, subject_group: subjectGroup })
            : await listAcademics({ search, page });
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
  }, [
    demo,
    demoRows,
    search,
    subjectGroup,
    page,
    refresh,
    refreshKey,
    staffRole,
  ]);

  const pages = Math.max(1, Math.ceil(data.total / TEACHER_PAGE_SIZE));
  return (
    <>
      {staffRole === "teacher" && (
        <TeacherRegistryPanel demo={demo} onSaved={imported} />
      )}
      <section
        aria-label={`จัดการรายชื่อ${staffLabel}`}
        className="overflow-hidden rounded-xl border border-line bg-white"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5 max-desk:p-4">
          <div>
            <h2 className="text-lg font-semibold">รายชื่อ{staffLabel}</h2>
            <p className="mt-1 text-sm text-secondary">
              {loading
                ? "กำลังโหลด..."
                : `ทั้งหมด ${data.total.toLocaleString("th-TH")} คน`}
            </p>
          </div>
          <label className="flex w-full items-center gap-2 border border-line px-3 sm:w-72">
            <Search size={16} className="shrink-0 text-secondary" />
            <input
              aria-label={`ค้นหาชื่อ${staffLabel}`}
              placeholder={`ค้นหาชื่อ${staffLabel}`}
              value={search}
              maxLength={150}
              className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setLoading(true);
              }}
            />
          </label>
        </div>
        {staffRole === "teacher" && (
          <div className="border-b border-line px-5 py-4 max-desk:px-4">
            <label
              htmlFor="teacher-subject-filter"
              className="mb-2 block text-sm font-medium"
            >
              กรองกลุ่มสาระการเรียนรู้
            </label>
            <Select
              inputId="teacher-subject-filter"
              instanceId="teacher-subject-filter"
              className="w-full text-sm sm:max-w-lg"
              options={subjectOptions}
              value={
                subjectOptions.find(
                  (option) => option.value === subjectGroup,
                ) ?? subjectOptions[0]
              }
              onChange={(option) => {
                setSubjectGroup(option?.value ?? "");
                setPage(1);
                setLoading(true);
              }}
              isSearchable={false}
              menuPortalTarget={
                typeof document !== "undefined" ? document.body : undefined
              }
              menuPosition="fixed"
              styles={{
                menuPortal: (base) => ({ ...base, zIndex: 60 }),
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
          </div>
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
                  {(staffRole === "teacher"
                    ? [
                        "ชื่อ-สกุล",
                        "กลุ่มสาระการเรียนรู้",
                        "สถานะบัญชี",
                        "ดำเนินการ",
                      ]
                    : ["ชื่อ-สกุล", "ดำเนินการ"]
                  ).map((heading) => (
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
                    <td
                      colSpan={staffRole === "teacher" ? 4 : 2}
                      className="p-10 text-center text-secondary"
                    >
                      <Loader2
                        size={22}
                        className="mx-auto mb-2 animate-spin"
                      />
                      กำลังโหลดรายชื่อ...
                    </td>
                  </tr>
                ) : data.items.length ? (
                  data.items.map((teacher) => (
                    <AdminAccountRow
                      key={teacher.id}
                      row={teacher}
                      role={staffRole}
                      demo={demo}
                      currentUserId={currentUserId}
                      onSaved={saved}
                      onDeleted={deleted}
                    />
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={staffRole === "teacher" ? 4 : 2}
                      className="p-10 text-center text-secondary"
                    >
                      {search || (staffRole === "teacher" && subjectGroup)
                        ? `ไม่พบ${staffLabel}ตามตัวกรอง`
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
              disabled={loading || page <= 1}
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
              disabled={loading || page >= pages}
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
    </>
  );
}
