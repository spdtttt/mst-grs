"use client";
import { useEffect, useRef, useState } from "react";
import Select from "react-select";
import { Loader2, UserPlus } from "lucide-react";
import { addAcademicTeacher, createAcademic } from "@/app/academic-actions";
import { listTeachers } from "@/app/teacher-actions";
import { teacherRegistrationSchema } from "@/lib/auth-input";
import {
  TEACHER_PAGE_SIZE,
  type TeacherList,
  type TeacherRow,
} from "@/lib/teachers";
import AdminTeachers from "./admin-teachers";

const prefixOptions = ["นาย", "นาง", "นางสาว"].map((value) => ({
  value,
  label: value,
}));
const emptyValues = {
  name_prefix: "",
  first_name: "",
  last_name: "",
  citizen_id: "",
  password: "",
};
const demoTeachers: TeacherRow[] = [
  { id: "demo-teacher-1", full_name: "นายสมชาย ใจดี" },
  { id: "demo-teacher-2", full_name: "นางสาววรัญญา แสงทอง" },
  { id: "demo-teacher-3", full_name: "นางกมลพร รักเรียน" },
];
const inputClass =
  "mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand";
const buttonClass =
  "rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";

export default function AdminAcademics({
  demo = false,
  currentUserId,
}: {
  demo?: boolean;
  currentUserId: string;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [values, setValues] = useState(emptyValues);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [teachers, setTeachers] = useState<TeacherList>({
    total: 0,
    items: [],
  });
  const [selected, setSelected] = useState<TeacherRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [demoRows, setDemoRows] = useState<TeacherRow[]>([
    { id: "demo-academic-1", full_name: "นางสาวสุภาพร ใจดี" },
  ]);
  const saving = useRef(false);

  useEffect(() => {
    if (mode !== "existing") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLookupError("");
      try {
        const matches = demoTeachers.filter((row) =>
          row.full_name.includes(search.trim()),
        );
        const result = demo
          ? { data: { total: matches.length, items: matches } }
          : await listTeachers({ search, page });
        if (cancelled) return;
        if (result.error) {
          setTeachers({ total: 0, items: [] });
          setLookupError(result.error);
        } else if (result.data) setTeachers(result.data);
      } catch {
        if (!cancelled) {
          setTeachers({ total: 0, items: [] });
          setLookupError("โหลดรายชื่อครูไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [demo, mode, search, page, retry]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    setError("");
    setNotice("");
    if (mode === "existing" && !selected) {
      setError("กรุณาเลือกบัญชีคุณครู");
      return;
    }
    if (mode === "new") {
      const parsed = teacherRegistrationSchema.safeParse(values);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message || "กรุณาตรวจสอบข้อมูล");
        return;
      }
    }
    saving.current = true;
    setBusy(true);
    try {
      const result = demo
        ? { success: true }
        : mode === "existing"
          ? await addAcademicTeacher(selected)
          : await createAcademic(values);
      if (result.error || !result.success) {
        setError(
          result.error ||
            "ไม่สามารถยืนยันผลการบันทึกได้ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบ",
        );
        return;
      }
      if (demo) {
        const row =
          mode === "existing"
            ? selected!
            : {
                id: `demo-academic-${revision + 2}`,
                full_name: `${values.name_prefix}${values.first_name.trim()} ${values.last_name.trim()}`,
              };
        setDemoRows((rows) =>
          rows.some((item) => item.id === row.id) ? rows : [...rows, row],
        );
      }
      setNotice(
        (mode === "existing"
          ? "เพิ่มสิทธิ์ฝ่ายวิชาการแล้ว ใช้เลขบัตรประชาชนและรหัสผ่านเดิมเข้าสู่ระบบในบทบาทฝ่ายวิชาการได้"
          : "สร้างบัญชีฝ่ายวิชาการแล้ว เข้าสู่ระบบด้วยเลขบัตรประชาชนและรหัสผ่านที่ตั้งไว้") +
          (demo ? " · ข้อมูลทดลอง" : ""),
      );
      setValues(emptyValues);
      setSelected(null);
      setRevision((value) => value + 1);
    } catch {
      setError(
        "ไม่สามารถยืนยันผลการบันทึกได้ กรุณาโหลดรายชื่อใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section
        aria-label="เพิ่มฝ่ายวิชาการ"
        className="rounded-xl border border-line bg-white p-5 max-desk:p-4"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <UserPlus size={20} className="text-brand" />
          เพิ่มฝ่ายวิชาการ
        </h2>
        <form onSubmit={submit} className="mt-4">
          <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
            <legend className="sr-only">ข้อมูลฝ่ายวิชาการ</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["existing", "เพิ่มสิทธิ์ให้ครูเดิม"],
                  ["new", "สร้างบัญชีฝ่ายวิชาการใหม่"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="academic-mode"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setError("");
                      setNotice("");
                      setValues(emptyValues);
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {mode === "existing" ? (
              <div className="space-y-3">
                <p className="text-sm text-secondary">
                  เลือกบัญชีคุณครูเพื่อเพิ่มสิทธิ์ฝ่ายวิชาการ โดยคงชื่อ รหัสผ่าน
                  และสิทธิ์เดิมไว้
                </p>
                <label className="block text-sm" htmlFor="academic-teacher">
                  บัญชีคุณครู
                </label>
                <Select<TeacherRow>
                  inputId="academic-teacher"
                  instanceId="academic-teacher"
                  options={loading ? [] : teachers.items}
                  value={selected}
                  inputValue={search}
                  onInputChange={(value, meta) => {
                    if (meta.action !== "input-change") return;
                    const query = value.slice(0, 150);
                    if (query === search) return;
                    setSearch(query);
                    setPage(1);
                    setLoading(true);
                  }}
                  filterOption={null}
                  getOptionValue={(row) => row.id}
                  getOptionLabel={(row) =>
                    `${row.full_name} (${row.id.slice(-8)})`
                  }
                  onChange={(teacher) => {
                    setSelected(teacher);
                    if (search || page !== 1) {
                      setSearch("");
                      setPage(1);
                      setLoading(true);
                    }
                  }}
                  isDisabled={busy}
                  isLoading={loading}
                  isSearchable
                  placeholder="พิมพ์ชื่อหรือนามสกุลเพื่อค้นหาคุณครู"
                  loadingMessage={() => "กำลังค้นหาคุณครู..."}
                  noOptionsMessage={() =>
                    lookupError
                      ? "ไม่สามารถโหลดรายชื่อคุณครูได้"
                      : "ไม่พบคุณครูตามคำค้นหา"
                  }
                />
                {selected && (
                  <p className="text-sm text-brand">
                    บัญชีที่เลือก: {selected.full_name}
                  </p>
                )}
                {lookupError && (
                  <p role="alert" className="text-sm text-red-700">
                    {lookupError}{" "}
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      ลองโหลดครูใหม่
                    </button>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
                  <span>
                    {loading
                      ? "กำลังโหลดครู..."
                      : `ทั้งหมด ${teachers.total} คน · หน้า ${page} / ${Math.max(1, Math.ceil(teachers.total / TEACHER_PAGE_SIZE))}`}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={loading || page === 1}
                    onClick={() => {
                      setPage((value) => value - 1);
                      setLoading(true);
                    }}
                  >
                    ครูก่อนหน้า
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={
                      loading || page * TEACHER_PAGE_SIZE >= teachers.total
                    }
                    onClick={() => {
                      setPage((value) => value + 1);
                      setLoading(true);
                    }}
                  >
                    ครูถัดไป
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label htmlFor="academic-prefix" className="text-sm">
                    คำนำหน้า
                  </label>
                  <Select
                    inputId="academic-prefix"
                    instanceId="academic-prefix"
                    className="mt-2"
                    name="name_prefix"
                    required
                    options={prefixOptions}
                    isDisabled={busy}
                    isSearchable={false}
                    placeholder="เลือกคำนำหน้า"
                    value={
                      prefixOptions.find(
                        (option) => option.value === values.name_prefix,
                      ) ?? null
                    }
                    onChange={(option) =>
                      setValues((old) => ({
                        ...old,
                        name_prefix: option?.value ?? "",
                      }))
                    }
                  />
                </div>
                <label className="text-sm">
                  ชื่อ
                  <input
                    required
                    autoComplete="off"
                    className={inputClass}
                    maxLength={80}
                    value={values.first_name}
                    onChange={(e) =>
                      setValues({ ...values, first_name: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  นามสกุล
                  <input
                    required
                    autoComplete="off"
                    className={inputClass}
                    maxLength={80}
                    value={values.last_name}
                    onChange={(e) =>
                      setValues({ ...values, last_name: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  เลขบัตรประชาชน
                  <input
                    required
                    autoComplete="off"
                    className={inputClass}
                    inputMode="numeric"
                    maxLength={17}
                    pattern="[0-9]{13}|[0-9]-[0-9]{4}-[0-9]{5}-[0-9]{2}-[0-9]"
                    value={values.citizen_id}
                    onChange={(e) =>
                      setValues({ ...values, citizen_id: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  รหัสผ่าน (อย่างน้อย 6 ตัว)
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    className={inputClass}
                    minLength={6}
                    maxLength={128}
                    value={values.password}
                    onChange={(e) =>
                      setValues({ ...values, password: e.target.value })
                    }
                  />
                </label>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || (mode === "existing" && !selected)}
              className="inline-flex cursor-pointer hover:bg-brand/90 duration-150 items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? "กำลังบันทึก..." : "บันทึกฝ่ายวิชาการ"}
            </button>
          </fieldset>
        </form>
        {notice && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-brand-soft p-3 text-sm text-brand"
          >
            {notice}
          </p>
        )}
      </section>
      <AdminTeachers
        key={demo ? revision : "academics"}
        staffRole="academic"
        demo={demo}
        demoEntries={demoRows}
        onDemoReset={(id) =>
          setDemoRows((rows) => rows.filter((row) => row.id !== id))
        }
        onDemoEdit={(updated) =>
          setDemoRows((rows) => rows.map((row) => row.id === updated.id ? updated : row))
        }
        currentUserId={currentUserId}
        refreshKey={revision}
      />
    </div>
  );
}
