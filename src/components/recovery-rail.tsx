import { CalendarDays } from "lucide-react";
import {
  statuses,
  thaiDate,
  type GradeRecord,
  type Schedule,
} from "@/lib/domain";
import styles from "./dashboard.module.css";
import type { ReactNode } from "react";

export default function RecoveryRail({
  records,
  schedule,
  open,
  children,
}: {
  records: GradeRecord[];
  schedule: Schedule;
  open: boolean;
  children?: ReactNode;
}) {
  const completed = records.filter(
    (record) => record.status === "completed",
  ).length;
  const percent = records.length
    ? Math.round((completed / records.length) * 100)
    : 0;
  return (
    <aside className={styles.rail} aria-label="สรุปสถานะและกำหนดการแก้ไข">
      <section className={styles.panel}>
        <h2>สถานะการแก้ไข</h2>
        <div className={styles.summary}>
          <div
            className={styles.ring}
            role="img"
            aria-label={`แก้ไขสำเร็จ ${percent}%`}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="42" />
              <circle
                cx="50"
                cy="50"
                r="42"
                pathLength="100"
                strokeDasharray={`${percent} 100`}
              />
            </svg>
            <strong>{percent}%</strong>
          </div>
          <div>
            <b>แก้ไขสำเร็จแล้ว</b>
            <p>
              {completed} จาก {records.length} รายการ
            </p>
          </div>
        </div>
        {records.length === 0 ? (
          <p>ยังไม่มีรายการผลการเรียนในรอบนี้</p>
        ) : (
          <dl className={styles.statusList}>
            {Object.entries(statuses).map(([key, status]) => {
              const count = records.filter(
                (record) => record.status === key,
              ).length;
              return (
                <div key={key}>
                  <span
                    className={styles.dot}
                    data-tone={status.tone}
                    aria-hidden="true"
                  />
                  <dt>{status.label}</dt>
                  <dd>{count}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>
      <section className={`${styles.panel} ${styles.schedule}`}>
        <h2>
          <CalendarDays size={20} aria-hidden="true" />
          กำหนดการแก้ไข
        </h2>
        <dl>
          <div>
            <dt>เปิดรับดำเนินการ</dt>
            <dd>{thaiDate(schedule.opens_at, true)}</dd>
          </div>
          <div>
            <dt>ปิดรับดำเนินการ</dt>
            <dd>{thaiDate(schedule.closes_at, true)}</dd>
          </div>
        </dl>
        <p>
          {open
            ? "ระบบเปิดให้ดำเนินการแก้ไขผลการเรียน"
            : "อยู่นอกช่วงเวลาให้บริการ"}
        </p>
        {schedule.notice && <p className="mt-2">{schedule.notice}</p>}
      </section>
      {children}
    </aside>
  );
}
