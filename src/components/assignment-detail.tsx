import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  Download,
  FileText,
  Paperclip,
  UserRound,
} from "lucide-react";
import AssignmentActions from "./assignment-actions";
import {
  statuses,
  thaiDate,
  type AssignmentFile,
  type GradeAssignment,
  type GradeRecord,
  type Profile,
} from "@/lib/domain";
import Image from "next/image";

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AssignmentDetail({
  profile,
  record,
  attachments,
  assignments = [],
  backHref,
  demo = false,
}: {
  profile: Profile;
  record: GradeRecord;
  attachments: AssignmentFile[];
  assignments?: GradeAssignment[];
  backHref: string;
  demo?: boolean;
}) {
  const tasks: GradeAssignment[] = assignments.length
    ? assignments
    : record.assignment && record.due_at
      ? [{
          id: record.id,
          record_id: record.id,
          round_number: 1,
          assignment: record.assignment,
          due_at: record.due_at,
          assigned_at: record.assigned_at ?? record.created_at,
          received_at: record.submitted_at,
        }]
      : [];
  const tasksWithFiles = tasks.filter((task) =>
    attachments.some((file) => file.assignment_id === task.id),
  );
  const timeline = [
    ["ยื่นคำร้อง", record.requested_at],
    ["มอบหมายงาน", record.assigned_at],
    ["ครูรับงาน", record.submitted_at],
    ["ครูอนุมัติ", record.teacher_approved_at],
    ["ฝ่ายวิชาการอนุมัติ", record.completed_at],
  ] as const;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 max-md:px-4">
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium text-[#6e6080] hover:text-brand"
            href={backHref}
          >
            <ArrowLeft size={18} />
            กลับหน้าหลัก
          </Link>
          <div className="flex items-center gap-2 font-semibold text-brand">
            <Image
              src="https://upload.wikimedia.org/wikipedia/commons/4/44/MuangST2020.jpg"
              alt="โรงเรียนเมืองสุราษฎร์ธานี"
              width={30}
              height={30}
              className="ring-2 ring-white shadow-sm"
            />
            MST GRS
          </div>
        </div>
      </header>

      {demo && (
        <div className="border-b border-[#f0dfb9] bg-[#fff8e9] px-4 py-2 text-center text-xs text-[#846527]">
          โหมดทดลอง · ไฟล์ที่เลือกจะไม่ถูกอัปโหลดจริง
        </div>
      )}

      <div className="mx-auto max-w-6xl px-6 py-9 max-md:px-4 max-md:py-6">
        <div className="mb-7">
          <div className="mb-2 text-xs font-semibold tracking-[1.6px] text-brand">
            ASSIGNMENT DETAIL
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.5px] max-md:text-2xl">
                {record.course_name}
              </h1>
              <p className="mt-2 text-secondary">
                {record.course_code} · {record.credits} หน่วยกิต · ภาคเรียนที่{" "}
                {record.semester}/{record.academic_year}
              </p>
            </div>
            <span className="rounded-full bg-brand-soft px-4 py-2 text-sm font-medium text-brand">
              {statuses[record.status].label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6 max-lg:grid-cols-1 font-[Sarabun]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-line bg-white p-6 shadow-[0_12px_45px_#3c24520a] max-md:p-5">
              <h2 className="mb-5 flex items-center gap-3 text-lg font-semibold">
                <BookOpen className="text-brand" size={21} />
                รายละเอียดภาระงาน
              </h2>
              {tasks.length ? (
                <div className="space-y-4">
                  {tasks.map((task) => (
                    <article
                      className="rounded-xl border border-[#ece6f1] bg-[#fdfbff] p-4"
                      key={task.id}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold text-[#51415e]">
                          ภาระงานที่ {task.round_number}
                        </h3>
                        <span className="rounded-full bg-white px-3 py-1 text-xs text-[#806695]">
                          {task.received_at ? "ครูรับงานแล้ว" : "รอนักเรียนส่งงาน"}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-7 text-[#65566f]">
                        {task.assignment}
                      </p>
                      <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#fff8eb] px-4 py-3 text-sm text-[#956b2e]">
                        <CalendarDays size={18} />
                        กำหนดส่ง {thaiDate(task.due_at, true)}
                      </div>
                      {task.received_at && (
                        <p className="mt-3 text-xs text-muted">
                          ครูยืนยันรับงาน {thaiDate(task.received_at, true)}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-[#faf8fc] px-4 py-8 text-center text-sm text-muted">
                  ครูยังไม่ได้กำหนดรายละเอียดภาระงาน
                </p>
              )}
            </section>

            {(record.assignment || attachments.length > 0) && (
              <section className="rounded-2xl border border-line bg-white p-6 shadow-[0_12px_45px_#3c24520a] max-md:p-5">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Paperclip className="text-brand" size={21} />
                  ไฟล์แนบ
                  <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                    {attachments.length}
                  </span>
                </h2>
                {attachments.length ? (
                  <div className="space-y-5">
                    {tasksWithFiles.map((task) => (
                      <div key={task.id}>
                        <h3 className="mb-2 text-sm font-semibold text-[#675773]">
                          ภาระงานที่ {task.round_number}
                        </h3>
                        <div className="space-y-3">
                          {attachments
                            .filter((file) => file.assignment_id === task.id)
                            .map((file) => (
                              <div
                                className="flex items-center gap-3 rounded-xl border border-[#ece6f1] px-4 py-3"
                                key={file.id}
                              >
                                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f4eefb] text-brand">
                                  <FileText size={20} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-[#51415e]">
                                    {file.original_name}
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted">
                                    {fileSize(file.size_bytes)}
                                  </p>
                                </div>
                                {file.signed_url && (
                                  <a
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfd1ed] px-3 py-2 text-xs font-medium text-brand hover:bg-brand-soft"
                                    href={file.signed_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Download size={15} />
                                    ดาวน์โหลด
                                  </a>
                                )}
                              </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">ไม่มีไฟล์แนบเพิ่มเติม</p>
                )}
              </section>
            )}

            <AssignmentActions profile={profile} record={record} demo={demo} />
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold">
                <UserRound className="text-brand" size={19} />
                ข้อมูลรายการ
              </h2>
              <dl className="space-y-4 text-sm">
                {[
                  [
                    "นักเรียน",
                    `${record.student_name} (${record.student_code})`,
                  ],
                  ["ชั้น/ห้อง", record.classroom],
                  ["ครูประจำวิชา", record.teacher_name.join(", ")],
                  ["ผลการเรียนเดิม", record.original_grade],
                  ...(record.final_grade
                    ? [["ผลการเรียนใหม่", record.final_grade]]
                    : []),
                ].map(([label, value]) => (
                  <div
                    className="border-b border-line pb-3 last:border-0 last:pb-0"
                    key={label}
                  >
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-1 font-medium text-[#51415e]">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {record.requested_at && (
              <section className="rounded-2xl border border-line bg-white p-5">
                <h2 className="mb-4 font-semibold">ลำดับการดำเนินการ</h2>
                <div className="space-y-1">
                  {timeline.map(([label, date]) => (
                    <div className="flex items-center gap-3 py-2" key={label}>
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full border ${
                          date
                            ? "border-[#cfe6d8] bg-[#eef8f2] text-status-green"
                            : "border-[#e7dff0] text-[#b9adbf]"
                        }`}
                      >
                        {date && <Check size={14} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#604f6d]">
                          {label}
                        </p>
                        <p className="text-sm text-muted">
                          {thaiDate(date, true)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
