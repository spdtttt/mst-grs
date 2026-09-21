import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

const input = process.argv[2] || "test-results/k6/local-load.json";
const output = process.argv[3] || "test-results/k6/REPORT.md";
const result = JSON.parse(readFileSync(input, "utf8"));
const metrics = result.metrics;
const number = (value) => (Number.isFinite(value) ? value.toFixed(2) : "N/A");
const rows = result.phases.map((phase) => {
  const timing = metrics[`http_req_duration{scenario:${phase.name}}`]?.values;
  const count = metrics[`page_attempts{scenario:${phase.name}}`]?.values.count;
  const error = metrics[`page_failed{scenario:${phase.name}}`]?.values.rate;
  return `| ${phase.name} | ${phase.rate} | ${phase.duration} | ${count ?? "N/A"} | ${number(timing?.["p(95)"])} | ${number(timing?.["p(99)"])} | ${number(error * 100)}% |`;
});
const thresholds = Object.entries(metrics).flatMap(([metric, data]) =>
  Object.entries(data.thresholds || {}).map(([rule, status]) => ({
    metric,
    rule,
    ok: status.ok,
  })),
);
const passed = thresholds.length > 0 && thresholds.every((item) => item.ok);
writeFileSync(
  output,
  `# ผลทดสอบ k6 ในเครื่อง — หน้าเข้าสู่ระบบเท่านั้น

เวลาสร้างผลทดสอบ: ${result.generatedAt}

ผลตามเกณฑ์สคริปต์: **${passed ? "ผ่าน" : "ไม่ผ่าน"}** (${thresholds.filter((item) => item.ok).length}/${thresholds.length} thresholds)

| ช่วง | เป้าหมาย requests/min | เวลา | คำขอในช่วง | p95 (ms) | p99 (ms) | หน้าไม่ถูกต้อง/ล้มเหลว |
|---|---:|---|---:|---:|---:|---:|
${rows.join("\n")}

- HTTP requests รวม preflight: ${metrics.http_reqs?.values.count}
- Iterations: ${metrics.iterations?.values.count}
- HTTP failure rate: ${number(metrics.http_req_failed?.values.rate * 100)}%
- Dropped iterations: ${metrics.dropped_iterations?.values.count ?? "N/A"}
- เครื่อง: ${os.cpus()[0].model.trim()}, ${os.cpus().length} logical CPUs, RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB
- Node.js: ${process.version}; OS: ${os.platform()} ${os.release()}
- k6: v2.2.0 (official Windows binary, SHA-256 checked against release checksum)
- Next.js: production build, 16.3.5; HTTP localhost port 3100

## ขอบเขตและข้อจำกัด

หนึ่ง iteration คือ GET / หนึ่งครั้ง ตรวจ HTTP 200 และเนื้อหาแบบฟอร์มเข้าสู่ระบบจริง ไม่ตาม redirect ไม่ส่งแบบฟอร์ม
ไม่โหลด JavaScript/CSS/รูปภาพ และไม่วัดการ render ใน browser
ปิด Supabase และ Web Push ทั้งตอน build และ start ด้วย environment ของ child process โดยไม่แก้ไฟล์ .env
จึงไม่ครอบคลุม Auth, RLS, ฐานข้อมูล, ผลการเรียน, การยื่นคำร้อง หรืออนุมัติ
ไม่ได้สร้างบัญชีจำลอง 3,500 บัญชี เนื่องจากยังไม่มีฐานข้อมูลทดสอบแยก
เครื่องสร้างโหลดและเว็บอยู่เครื่องเดียวกัน ไม่มี latency อินเทอร์เน็ต, TLS หรือโครงสร้าง hosting จริง
รอบนี้เป็น baseline 5 นาที ไม่ใช่ endurance test 30–60 นาที

**ผลนี้ยืนยันได้เฉพาะการตอบ HTML หน้าเข้าสู่ระบบตามโหลดที่ทดสอบ ไม่ใช่การรับรอง 700 ผู้ใช้งานจริงต่อนาที**

## ข้อสรุปความพร้อมจากการตรวจโค้ด

- ผู้ใช้ทั้งหมด 3,500 คนไม่ใช่ปัญหาโดยตัวเลขเพียงอย่างเดียว; 700 requests/นาทีเท่ากับเฉลี่ย 11.67 requests/วินาที แต่หนึ่งผู้ใช้อาจสร้างหลาย request ต่อการเปิดหน้า
- เส้นทางที่เข้าสู่ระบบเรียก Supabase Auth เพื่อตรวจ session ทั้งใน Proxy และในหน้า Server Component จึงต้องทดสอบอัตราจริงกับ staging และตรวจ Auth rate limit ก่อนเปิดใช้พร้อมกัน
- หน้า dashboard ปัจจุบันอ่าน grade_records ที่ผู้ใช้มีสิทธิ์เห็นทั้งหมดเป็นชุดละ 1,000 แถว แล้วจึงกรอง/แบ่งหน้าบน browser ฝ่ายวิชาการจึงมีความเสี่ยงเมื่อข้อมูลสะสมมาก ควรย้ายการกรองและ pagination ไปฐานข้อมูลก่อนใช้งานจริง
- หน้าผู้บริหารใช้ RPC แบบสรุปและรายการแบบแบ่งหน้าแล้ว; migration 009 มีดัชนีสำหรับหารายการล่าสุดของนักเรียน
- สถานะตอนนี้: ผ่าน local public-page baseline แต่ยังไม่ควรใช้ผลนี้เป็น production sign-off จนกว่าจะผ่าน authenticated staging test 30–60 นาที

## เกณฑ์

p95 ของแต่ละช่วงต่ำกว่า 3 วินาที, HTTP/content failure ต่ำกว่า 1%, ไม่มี dropped iterations และมีคำขอจริงทุกช่วง
ค่า page_failed เป็น Rate ของเหตุการณ์ผิดพลาด ให้ดู values.rate (ไม่ตีความชื่อ passes/fails ของ Rate ว่าเป็นผลผ่าน/ตก)

## งานก่อนทดสอบระบบครบวงจร

เตรียม staging และข้อมูลสมมติ, สร้างสถานการณ์ล็อกอิน/เปิดรายการ/ยื่นคำร้อง/อนุมัติผ่าน Server Actions จริง
รัน 700 คนต่อนาทีและ spike 1,400 ตาม workload ที่ตกลง พร้อมตรวจสถานะข้อมูลและติดตามทรัพยากรของ hosting/ฐานข้อมูล

ข้อมูลดิบ: local-load.json; log: local-load.log; สคริปต์: scripts/k6/public-page.js

เอกสารอ้างอิง: Supabase Auth rate limits — https://supabase.com/docs/guides/auth/rate-limits
Supabase production checklist — https://supabase.com/docs/guides/deployment/going-into-prod
Supabase performance tuning — https://supabase.com/docs/guides/platform/performance
`,
  "utf8",
);
console.log(output);
