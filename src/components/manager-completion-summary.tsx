import { BarChart3, BookOpen, Users } from "lucide-react";
import { remainingRecordGroups, type ManagerStats } from "@/lib/manager-stats";

const format = (value: number) => value.toLocaleString("th-TH");
const percent = (value: number, total: number) =>
  ((value / total) * 100).toLocaleString("th-TH", {
    maximumFractionDigits: 1,
  });

export default function ManagerCompletionSummary({
  stats,
  completedStudents,
}: {
  stats: ManagerStats;
  completedStudents: number | null;
}) {
  const distribution = stats.students_by_remaining_records;
  const incompleteStudents = distribution
    ? remainingRecordGroups.reduce(
        (sum, group) => sum + distribution[group.key],
        0,
      )
    : 0;

  return (
    <section
      aria-labelledby="manager-completion-title"
      className="mt-6 rounded-2xl border border-[#e9e1f2] bg-white px-4 py-6 font-sans shadow-[0_8px_24px_#40206f08] desk:px-7 desk:py-7"
    >
      <div className="flex items-center gap-2 text-[#6e45a8]">
        <BarChart3 size={21} aria-hidden="true" className="shrink-0" />
        <h2
          id="manager-completion-title"
          className="text-lg font-semibold text-[#3d2d52]"
        >
          ความสำเร็จระดับบุคคลและรายการรายวิชา
        </h2>
      </div>
      <p className="mt-1 text-[15px] leading-6 text-[#756782]">
        ดูทั้งนักเรียนที่แก้ครบทุกวิชา
        และความคืบหน้าของรายการรายวิชาที่แก้ไขเสร็จ
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {[
          {
            id: "student",
            label: "นักเรียนที่แก้ครบทุกวิชา",
            completed: completedStudents,
            total: stats.total_students,
            unit: "คน",
            description:
              "นับนักเรียนหนึ่งคนเมื่อทุกรายการได้รับอนุมัติจากฝ่ายวิชาการแล้ว",
            icon: Users,
            tone: "border-[#d9ebe4] bg-[#f5faf8]",
            text: "text-[#21765f]",
            progress:
              "accent-[#16866d] [&::-webkit-progress-value]:bg-[#16866d] [&::-moz-progress-bar]:bg-[#16866d]",
          },
          {
            id: "record",
            label: "รายการรายวิชาที่แก้ไขเสร็จ",
            completed: stats.completed_records,
            total: stats.total_records,
            unit: "รายการ",
            description:
              "นับแต่ละรายการที่ฝ่ายวิชาการอนุมัติแล้ว นักเรียนหนึ่งคนมีได้หลายรายการ",
            icon: BookOpen,
            tone: "border-[#e7ddf2] bg-[#faf7fd]",
            text: "text-[#6b449f]",
            progress:
              "accent-[#7849b9] [&::-webkit-progress-value]:bg-[#7849b9] [&::-moz-progress-bar]:bg-[#7849b9]",
          },
        ].map((metric) => {
          const Icon = metric.icon;
          const available = metric.completed !== null && metric.total > 0;
          return (
            <article
              key={metric.id}
              className={`rounded-xl border p-5 ${metric.tone}`}
            >
              <h3
                className={`flex items-center gap-2 text-sm font-semibold ${metric.text}`}
              >
                <Icon size={19} aria-hidden="true" className="shrink-0" />
                {metric.label}
              </h3>
              <p
                className={`mt-4 text-4xl font-semibold tabular-nums ${metric.text}`}
              >
                {available
                  ? `${percent(metric.completed!, metric.total)}%`
                  : "—"}
              </p>
              <p className="mt-2 text-sm tabular-nums text-[#665978]">
                {metric.completed === null
                  ? "ยังไม่สามารถแสดงจำนวนที่แก้ไขเสร็จได้"
                  : `${format(metric.completed)} จาก ${format(metric.total)} ${metric.unit}`}
              </p>
              {available ? (
                <progress
                  aria-label={metric.label}
                  value={metric.completed!}
                  max={metric.total}
                  className={`mt-4 block h-2.5 w-full overflow-hidden rounded-full appearance-none border-0 bg-[#e9e3ee] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[#e9e3ee] [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full ${metric.progress}`}
                />
              ) : (
                <p className="mt-4 text-xs text-[#756782]">
                  {metric.total === 0
                    ? "ยังไม่มีข้อมูลสำหรับคำนวณอัตราความสำเร็จ"
                    : "อัตราความสำเร็จยังไม่พร้อมแสดง"}
                </p>
              )}
              <p className="mt-3 text-xs leading-6 text-[#756782]">
                {metric.description}
              </p>
            </article>
          );
        })}
      </div>

      <div className="mt-6 border-t border-[#f0ebf5] pt-5">
        <h3 className="font-semibold text-[#3d2d52]">
          จำนวนรายการที่เหลือต่อนักเรียน
        </h3>
        <p className="mt-1 text-sm leading-6 text-[#756782]">
          จัดกลุ่มเฉพาะนักเรียนที่ยังแก้ไขไม่ครบ แต่ละคนนับอยู่ในกลุ่มเดียว
        </p>
        {distribution ? (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {remainingRecordGroups.map((group) => (
                <div
                  key={group.key}
                  className="rounded-xl border border-[#ece5f3] bg-[#fcfbfe] p-4"
                >
                  <dt className="min-h-10 text-sm leading-5 text-[#756782]">
                    {group.label}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums text-[#54357d]">
                    {format(distribution[group.key])}
                    <span className="ml-2 text-sm font-normal text-[#756782]">
                      คน
                    </span>
                  </dd>
                  <dd className="mt-1 text-xs leading-5 tabular-nums text-[#756782]">
                    {incompleteStudents > 0
                      ? `${percent(distribution[group.key], incompleteStudents)}% ของผู้ที่ยังแก้ไม่ครบ`
                      : "ไม่มีนักเรียนที่ยังแก้ไม่ครบ"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-[#756782]">
              รวม {format(incompleteStudents)} คนที่ยังแก้ไขไม่ครบทุกวิชา
            </p>
          </>
        ) : (
          <p
            role="status"
            className="mt-4 rounded-xl bg-[#faf8fd] px-4 py-5 text-sm text-[#756782]"
          >
            ยังไม่สามารถแสดงจำนวนนักเรียนแยกตามรายการที่เหลือได้
          </p>
        )}
      </div>

      <p className="mt-5 border-t border-[#f0ebf5] pt-4 text-xs leading-6 text-[#756782]">
        ฐานการนับ: รายการในภาพรวมปัจจุบันทุกปีและภาคเรียน
        ไม่รวมประวัติที่ย้ายไปจัดเก็บหลังปิดรอบ
        แต่ละรายการหมายถึงนักเรียนหนึ่งคนในหนึ่งรายวิชา ปีการศึกษา และภาคเรียน
        เปอร์เซ็นต์ปัดทศนิยมหนึ่งตำแหน่ง
      </p>
    </section>
  );
}
