"use client";

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Clock3, FileUp, Info } from "lucide-react";
import { assignGrade, type AssignmentActionState } from "@/app/actions";
import type { GradeRecord, Profile } from "@/lib/domain";
import { validateAssignmentFiles } from "@/lib/assignment-files";

const dueTimeOptions = Array.from({ length: 20 }, (_, index) =>
  `${String(7 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
);

export default function AssignmentActions({
  profile,
  record,
  demo = false,
}: {
  profile: Profile;
  record: GradeRecord;
  demo?: boolean;
}) {
  const mode = record.status;
  const initialDue = mode === "assigned" && record.due_at
    ? new Date(Date.parse(record.due_at) + 7 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";
  const initialTime = initialDue.slice(11, 16);
  const router = useRouter();
  async function submitAssignment(previous: AssignmentActionState, form: FormData) {
    let result: AssignmentActionState;
    try {
      result = await assignGrade(record.id, previous, form);
    } catch {
      return {
        error: "ไม่สามารถยืนยันผลการบันทึกได้ กรุณาตรวจสอบการเชื่อมต่อและสถานะงานก่อนลองใหม่ ข้อมูลที่กรอกยังอยู่ในฟอร์ม",
      };
    }
    if (result.success) router.push("/dashboard");
    return result;
  }
  const [state, formAction, pending] = useActionState<
    AssignmentActionState,
    FormData
  >(submitAssignment, { error: "" });
  const [demoMessage, setDemoMessage] = useState("");
  const [fileError, setFileError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState(initialDue.slice(0, 10));
  const [dueTime, setDueTime] = useState(
    dueTimeOptions.includes(initialTime) ? initialTime : "",
  );
  const canAssign = profile.role === "teacher" &&
    ["requested", "assigned", "submitted"].includes(mode);

  if (!canAssign) return null;

  return (
    <section className="rounded-2xl border border-[#e7dcef] bg-white p-6 shadow-[0_12px_45px_#3c24520a] max-md:p-5">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <FileUp size={22} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {mode === "assigned" ? "แก้ไขภาระงาน" : mode === "submitted" ? "มอบหมายภาระงานเพิ่ม" : "กำหนดภาระงาน"}
          </h2>
          <p className="mt-1 text-sm text-secondary">
            {mode === "assigned"
              ? "แก้ไขรายละเอียดและกำหนดส่งก่อนยืนยันรับงานจากนักเรียน"
              : "ระบุรายละเอียด กำหนดส่ง และแนบเอกสารประกอบให้นักเรียน"}
          </p>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || state.success) return;
          const form = new FormData(event.currentTarget);
          const files = form.getAll("attachments").filter(
            (item): item is File => item instanceof File && item.size > 0,
          );
          const error = validateAssignmentFiles(files);
          setFileError(error);
          if (error) return;
          if (demo) {
            setDemoMessage("บันทึกตัวอย่างแล้ว (โหมดทดลองไม่อัปโหลดไฟล์จริง)");
            return;
          }
          // Dispatch manually so unsuccessful submissions keep the form and files.
          startTransition(() => formAction(form));
        }}
      >
        <input type="hidden" name="expected_status" value={mode} />
        <label className="mb-2 block font-medium" htmlFor="assignment">
          รายละเอียดภาระงาน
        </label>
        <textarea
          className="min-h-[170px] w-full resize-y rounded-xl border border-[#ded5e8] bg-white px-4 py-3 outline-none placeholder:text-[#a99eb3] focus:border-brand focus:ring-3 focus:ring-[#713cd115]"
          id="assignment"
          name="assignment"
          minLength={10}
          maxLength={10000}
          required
          defaultValue={mode === "assigned" ? record.assignment ?? "" : ""}
          placeholder="ระบุชิ้นงาน วิธีดำเนินการ เกณฑ์การประเมิน และสถานที่ส่งงาน"
        />

        <div className="mt-5">
          <p className="font-semibold text-lg">กำหนดส่งงาน</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#675773]" htmlFor="due_date">
                วันที่ส่ง
              </label>
              <div className="relative">
                <CalendarDays
                  className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-brand"
                  size={19}
                  aria-hidden="true"
                />
                <input
                  className="w-full rounded-xl border border-[#ded5e8] bg-white py-3 pr-4 pl-12 outline-none focus:border-brand focus:ring-3 focus:ring-[#713cd115]"
                  id="due_date"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[#675773]" htmlFor="due_time">
                เวลา
              </label>
              <div className="relative">
                <Clock3
                  className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-brand"
                  size={19}
                  aria-hidden="true"
                />
                <select
                  className="w-full rounded-xl border border-[#ded5e8] bg-white py-3 pr-4 pl-12 outline-none focus:border-brand focus:ring-3 focus:ring-[#713cd115]"
                  id="due_time"
                  value={dueTime}
                  onChange={(event) => setDueTime(event.target.value)}
                  required
                >
                  <option value="">เลือกเวลา</option>
                  {dueTimeOptions.map((time) => (
                    <option key={time} value={time}>
                      {time} น.
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <input
            type="hidden"
            name="due_at"
            value={dueDate && dueTime ? `${dueDate}T${dueTime}` : ""}
          />
        </div>

        <label className="mt-5 mb-2 block font-medium" htmlFor="attachments">
          {mode === "assigned" ? "เพิ่มไฟล์แนบ (ไฟล์เดิมยังอยู่)" : "ไฟล์แนบเพิ่มเติม"}{" "}
          <span className="font-normal text-muted">(ไม่บังคับ)</span>
        </label>
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#cbb4e7] bg-[#fcfaff] px-5 py-8 text-center transition hover:bg-[#f8f3fe]"
          htmlFor="attachments"
        >
          <FileUp className="mb-3 text-brand" size={28} />
          <span className="font-medium text-[#674586]">
            เลือกไฟล์จากเครื่อง
          </span>
          <span className="mt-1 text-xs leading-5 text-muted">
            ไม่จำกัดจำนวน ไม่จำกัดขนาดไฟล์ · PDF, Word, Excel, PowerPoint, JPG,
            PNG หรือ TXT
          </span>
        </label>
        <input
          className="sr-only"
          id="attachments"
          name="attachments"
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt"
          multiple
          disabled={pending || state.success}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            setSelectedFiles(files.map((file) => file.name));
            setFileError(validateAssignmentFiles(files));
          }}
        />
        {selectedFiles.length > 0 && (
          <div className="mt-3 rounded-xl border border-[#e9e1f0] bg-white px-4 py-3 text-sm text-[#675773]">
            <p className="mb-1 font-medium">
              ไฟล์ที่เลือก ({selectedFiles.length})
            </p>
            <ul className="space-y-1 text-xs text-muted">
              {selectedFiles.map((name, index) => (
                <li className="truncate" key={`${name}-${index}`}>
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#f7f3fd] p-4 text-sm leading-6 text-[#6d5785]">
          <Info className="mt-0.5 shrink-0" size={18} />
          {mode === "assigned"
            ? "นักเรียนจะเห็นรายละเอียดที่แก้ไขทันที ก่อนครูยืนยันรับงาน"
            : "นักเรียนจะเห็นรายละเอียดและดาวน์โหลดไฟล์แนบได้ทันที"}
        </div>

        {(fileError || state.error || demoMessage) && (
          <p
            className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
              fileError || state.error
                ? "border-[#f1d2d6] bg-[#fff3f3] text-[#ad3d49]"
                : "border-[#d8ebdf] bg-[#f1faf5] text-status-green"
            }`}
            role="status"
          >
            {fileError || state.error || demoMessage}
          </p>
        )}

        <button
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-semibold text-white shadow-[0_6px_18px_#713cd12c] transition enabled:hover:bg-[#602cbc] disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={pending || !!fileError || state.success}
        >
          {pending || state.success
            ? "กำลังอัปโหลดและบันทึก…"
            : mode === "assigned"
              ? "บันทึกการแก้ไข"
              : mode === "submitted"
                ? "ยืนยันมอบหมายงานเพิ่ม"
                : "ยืนยันมอบหมายงาน"}
          {!pending && <ArrowRight size={18} />}
        </button>
      </form>
    </section>
  );
}
