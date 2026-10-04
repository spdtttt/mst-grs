"use client";
import { useRef, useState } from "react";
import Select from "react-select";
import { Loader2, Upload, Download, UserPlus } from "lucide-react";
import { previewTeachers, saveTeachers } from "@/app/teacher-actions";
import { accountFullName, type AccountRow } from "@/lib/admin-accounts";
import {
  readTeacherWorkbook,
  teacherColumns,
  teacherRegistrySchema,
  TEACHER_BATCH_SIZE,
  type TeacherRegistryInput,
  type TeacherRegistryPreview,
  type TeacherSaveResult,
} from "@/lib/teacher-registry";

const blank = {
  citizen_id: "",
  name_prefix: "",
  first_name: "",
  last_name: "",
  learning_subject_group: "",
};
const prefixOptions = ["นาย", "นาง", "นางสาว", "ว่าที่ร้อยตรี", "ดร."].map(
  (value) => ({ value, label: value }),
);
const inputClass =
  "mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand";
const buttonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 border border-line px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export default function TeacherRegistryPanel({
  demo = false,
  onSaved,
}: {
  demo?: boolean;
  onSaved: (rows: AccountRow[]) => void;
}) {
  const [draft, setDraft] = useState(blank);
  const [preview, setPreview] = useState<TeacherRegistryPreview[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<TeacherSaveResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function inspect(rows: TeacherRegistryInput[]) {
    const checked: TeacherRegistryPreview[] = [];
    for (let offset = 0; offset < rows.length; offset += TEACHER_BATCH_SIZE) {
      setProgress(
        `ตรวจสอบทะเบียน ${Math.min(offset + TEACHER_BATCH_SIZE, rows.length)} / ${rows.length}`,
      );
      const batch = rows.slice(offset, offset + TEACHER_BATCH_SIZE);
      const result = demo
        ? {
            data: batch.map((row) => ({
              ...row,
              id: null,
              expected_revision: null,
            })),
          }
        : await previewTeachers(batch);
      if (result.error || !result.data)
        throw new Error(result.error || "ตรวจสอบทะเบียนไม่สำเร็จ");
      checked.push(...result.data);
    }
    setPreview(checked);
  }

  async function prepareSingle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const parsed = teacherRegistrySchema.safeParse(draft);
    if (!parsed.success) {
      setErrors([parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง"]);
      return;
    }
    lock.current = true;
    setBusy(true);
    setErrors([]);
    setWarnings([]);
    setOutcomes([]);
    setPreview([]);
    try {
      await inspect([parsed.data]);
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "ตรวจสอบข้อมูลไม่สำเร็จ",
      ]);
    } finally {
      lock.current = false;
      setBusy(false);
      setProgress("");
    }
  }

  async function readFile(file?: File) {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setErrors([]);
    setWarnings([]);
    setOutcomes([]);
    setPreview([]);
    try {
      if (!/\.xlsx$/i.test(file.name))
        throw new Error("รองรับไฟล์ .xlsx เท่านั้น");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("รองรับไฟล์ขนาดไม่เกิน 10 MB");
      setProgress("กำลังอ่านไฟล์...");
      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const parsed = readTeacherWorkbook(book);
      setWarnings(parsed.warnings);
      if (parsed.errors.length) {
        setErrors(parsed.errors);
        return;
      }
      await inspect(parsed.rows);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "อ่านไฟล์ไม่สำเร็จ"]);
    } finally {
      lock.current = false;
      setBusy(false);
      setProgress("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    if (lock.current || !preview.length) return;
    lock.current = true;
    setBusy(true);
    setErrors([]);
    setOutcomes([]);
    const results: TeacherSaveResult[] = [],
      saved: AccountRow[] = [];
    try {
      for (
        let offset = 0;
        offset < preview.length;
        offset += TEACHER_BATCH_SIZE
      ) {
        const batch = preview.slice(offset, offset + TEACHER_BATCH_SIZE);
        setProgress(
          `กำลังบันทึก ${Math.min(offset + TEACHER_BATCH_SIZE, preview.length)} / ${preview.length}`,
        );
        const response: { results?: TeacherSaveResult[]; error?: string } = demo
          ? {
              results: batch.map((row) => ({
                citizen_id: row.citizen_id,
                status: row.id ? ("updated" as const) : ("created" as const),
              })),
            }
          : await saveTeachers(batch);
        if (response.error || !response.results)
          throw new Error(response.error || "บันทึกไม่สำเร็จ");
        results.push(...response.results);
        for (const [index, row] of batch.entries())
          if (response.results[index]?.status !== "failed")
            saved.push({
              id: row.id ?? crypto.randomUUID(),
              full_name: accountFullName(row),
              name_prefix: row.name_prefix,
              first_name: row.first_name,
              last_name: row.last_name,
              learning_subject_group: row.learning_subject_group,
              has_auth: false,
              account_revision: (row.expected_revision ?? -1) + 1,
            });
        setOutcomes([...results]);
      }
      setDraft(blank);
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : "ไม่สามารถยืนยันผลได้ กรุณาตรวจสอบตัวอย่างใหม่",
      ]);
    } finally {
      onSaved(saved);
      setPreview([]);
      setProgress("");
      setBusy(false);
      lock.current = false;
    }
  }

  async function template() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setErrors([]);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet("คุณครู");
      sheet.addRow([...teacherColumns]);
      sheet.addRow([
        "1000000000001",
        "101 นายศุภพล แดงประทีป",
        "กลุ่มสาระการเรียนรู้คณิตศาสตร์",
      ]);
      sheet.getColumn(1).numFmt = "@";
      sheet.getColumn(1).width = 24;
      sheet.getColumn(2).width = 40;
      sheet.getColumn(3).width = 50;
      sheet.getRow(1).font = { bold: true };
      const bytes = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "teacher-template.xlsx";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErrors(["สร้างแม่แบบไม่สำเร็จ กรุณาลองอีกครั้ง"]);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="เพิ่มและนำเข้าทะเบียนคุณครู"
      className="mb-5 rounded-xl border border-line bg-white p-5 max-desk:p-4"
    >
      <h2 className="text-lg font-semibold">เพิ่มข้อมูลคุณครู</h2>
      <p className="mt-1 text-sm text-secondary">
        บันทึกทะเบียนครู เมื่อคุณครูสมัครสมาชิกและข้อมูลตรงกับทะเบียน
        จึงจะสร้างบัญชีเข้าสู่ระบบ
      </p>
      <form onSubmit={prepareSingle} className="mt-4">
        <fieldset
          disabled={busy}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60"
        >
          <label className="text-sm">
            เลขบัตรประชาชน
            <input
              className={inputClass}
              required
              inputMode="numeric"
              maxLength={17}
              autoComplete="off"
              value={draft.citizen_id}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  citizen_id: event.target.value,
                }))
              }
            />
          </label>
          <div className="text-sm">
            <label htmlFor="teacher-registry-prefix">คำนำหน้าชื่อ</label>
            <Select
              inputId="teacher-registry-prefix"
              instanceId="teacher-registry-prefix"
              name="name_prefix"
              className="mt-1"
              required
              isSearchable={false}
              isDisabled={busy}
              placeholder="เลือกคำนำหน้าชื่อ"
              options={prefixOptions}
              value={
                prefixOptions.find(
                  (option) => option.value === draft.name_prefix,
                ) ?? null
              }
              onChange={(option) =>
                setDraft((value) => ({
                  ...value,
                  name_prefix: option?.value ?? "",
                }))
              }
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
          </div>
          <label className="text-sm">
            ชื่อ
            <input
              className={inputClass}
              required
              maxLength={80}
              value={draft.first_name}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  first_name: event.target.value,
                }))
              }
            />
          </label>
          <label className="text-sm">
            นามสกุล
            <input
              className={inputClass}
              required
              maxLength={80}
              value={draft.last_name}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  last_name: event.target.value,
                }))
              }
            />
          </label>
          <label className="text-sm">
            กลุ่มสาระการเรียนรู้
            <input
              className={inputClass}
              required
              maxLength={200}
              value={draft.learning_subject_group}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  learning_subject_group: event.target.value,
                }))
              }
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className={`${buttonClass} bg-brand hover:bg-brand/90 duration-150 text-white`}
            >
              <UserPlus size={16} />
              ตรวจสอบก่อนเพิ่ม
            </button>
          </div>
        </fieldset>
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={template}
        >
          <Download size={16} />
          ดาวน์โหลดแม่แบบ
        </button>
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={16} />
          นำเข้าคุณครู .xlsx
        </button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          aria-label="ไฟล์ทะเบียนคุณครู"
          accept=".xlsx"
          disabled={busy}
          onChange={(event) => readFile(event.target.files?.[0])}
        />
        {busy && (
          <span
            role="status"
            className="inline-flex items-center gap-2 text-sm"
          >
            <Loader2 className="animate-spin" size={16} />
            {progress || "กำลังดำเนินการ..."}
          </span>
        )}
      </div>
      {!!errors.length && (
        <div
          role="alert"
          className="mt-4 max-h-52 overflow-auto rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {errors.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
      {!!warnings.length && (
        <div className="mt-4 max-h-40 overflow-auto rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {warnings.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
      {!!preview.length && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium">
            ตรวจสอบก่อนนำเข้า {preview.length} คน · เพิ่มใหม่{" "}
            {preview.filter((row) => row.id === null).length} คน · อัปเดต{" "}
            {preview.filter((row) => row.id !== null).length} คน
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "เลขบัตรประชาชน",
                    "ชื่อ–สกุล",
                    "กลุ่มสาระการเรียนรู้",
                    "ผลที่คาดว่าจะเกิด",
                  ].map((label) => (
                    <th className="whitespace-nowrap p-2" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((row) => (
                  <tr className="border-t border-line" key={row.citizen_id}>
                    <td className="p-2">{row.citizen_id}</td>
                    <td className="p-2">{accountFullName(row)}</td>
                    <td className="p-2">{row.learning_subject_group}</td>
                    <td className="p-2">{row.id ? "อัปเดต" : "เพิ่มใหม่"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 50 && (
            <p className="text-xs text-secondary">
              แสดงตัวอย่าง 50 รายการแรก บันทึกทั้งหมด {preview.length} รายการ
            </p>
          )}
          <button
            type="button"
            className={`${buttonClass} bg-brand text-white`}
            disabled={busy}
            onClick={save}
          >
            ยืนยันบันทึกทะเบียน
          </button>
          <button
            type="button"
            className={`${buttonClass} ml-2`}
            disabled={busy}
            onClick={() => setPreview([])}
          >
            ยกเลิก
          </button>
        </div>
      )}
      {!!outcomes.length && (
        <div className="mt-4 text-sm" role="status">
          <p>
            เพิ่มใหม่{" "}
            {outcomes.filter((row) => row.status === "created").length} คน ·
            อัปเดต {outcomes.filter((row) => row.status === "updated").length}{" "}
            คน · ผิดพลาด{" "}
            {outcomes.filter((row) => row.status === "failed").length} คน
          </p>
          {outcomes
            .filter((row) => row.status === "failed")
            .map((row) => (
              <p className="mt-1 text-red-700" key={row.citizen_id}>
                เลขบัตรลงท้าย {row.citizen_id.slice(-4)}: {row.message}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
