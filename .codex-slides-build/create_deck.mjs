import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "C:\\Users\\Suppapon\\Desktop\\MST-GRS";
const SKILL_DIR = "C:\\Users\\Suppapon\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.909.12148\\skills\\presentations";
const RUNTIME_PYTHON = "C:\\Users\\Suppapon\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
process.env.RUNTIME_NODE_MODULES = "C:\\Users\\Suppapon\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
process.env.RUNTIME_NODE = "C:\\Users\\Suppapon\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
process.env.RUNTIME_BIN_DIR = "C:\\Users\\Suppapon\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\bin\\override";
const buildDir = path.join(workspaceDir, ".codex-slides-build");
const outputDir = path.join(workspaceDir, "docs", "presentation");
const finalPath = path.join(outputDir, "MST-GRS-presentation-v1.pptx");
const font = "Tahoma";

const C = {
  purple: "713CD1",
  purpleDark: "40206F",
  purpleDeep: "27123F",
  lavender: "F1EBFC",
  lavender2: "E5D8FA",
  white: "FFFFFF",
  ink: "241B2F",
  muted: "6F637A",
  line: "D8CDEA",
  green: "16866D",
  greenLight: "E6F5F1",
  amber: "B8801A",
  amberLight: "FFF5D9",
  blue: "397CC5",
  blueLight: "E8F2FC",
  rose: "C2656F",
  roseLight: "FFF0F0",
  gray: "F7F5F9",
};

const slides = [
  {
    section: "THE CORE PROBLEM", title: "MST - Grade Recovery System", time: 1,
    key: "ระบบแก้ไขผลการเรียนคงค้าง โรงเรียนเมืองสุราษฎร์ธานี",
    bullets: ["สำหรับนักเรียน ครู ฝ่ายวิชาการ และผู้ดูแลระบบ", "นำเสนอขั้นตอนการใช้งานและการส่งต่องาน", "ระยะเวลาบรรยาย 60 นาที"],
    citation: "README.md:1-3; src/lib/domain.ts:58-63",
    notes: "เปิดด้วยขอบเขตของระบบตามเอกสารโครงการ ยังไม่กล่าวถึงผลลัพธ์เชิงประสิทธิภาพ เพราะเอกสารไม่มีข้อมูลการใช้งานจริงรองรับ",
    layout: "cover",
  },
  {
    section: "THE CORE PROBLEM", title: "เส้นทางการนำเสนอ", time: 2,
    key: "เริ่มจากโจทย์ของระบบ แล้วเชื่อมไปยังขั้นตอน บทบาท ตัวอย่าง และความพร้อมใช้งาน",
    bullets: ["ปัญหาและขอบเขตที่พบในเอกสาร", "วิธีเข้าสู่ระบบและวิธีใช้งานของแต่ละบทบาท", "สถานะงานและจุดส่งต่อ", "ตัวอย่างจากข้อมูลสมมติ", "สิ่งที่ต้องทำก่อนเปิดใช้งานจริง"],
    citation: "README.md:17-71; VERIFICATION.md:18-24",
    notes: "อธิบายว่าการนำเสนอแยกข้อเท็จจริงในเอกสารออกจากข้อมูลที่ยังไม่มีอย่างชัดเจน",
    layout: "agenda",
  },
  {
    section: "THE CORE PROBLEM", title: "โจทย์หลักของระบบ", time: 3,
    key: "ผลการเรียนคงค้างแต่ละรายการต้องผ่านผู้รับผิดชอบตามลำดับก่อนปิดงาน",
    bullets: ["หนึ่งรายการผูกนักเรียน ครู รายวิชา ปีการศึกษา และภาคเรียน", "เริ่มจากยังไม่ยื่นคำร้อง และสิ้นสุดที่แก้ไขสำเร็จ", "ครูมอบหมาย รับงาน และเสนอผลการเรียนใหม่", "ฝ่ายวิชาการอนุมัติขั้นสุดท้าย", "ผู้ดูแลกำหนดช่วงเวลาให้บริการ"],
    citation: "src/lib/domain.ts:16-40,64-89; supabase/migrations/001_initial.sql:16-29",
    notes: "เน้นการควบคุมลำดับสถานะและผู้รับผิดชอบ ไม่กล่าวอ้างว่างานเดิมล่าช้าหรือผิดพลาดเพียงใด เพราะไม่มีตัวเลขรองรับ",
    layout: "record",
  },
  {
    section: "THE CORE PROBLEM", title: "ขอบเขตหลักฐานที่ยังไม่มี", time: 2,
    key: "เอกสารยังไม่รองรับการกล่าวอ้างผลลัพธ์เชิงปริมาณหรือผลจากการใช้งานจริง",
    bullets: ["ไม่มีข้อมูลในเอกสาร: จำนวนรายการคงค้างก่อนใช้ระบบ", "ไม่มีข้อมูลในเอกสาร: ระยะเวลาดำเนินการก่อนและหลังใช้ระบบ", "ไม่มีข้อมูลในเอกสาร: อัตราความผิดพลาดหรือภาระงานเดิม", "ไม่มีข้อมูลในเอกสาร: ความพึงพอใจของผู้ใช้จริง", "ยังไม่ได้ทดสอบบัญชีจริงของนักเรียน ครู และฝ่ายวิชาการ"],
    citation: "VERIFICATION.md:18-24; README.md:70-71",
    notes: "ใช้สไลด์นี้กำหนดความคาดหวังร่วมกัน ตัวอย่างในสไลด์ต่อไปไม่ใช่หลักฐานผลลัพธ์หลังใช้งานจริง",
    layout: "evidenceGap",
  },
  {
    section: "THE CORE PROBLEM", title: "ขอบเขตของ MST GRS", time: 2,
    key: "ระบบครอบคลุมงานตั้งแต่เข้าสู่ระบบจนถึงการอนุมัติและรายงาน",
    bullets: ["เว็บไซต์ภาษาไทย โทนสีม่วง", "แสดงข้อมูลและเมนูตามหน้าที่ของผู้ใช้", "รองรับ 4 บทบาท", "รองรับการนำเข้าและส่งออกรายงาน", "ผู้ดูแลกำหนดช่วงเวลาเปิดและปิดระบบ"],
    citation: "README.md:3,43-59; src/lib/domain.ts:58-63",
    notes: "เชื่อมจากโจทย์ไปยังขอบเขตของระบบ ก่อนอธิบายวิธีใช้งานรายบทบาท",
    layout: "scope",
  },
  {
    section: "MAIN CONTENT", title: "ภาพรวมการใช้งานระบบ", time: 2,
    key: "ผู้ใช้เริ่มจากหน้าเข้าสู่ระบบ แล้วทำงานต่อในหน้าที่ซึ่งตรงกับความรับผิดชอบของตน",
    bullets: ["เลือกบทบาทและเข้าสู่ระบบ", "เห็นเมนูและรายการที่เกี่ยวข้อง", "ดำเนินงานผ่านปุ่มตามสถานะ", "ส่งต่องานให้บทบาทถัดไป", "ติดตามรายการที่เสร็จแล้ว"],
    citation: "README.md:17-59; src/components/workspace.tsx:1-310",
    notes: "ใช้สไลด์นี้เป็นแผนที่ก่อนเข้าสู่วิธีใช้งานรายบทบาท เน้นสิ่งที่ผู้ใช้พบและการส่งต่องาน",
    layout: "journey",
  },
  {
    section: "MAIN CONTENT", title: "วิธีเข้าสู่ระบบตามบทบาท", time: 2,
    key: "ผู้ใช้เลือกบทบาทก่อนเข้าสู่ระบบ และแต่ละบทบาทใช้ข้อมูลยืนยันตัวตนต่างกัน",
    bullets: ["นักเรียน: เลขประจำตัวนักเรียนและเลขบัตรประชาชน", "ครู: เลขบัตรประชาชน 13 หลัก", "ฝ่ายวิชาการ: เลขบัตรประชาชน 13 หลัก", "ผู้ดูแลระบบ: Username และ Password", "ผู้ที่เข้าสู่ระบบอยู่แล้วจะไปยังหน้าหลักของตน"],
    citation: "README.md:17-28; src/components/login.tsx:25-58; src/app/page.tsx:7-17",
    notes: "เลขบัตรประชาชนเป็นข้อมูลส่วนบุคคล โรงเรียนควรกำหนดวิธีตรวจสอบตัวตนและแนวทางดูแลข้อมูลก่อนใช้จริง",
    layout: "rolesTable",
  },
  {
    section: "MAIN CONTENT", title: "วงจรสถานะของหนึ่งรายการ", time: 3,
    key: "แถบความคืบหน้าบอกตำแหน่งของรายการและผู้ที่ต้องดำเนินการต่อ",
    bullets: ["0% ยังไม่ยื่นคำร้อง", "25% รอมอบหมายงาน", "50% อยู่ระหว่างดำเนินการ", "75% ส่งงานแล้ว หรือรอฝ่ายวิชาการอนุมัติ", "100% แก้ไขสำเร็จ"],
    citation: "src/lib/domain.ts:2-8,64-89; tests/domain.test.ts:6-16",
    notes: "ชี้ให้เห็นว่า 75% ครอบคลุมสองสถานะ จึงต้องดูข้อความสถานะร่วมกับเปอร์เซ็นต์",
    layout: "progress",
  },
  {
    section: "MAIN CONTENT", title: "ความสัมพันธ์ของ 4 บทบาท", time: 3,
    key: "แต่ละบทบาทรับผิดชอบคนละจุดและส่งต่อรายการตามสถานะที่กำหนด",
    bullets: ["นักเรียนเริ่มคำร้องและอ่านภาระงาน", "ครูมอบหมาย รับงาน และเสนอผลการเรียนใหม่", "ฝ่ายวิชาการตรวจและอนุมัติขั้นสุดท้าย", "ผู้ดูแลกำหนดช่วงเวลาให้บริการ", "แต่ละบทบาทเห็นข้อมูลตามหน้าที่"],
    citation: "README.md:45-51; src/lib/domain.ts:79-89; supabase/migrations/001_initial.sql:45-50",
    notes: "เดินตามลูกศรทีละบทบาทและย้ำจุดส่งต่องานที่ต้องเกิดตามลำดับ",
    layout: "swimlane",
  },
  {
    section: "MAIN CONTENT", title: "วิธีใช้งานของนักเรียน", time: 3,
    key: "นักเรียนเห็นรายการของตนและดำเนินการตามปุ่มที่สอดคล้องกับสถานะ",
    bullets: ["เข้าสู่ระบบด้วยเลขนักเรียนและเลขบัตรประชาชน", "ดูรายการคงค้างและแถบความคืบหน้า", "กด ยื่นคำร้อง เมื่อสถานะ 0%", "เปิดหน้ารายละเอียดเมื่อครูมอบหมายแล้ว", "อ่านคำสั่ง กำหนดส่ง และดาวน์โหลดไฟล์", "รายการ 100% อยู่ในหน้าประวัติ"],
    citation: "README.md:19-20,45-46; src/components/workspace.tsx:118-145; src/components/assignment-detail.tsx:1-130",
    notes: "สาธิตจากรายการหนึ่งรายการ ตั้งแต่ปุ่มยื่นคำร้องจนย้ายไปอยู่ในประวัติ",
    layout: "roleSteps",
    accent: "blue",
  },
  {
    section: "MAIN CONTENT", title: "วิธีใช้งานของครูประจำวิชา", time: 3,
    key: "ครูรับช่วงจากคำร้องและส่งรายการต่อฝ่ายวิชาการหลังตรวจงาน",
    bullets: ["หน้าแรกแสดงคำร้องที่นักเรียนยื่นแล้ว", "กด มอบหมายงาน เพื่อเปิดหน้าแยก", "ระบุรายละเอียด กำหนดส่ง และไฟล์แนบ", "ยืนยันเมื่อนักเรียนนำงานมาส่ง", "ระบุผลการเรียนใหม่และกดอนุมัติ", "ส่งออกรายการคงค้างในรายวิชาของตน"],
    citation: "README.md:47-48; src/components/workspace.tsx:146-159,247-255; supabase/migrations/001_initial.sql:61-70",
    notes: "ย้ำว่าปุ่มเปลี่ยนตามขั้นตอน และครูดำเนินการเฉพาะรายการในรายวิชาที่รับผิดชอบ",
    layout: "roleSteps",
    accent: "purple",
  },
  {
    section: "MAIN CONTENT", title: "วิธีใช้งานของฝ่ายวิชาการ", time: 3,
    key: "ฝ่ายวิชาการยืนยันผลขั้นสุดท้ายและดูแลข้อมูลเข้าออกของระบบ",
    bullets: ["เห็นรายการที่ครูอนุมัติแล้ว", "ตรวจนักเรียน รายวิชา และผลการเรียนใหม่", "กดอนุมัติเพื่อเปลี่ยนสถานะเป็น 100%", "นำเข้ารายการผลการเรียนคงค้าง", "ส่งออกรายการที่แก้ไขสำเร็จแล้ว"],
    citation: "README.md:49,53-59; src/lib/domain.ts:88-89; supabase/migrations/001_initial.sql:66-79",
    notes: "อธิบายว่างานของฝ่ายวิชาการมีทั้งการอนุมัติรายรายการและงานข้อมูลเข้าออก",
    layout: "hub",
  },
  {
    section: "MAIN CONTENT", title: "วิธีใช้งานของผู้ดูแลระบบ", time: 2,
    key: "ผู้ดูแลกำหนดช่วงเวลาให้บริการ แต่ไม่มีหน้าที่อนุมัติผลการเรียน",
    bullets: ["เข้าสู่ระบบด้วย Username และ Password", "กำหนดวันเวลาเปิดและปิดระบบ", "เพิ่มข้อความประกาศสำหรับผู้ใช้", "ไม่มีหน้าที่เปลี่ยนสถานะผลการเรียน", "ไม่มีหน้าที่ดูหรืออนุมัติผลการเรียน"],
    citation: "README.md:24,50-51; src/lib/domain.ts:79-89; supabase/migrations/001_initial.sql:49,83-90",
    notes: "แยกหน้าที่ควบคุมช่วงเวลาออกจากหน้าที่ทางวิชาการให้ชัดเจน",
    layout: "admin",
  },
  {
    section: "MAIN CONTENT", title: "การนำเข้าข้อมูล", time: 3,
    key: "ฝ่ายวิชาการนำเข้าข้อมูลที่จำเป็น 11 คอลัมน์ พร้อมตรวจความครบถ้วนก่อนยืนยัน",
    bullets: ["รองรับไฟล์ XLSX, CSV และ TSV", "สูงสุด 5 MB และ 2,000 แถวต่อครั้ง", "เก็บเฉพาะ 11 คอลัมน์ที่กำหนด", "รองรับผลค้าง 0, ร, มส และ มผ", "ตรวจข้อมูลนักเรียนและครูผู้สอน", "รายการซ้ำไม่เขียนทับความคืบหน้าเดิม"],
    citation: "README.md:53-57; src/lib/import.ts:2-81; src/lib/import-excel.ts:4-26",
    notes: "อธิบายขั้นตอน เตรียมไฟล์ ตรวจผล และยืนยันการนำเข้า โดยไม่ลงรายละเอียดทางเทคนิค",
    layout: "import",
  },
  {
    section: "MAIN CONTENT", title: "การส่งออกและประวัติ", time: 2,
    key: "ครูและฝ่ายวิชาการส่งออกรายงานคนละขอบเขตตามหน้าที่ของตน",
    bullets: ["ครูส่งออกรายการคงค้างในขอบเขตของตน", "ฝ่ายวิชาการส่งออกรายการที่แก้ไขสำเร็จ", "รายงานสำเร็จมีผลการเรียนใหม่และเวลาอนุมัติ", "นักเรียนตรวจรายการที่เสร็จแล้วในหน้าประวัติ", "รายงานใช้ประกอบการติดตามงานของแต่ละฝ่าย"],
    citation: "README.md:48-49,59; src/lib/domain.ts:98-101; tests/domain.test.ts:29-33",
    notes: "เชื่อมหน้าประวัติของนักเรียนกับรายงานสำเร็จของฝ่ายวิชาการ โดยไม่กล่าวว่าระบบแทนระบบทะเบียนหลัก",
    layout: "export",
  },
  {
    section: "MAIN CONTENT", title: "ไฟล์แนบในงานที่ครูมอบหมาย", time: 2,
    key: "ครูแนบเอกสารประกอบกับงาน และนักเรียนเปิดดูจากหน้ารายละเอียดงาน",
    bullets: ["แนบได้สูงสุด 5 ไฟล์", "ขนาดรวมไม่เกิน 4 MB", "รองรับ PDF, Office, JPG, PNG และ TXT", "ครูแนบไฟล์พร้อมรายละเอียดและกำหนดส่ง", "นักเรียนดาวน์โหลดไฟล์จากหน้ารายละเอียดงาน"],
    citation: "src/components/assignment-actions.tsx:76-105; src/app/actions.ts:106-176; src/app/dashboard/assignments/[id]/page.tsx:34-48",
    notes: "สาธิตตำแหน่งแนบไฟล์ของครูและปุ่มดาวน์โหลดของนักเรียน โดยไม่อธิบายกลไกเบื้องหลัง",
    layout: "attachments",
  },
  {
    section: "MAIN CONTENT", title: "กติกาการทำงานร่วมกัน", time: 3,
    key: "แต่ละบทบาทเห็นและดำเนินการเฉพาะส่วนที่รับผิดชอบ พร้อมส่งต่องานตามลำดับ",
    bullets: ["นักเรียนดำเนินการเฉพาะรายการของตน", "ครูจัดการเฉพาะรายวิชาที่รับผิดชอบ", "ฝ่ายวิชาการรับช่วงต่อหลังครูอนุมัติ", "ผู้ดูแลกำหนดเวลา แต่ไม่อนุมัติผลการเรียน", "แต่ละรายการเดินหน้าได้ตามสถานะ", "การแก้ไขสำเร็จต้องผ่านการอนุมัติสองขั้น"],
    citation: "README.md:26-28,61-69; supabase/migrations/001_initial.sql:40-80; src/proxy.ts:14-33",
    notes: "ใช้สถานการณ์ตัวอย่างถามผู้ฟังว่า ตอนนี้ใครเป็นผู้ดำเนินการต่อ เพื่อทบทวนขอบเขตหน้าที่",
    layout: "rules",
  },
  {
    section: "MAIN CONTENT", title: "ความพร้อมสำหรับการทดลองใช้", time: 2,
    key: "ขั้นตอนหลักมีตัวอย่างให้ทดลองครบ แต่ยังต้องตรวจสอบกับผู้ใช้จริงก่อนเปิดเต็มรูปแบบ",
    bullets: ["มีโหมดทดลองตั้งแต่ยื่นคำร้องถึงประวัติ 100%", "มีตัวอย่างรายการครบ 4 บทบาท", "หน้าจอรองรับโทรศัพท์และคอมพิวเตอร์", "มีการตรวจขั้นตอนนำเข้าและส่งออกรายงาน", "ยังไม่ได้ทดสอบบัญชีจริงของนักเรียน ครู และฝ่ายวิชาการ"],
    citation: "VERIFICATION.md:1-24; README.md:70-71,84-90",
    notes: "โหมดทดลองใช้ข้อมูลสมมติ จึงควรจัดรอบทดลองกับผู้แทนแต่ละบทบาทและบันทึกข้อเสนอแนะก่อนใช้จริง",
    layout: "readiness",
  },
  {
    section: "CASE STUDIES", title: "ตัวอย่างรายการที่จบครบ 100%", time: 4,
    key: "ข้อมูลสมมติแสดงการส่งต่องานตั้งแต่คำร้องจนฝ่ายวิชาการอนุมัติ",
    bullets: ["กิตติพัฒน์ ใจดี ชั้น ม.4/2", "สุขศึกษาและพลศึกษา รหัส พ31101", "ผลเดิม 0 และผลใหม่ 1", "ยื่นคำร้อง 10 ก.ย. 2569", "ครูรับงานและอนุมัติ 14–15 ก.ย.", "ฝ่ายวิชาการอนุมัติ 16 ก.ย."],
    citation: "src/lib/demo.ts:2-31,38-89; README.md:70",
    notes: "ข้อมูลทั้งหมดเป็นข้อมูลสมมติ ใช้สาธิตการส่งต่องานเท่านั้น ไม่ใช่กรณีของนักเรียนจริง",
    layout: "caseTimeline",
  },
  {
    section: "CASE STUDIES", title: "ตัวอย่างการเตรียมข้อมูลนำเข้า", time: 3,
    key: "ระบบเลือกเฉพาะข้อมูลที่จำเป็นและคงรูปแบบรหัสนักเรียนไว้",
    bullets: ["รายวิชา ค31101 คณิตศาสตร์", "รหัสนักเรียนตัวอย่าง 00123", "ไฟล์มีคอลัมน์ส่วนเกิน รวม และ Q1", "ผลลัพธ์มีเฉพาะ 11 คอลัมน์ที่กำหนด", "รหัส 00123 ยังคงศูนย์นำหน้า", "คอลัมน์ที่ไม่จำเป็นไม่ถูกนำเข้า"],
    citation: "tests/domain.test.ts:34-56; src/lib/import.ts:2-14; VERIFICATION.md:9-10",
    notes: "ข้อมูลนี้เป็นตัวอย่าง ไม่ใช่ข้อมูลจริงของโรงเรียน ใช้อธิบายสิ่งที่ฝ่ายวิชาการต้องตรวจในไฟล์ก่อนนำเข้า",
    layout: "importCase",
  },
  {
    section: "CASE STUDIES", title: "หลักฐานจากการใช้งานจริง", time: 2,
    key: "โปรเจ็กต์มีตัวอย่างขั้นตอน แต่ยังไม่มีกรณีศึกษาจากผู้ใช้จริงให้สรุปผลลัพธ์",
    bullets: ["มีข้อมูล: ตัวอย่างขั้นตอนตั้งแต่ยื่นคำร้องถึงอนุมัติ", "มีข้อมูล: ตัวอย่างหน้าจอครบ 4 บทบาท", "ไม่มีข้อมูลในเอกสาร: การใช้งานจริงของนักเรียน", "ไม่มีข้อมูลในเอกสาร: การใช้งานจริงของครูและฝ่ายวิชาการ", "ไม่มีข้อมูลในเอกสาร: ผลกระทบต่อเวลา งานค้าง หรือคุณภาพข้อมูล"],
    citation: "VERIFICATION.md:3-24",
    notes: "หลีกเลี่ยงการกล่าวว่าโครงการลดภาระงานจนกว่าจะมีข้อมูลจากการทดลองใช้กับผู้ใช้จริง",
    layout: "evidenceMatrix",
  },
  {
    section: "SUMMARY", title: "ภาพรวมการทำงานของ 4 บทบาท", time: 3,
    key: "สถานะของรายการทำให้ทุกบทบาทรู้ว่าใครต้องทำอะไรต่อ",
    bullets: ["นักเรียนเริ่มคำร้องและติดตามสถานะ", "ครูกำหนดงาน รับงาน และเสนอผลการเรียนใหม่", "ฝ่ายวิชาการตรวจและปิดรายการที่ 100%", "ผู้ดูแลควบคุมช่วงเวลาให้บริการ", "การแบ่งหน้าที่ควบคุมลำดับงาน", "การนำเข้าและส่งออกสนับสนุนงานฝ่ายวิชาการ"],
    citation: "README.md:43-69; src/lib/domain.ts:64-89; supabase/migrations/001_initial.sql:45-80",
    notes: "ทบทวนเส้นทางหนึ่งรายการตั้งแต่เริ่มต้นถึงเสร็จสมบูรณ์ แล้วเชื่อมกลับไปยังหน้าที่ของแต่ละบทบาท",
    layout: "summary",
  },
  {
    section: "SUMMARY", title: "สิ่งที่ต้องทำก่อนเปิดใช้งานจริง", time: 4,
    key: "โรงเรียนต้องกำหนดเจ้าของงาน เตรียมข้อมูลผู้ใช้ และทดลองกระบวนงานครบทั้ง 4 บทบาท",
    bullets: ["ตรวจรายชื่อนักเรียน ครู และฝ่ายวิชาการ", "เตรียมข้อมูลผลคงค้างตาม 11 คอลัมน์", "กำหนดช่วงเวลาเปิดและปิดระบบ", "ทดลองใช้งานด้วยบัญชีจริงครบ 4 บทบาท", "ตรวจขั้นตอนอนุมัติ รายงาน และกรณีข้อมูลผิดพลาด", "กำหนดช่องทางแจ้งปัญหาและผู้ตัดสินใจ"],
    citation: "README.md:5-15,26-28,41,70-71; VERIFICATION.md:18-24",
    notes: "ปิดด้วยการมอบหมายเจ้าของงานในแต่ละข้อ เอกสารไม่มีข้อมูลว่าใครรับผิดชอบ จึงต้องกำหนดร่วมกันหลังการนำเสนอ",
    layout: "cta",
  },
];

function addShape(slide, geometry, x, y, w, h, fill, lineFill = "none", lineWidth = 0, radius = false) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : (geometry === "rectangle" ? "rect" : geometry),
    position: { left: x, top: y, width: w, height: h },
    fill: fill === "none" ? "none" : { type: "solid", color: fill },
    line: { fill: lineFill, width: lineWidth },
  });
}

function addText(slide, text, x, y, w, h, opts = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  box.text = text;
  box.text.style = {
    typeface: font,
    fontSize: opts.size ?? 22,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    autoFit: "none",
  };
  return box;
}

function addCitation(slide, citation, num) {
  addShape(slide, "line", 64, 674, 1152, 1, "none", C.line, 1);
  addText(slide, `ที่มา: ${citation}`, 64, 682, 1055, 22, { size: 9, color: C.muted });
  addText(slide, String(num).padStart(2, "0"), 1140, 680, 76, 24, { size: 10, color: C.purple, bold: true, align: "right" });
}

function addHeader(slide, s, num) {
  slide.background.fill = C.white;
  addShape(slide, "rectangle", 0, 0, 18, 720, C.purple);
  addText(slide, s.section, 64, 34, 360, 24, { size: 11, color: C.purple, bold: true });
  addText(slide, `${s.time} นาที`, 1092, 34, 124, 24, { size: 11, color: C.muted, align: "right" });
  addText(slide, s.title, 64, 72, 1120, 58, { size: 36, color: C.ink, bold: true });
  addShape(slide, "roundRect", 64, 143, 1120, 62, C.lavender, "none", 0, true);
  addText(slide, s.key, 86, 157, 1074, 36, { size: 19, color: C.purpleDark, bold: true, valign: "middle" });
  addCitation(slide, s.citation, num);
  slide.speakerNotes.textFrame.setText(`${s.notes}\n\nCitation: ${s.citation}`);
}

function addBulletList(slide, bullets, x = 96, y = 242, w = 1030, size = 20, gap = 58) {
  bullets.forEach((b, i) => {
    addShape(slide, "ellipse", x, y + i * gap + 7, 14, 14, i % 2 === 0 ? C.purple : C.green);
    addText(slide, b, x + 32, y + i * gap, w - 32, 42, { size, color: C.ink, valign: "middle" });
  });
}

function addStepRow(slide, labels, y = 330, colors = [C.purple, C.blue, C.green, C.amber, C.rose]) {
  const gap = 22;
  const totalW = 1110;
  const w = (totalW - gap * (labels.length - 1)) / labels.length;
  labels.forEach((label, i) => {
    const x = 72 + i * (w + gap);
    addShape(slide, "ellipse", x + w / 2 - 24, y - 48, 48, 48, colors[i % colors.length]);
    addText(slide, String(i + 1), x + w / 2 - 20, y - 40, 40, 30, { size: 16, color: C.white, bold: true, align: "center", valign: "middle" });
    if (i < labels.length - 1) addShape(slide, "line", x + w / 2 + 24, y - 24, w + gap - 48, 1, "none", C.line, 3);
    addText(slide, label, x, y + 18, w, 72, { size: 17, color: C.ink, bold: true, align: "center", valign: "top" });
  });
}

function addRoleLabel(slide, label, x, y, w, color) {
  addShape(slide, "roundRect", x, y, w, 58, color, "none", 0, true);
  addText(slide, label, x + 10, y + 10, w - 20, 36, { size: 18, color: C.white, bold: true, align: "center", valign: "middle" });
}

function renderContent(slide, s, num) {
  if (s.layout === "cover") {
    slide.background.fill = C.purpleDeep;
    addShape(slide, "rectangle", 0, 0, 1280, 18, C.purple);
    addText(slide, "MST", 72, 58, 180, 66, { size: 42, color: C.lavender2, bold: true });
    addText(slide, "GRADE RECOVERY SYSTEM", 72, 122, 520, 34, { size: 16, color: C.lavender2, bold: true });
    addText(slide, "ระบบแก้ไขผลการเรียนคงค้าง", 72, 230, 900, 82, { size: 48, color: C.white, bold: true });
    addText(slide, "โรงเรียนเมืองสุราษฎร์ธานี", 72, 326, 760, 52, { size: 28, color: C.lavender2 });
    addShape(slide, "line", 72, 416, 1040, 1, "none", C.purple, 3);
    addText(slide, "นักเรียน    ครู    ฝ่ายวิชาการ    ผู้ดูแลระบบ", 72, 450, 930, 46, { size: 21, color: C.white });
    addText(slide, "การนำเสนอ 60 นาที", 72, 572, 350, 40, { size: 18, color: C.lavender2 });
    addText(slide, `ที่มา: ${s.citation}`, 72, 667, 1050, 20, { size: 9, color: C.lavender2 });
    addText(slide, "01", 1140, 665, 76, 22, { size: 10, color: C.white, bold: true, align: "right" });
    slide.speakerNotes.textFrame.setText(`${s.notes}\n\nCitation: ${s.citation}`);
    return;
  }

  addHeader(slide, s, num);

  if (s.layout === "agenda") {
    addStepRow(slide, ["โจทย์และขอบเขต", "วิธีใช้งาน", "ตัวอย่าง", "ความพร้อม"], 340, [C.rose, C.purple, C.blue, C.green]);
    addText(slide, "การนำเสนอแยกข้อมูลที่มีหลักฐานออกจากข้อมูลที่ยังไม่มี", 188, 526, 900, 42, { size: 21, color: C.purpleDark, bold: true, align: "center" });
  } else if (s.layout === "record") {
    addShape(slide, "roundRect", 478, 278, 324, 212, C.lavender, C.purple, 2, true);
    addText(slide, "หนึ่งรายการผลการเรียนคงค้าง", 512, 306, 256, 66, { size: 22, color: C.purpleDark, bold: true, align: "center", valign: "middle" });
    addText(slide, "นักเรียน  •  รายวิชา\nครู  •  ปีการศึกษา  •  ภาคเรียน", 512, 390, 256, 70, { size: 17, color: C.muted, align: "center" });
    addRoleLabel(slide, "นักเรียนเริ่มคำร้อง", 82, 280, 270, C.blue);
    addRoleLabel(slide, "ครูมอบหมายและอนุมัติ", 82, 428, 270, C.purple);
    addRoleLabel(slide, "ฝ่ายวิชาการปิดรายการ", 928, 280, 270, C.green);
    addRoleLabel(slide, "ผู้ดูแลกำหนดเวลา", 928, 428, 270, C.amber);
  } else if (s.layout === "evidenceGap") {
    addText(slide, "มีข้อมูลในเอกสาร", 94, 252, 430, 44, { size: 25, color: C.green, bold: true });
    addText(slide, "ขั้นตอนการทำงาน\nสถานะและหน้าที่ของแต่ละบทบาท\nตัวอย่างข้อมูลสมมติ", 94, 314, 430, 180, { size: 20, color: C.ink });
    addShape(slide, "line", 624, 246, 1, 330, "none", C.line, 2);
    addText(slide, "ไม่มีข้อมูลในเอกสาร", 694, 252, 450, 44, { size: 25, color: C.rose, bold: true });
    addText(slide, "จำนวนรายการก่อนใช้ระบบ\nระยะเวลาก่อนและหลังใช้ระบบ\nภาระงานเดิมและความพึงพอใจ\nผลจากผู้ใช้จริง", 694, 314, 450, 220, { size: 20, color: C.ink });
  } else if (s.layout === "scope") {
    addShape(slide, "ellipse", 470, 266, 340, 240, C.purple);
    addText(slide, "MST GRS", 530, 330, 220, 48, { size: 32, color: C.white, bold: true, align: "center" });
    addText(slide, "ระบบกลางของ 4 บทบาท", 520, 394, 240, 40, { size: 17, color: C.lavender2, align: "center" });
    const items = [["เข้าสู่ระบบ",100,270,C.blue],["ติดตามสถานะ",100,455,C.green],["มอบหมายและอนุมัติ",900,270,C.purple],["นำเข้าและส่งออก",900,455,C.amber]];
    items.forEach(([t,x,y,c]) => addRoleLabel(slide,t,x,y,280,c));
  } else if (s.layout === "journey") {
    addStepRow(slide, ["เข้าสู่ระบบ", "เห็นรายการ", "ดำเนินการ", "ส่งต่องาน", "ตรวจประวัติ"], 350);
  } else if (s.layout === "rolesTable") {
    const rows = [
      ["นักเรียน", "เลขประจำตัวนักเรียน + เลขบัตรประชาชน", C.blue],
      ["ครู", "เลขบัตรประชาชน 13 หลัก", C.purple],
      ["ฝ่ายวิชาการ", "เลขบัตรประชาชน 13 หลัก", C.green],
      ["ผู้ดูแลระบบ", "Username + Password", C.amber],
    ];
    rows.forEach(([role, credential, color], i) => {
      const y = 242 + i * 86;
      addText(slide, role, 90, y + 10, 250, 44, { size: 21, color, bold: true });
      addShape(slide, "line", 352, y + 26, 72, 1, "none", C.line, 2);
      addText(slide, credential, 454, y + 8, 650, 48, { size: 20, color: C.ink });
    });
  } else if (s.layout === "progress") {
    const stages = [["0%","ยังไม่ยื่นคำร้อง",C.rose],["25%","รอมอบหมายงาน",C.amber],["50%","อยู่ระหว่างดำเนินการ",C.blue],["75%","ส่งงานแล้ว / รออนุมัติ",C.purple],["100%","แก้ไขสำเร็จ",C.green]];
    stages.forEach(([p,l,c], i) => {
      const x = 72 + i * 224;
      if (i < 4) addShape(slide, "line", x + 96, 342, 128, 1, "none", C.line, 6);
      addShape(slide, "ellipse", x + 46, 292, 100, 100, c);
      addText(slide, p, x + 56, 322, 80, 36, { size: 20, color: C.white, bold: true, align: "center" });
      addText(slide, l, x, 414, 192, 76, { size: 17, color: C.ink, bold: true, align: "center" });
    });
    addText(slide, "ที่ 75% ต้องอ่านชื่อสถานะร่วมด้วย เพราะมีสองช่วงงาน", 250, 542, 780, 38, { size: 18, color: C.purpleDark, bold: true, align: "center" });
  } else if (s.layout === "swimlane") {
    const roles = [["นักเรียน","ยื่นคำร้อง",C.blue],["ครู","มอบหมาย  รับงาน  อนุมัติ",C.purple],["ฝ่ายวิชาการ","ตรวจและอนุมัติขั้นสุดท้าย",C.green],["ผู้ดูแล","กำหนดช่วงเวลา",C.amber]];
    roles.forEach(([r,a,c],i)=>{
      const y=238+i*92;
      addRoleLabel(slide,r,80,y,210,c);
      addShape(slide,"line",314,y+29,100,1,"none",C.line,3);
      addText(slide,a,448,y+11,650,44,{size:20,color:C.ink,bold:true});
    });
  } else if (s.layout === "roleSteps") {
    const colors = s.accent === "blue" ? [C.blue,C.purple,C.green,C.amber,C.rose,C.blue] : [C.purple,C.blue,C.green,C.amber,C.rose,C.purple];
    s.bullets.forEach((b,i)=>{
      const col=i%2, row=Math.floor(i/2), x=82+col*560, y=236+row*118;
      addShape(slide,"ellipse",x,y,52,52,colors[i]);
      addText(slide,String(i+1),x+8,y+11,36,26,{size:16,color:C.white,bold:true,align:"center"});
      addText(slide,b,x+76,y-1,430,70,{size:19,color:C.ink,bold:i===0});
    });
  } else if (s.layout === "hub") {
    addShape(slide,"ellipse",486,288,308,190,C.green);
    addText(slide,"ฝ่ายวิชาการ",526,346,228,44,{size:28,color:C.white,bold:true,align:"center"});
    const nodes=[["อนุมัติขั้นสุดท้าย",92,300,C.purple],["นำเข้ารายการคงค้าง",860,242,C.blue],["ส่งออกรายการสำเร็จ",860,450,C.amber]];
    nodes.forEach(([t,x,y,c])=>addRoleLabel(slide,t,x,y,300,c));
  } else if (s.layout === "admin") {
    addShape(slide,"roundRect",108,266,430,250,C.amberLight,C.amber,2,true);
    addText(slide,"หน้าที่ของผู้ดูแล",148,298,350,42,{size:25,color:C.amber,bold:true,align:"center"});
    addText(slide,"กำหนดช่วงเวลาเปิดและปิด\nเพิ่มข้อความประกาศสำหรับผู้ใช้",148,370,350,100,{size:20,color:C.ink,align:"center"});
    addShape(slide,"roundRect",742,266,430,250,C.roseLight,C.rose,2,true);
    addText(slide,"ไม่ใช่หน้าที่ของผู้ดูแล",782,298,350,42,{size:25,color:C.rose,bold:true,align:"center"});
    addText(slide,"ดูหรือเปลี่ยนผลการเรียน\nอนุมัติรายการแทนฝ่ายวิชาการ",782,370,350,100,{size:20,color:C.ink,align:"center"});
  } else if (s.layout === "import") {
    addStepRow(slide,["เตรียมไฟล์\n11 คอลัมน์","ตรวจข้อมูล\nทุกแถว","ยืนยันผล\nการนำเข้า"],330,[C.blue,C.purple,C.green]);
    addText(slide,"รองรับ XLSX, CSV และ TSV  •  สูงสุด 5 MB  •  2,000 แถว",200,526,880,40,{size:18,color:C.muted,bold:true,align:"center"});
  } else if (s.layout === "export") {
    addRoleLabel(slide,"ครู",110,268,220,C.purple);
    addText(slide,"รายการคงค้าง\nในรายวิชาที่รับผิดชอบ",110,354,220,100,{size:19,color:C.ink,bold:true,align:"center"});
    addRoleLabel(slide,"ฝ่ายวิชาการ",530,268,220,C.green);
    addText(slide,"รายการที่แก้ไข\nสำเร็จแล้ว",530,354,220,100,{size:19,color:C.ink,bold:true,align:"center"});
    addRoleLabel(slide,"นักเรียน",950,268,220,C.blue);
    addText(slide,"ประวัติรายการ\nของตนเอง",950,354,220,100,{size:19,color:C.ink,bold:true,align:"center"});
    addShape(slide,"line",330,297,200,1,"none",C.line,3);
    addShape(slide,"line",750,297,200,1,"none",C.line,3);
  } else if (s.layout === "attachments") {
    addStepRow(slide,["ครูเตรียมงาน","แนบเอกสาร","นักเรียนเปิดรายละเอียด","ดาวน์โหลดไฟล์"],338,[C.purple,C.amber,C.blue,C.green]);
    addText(slide,"สูงสุด 5 ไฟล์  •  รวมไม่เกิน 4 MB  •  PDF, Office, JPG, PNG, TXT",170,538,940,40,{size:18,color:C.muted,bold:true,align:"center"});
  } else if (s.layout === "rules") {
    addShape(slide,"ellipse",492,302,296,180,C.lavender,C.purple,2);
    addText(slide,"รายการผลการเรียน\nคงค้าง",552,356,176,70,{size:23,color:C.purpleDark,bold:true,align:"center"});
    const nodes=[["นักเรียน\nรายการของตน",92,256,C.blue],["ครู\nรายวิชาของตน",92,458,C.purple],["ฝ่ายวิชาการ\nอนุมัติขั้นสุดท้าย",888,256,C.green],["ผู้ดูแล\nกำหนดเวลา",888,458,C.amber]];
    nodes.forEach(([t,x,y,c])=>addRoleLabel(slide,t,x,y,300,c));
  } else if (s.layout === "readiness") {
    const yes=s.bullets.slice(0,4), no=s.bullets.slice(4);
    addText(slide,"พร้อมสำหรับการทดลอง",86,242,480,42,{size:25,color:C.green,bold:true});
    yes.forEach((b,i)=>{addShape(slide,"ellipse",92,304+i*61,18,18,C.green);addText(slide,b,128,295+i*61,470,40,{size:18,color:C.ink});});
    addShape(slide,"line",640,240,1,330,"none",C.line,2);
    addText(slide,"ยังต้องดำเนินการ",706,242,430,42,{size:25,color:C.rose,bold:true});
    addText(slide,no[0],706,316,430,120,{size:21,color:C.ink,bold:true});
    addText(slide,"ควรทดลองกับตัวแทนครบทั้ง 4 บทบาท",706,460,430,70,{size:18,color:C.muted});
  } else if (s.layout === "caseTimeline") {
    const events=[["10 ก.ย.","ยื่นคำร้อง",C.blue],["12 ก.ย.","มอบหมาย",C.purple],["14 ก.ย.","รับงาน",C.amber],["15 ก.ย.","ครูอนุมัติ",C.purple],["16 ก.ย.","วิชาการอนุมัติ",C.green]];
    events.forEach(([d,e,c],i)=>{const x=74+i*224;if(i<4)addShape(slide,"line",x+76,358,148,1,"none",C.line,5);addShape(slide,"ellipse",x+34,316,84,84,c);addText(slide,d,x+28,270,96,34,{size:15,color:c,bold:true,align:"center"});addText(slide,String(i+1),x+54,340,44,24,{size:16,color:C.white,bold:true,align:"center"});addText(slide,e,x,422,152,54,{size:17,color:C.ink,bold:true,align:"center"});});
    addText(slide,"ข้อมูลสมมติ: กิตติพัฒน์ ใจดี  •  พ31101  •  ผลเดิม 0  •  ผลใหม่ 1",170,540,940,36,{size:18,color:C.purpleDark,bold:true,align:"center"});
  } else if (s.layout === "importCase") {
    addText(slide,"ไฟล์ตัวอย่าง",90,246,420,40,{size:24,color:C.purple,bold:true});
    addText(slide,"รหัสนักเรียน 00123\nรวม\nQ1\nคอลัมน์อื่นในไฟล์ต้นทาง",90,316,420,220,{size:20,color:C.ink});
    addShape(slide,"line",616,248,1,330,"none",C.line,2);
    addText(slide,"ข้อมูลที่นำเข้า",690,246,420,40,{size:24,color:C.green,bold:true});
    addText(slide,"รหัสนักเรียน 00123\nเฉพาะ 11 คอลัมน์ที่กำหนด\nคงเลขศูนย์นำหน้า\nไม่รวมคอลัมน์ที่ไม่จำเป็น",690,316,420,220,{size:20,color:C.ink});
  } else if (s.layout === "evidenceMatrix") {
    addText(slide,"มีข้อมูลในเอกสาร",90,246,430,42,{size:25,color:C.green,bold:true});
    addText(slide,"ตัวอย่างขั้นตอนครบจนอนุมัติ\nตัวอย่างหน้าจอครบ 4 บทบาท",90,320,430,120,{size:20,color:C.ink});
    addShape(slide,"line",624,246,1,320,"none",C.line,2);
    addText(slide,"ไม่มีข้อมูลในเอกสาร",690,246,450,42,{size:25,color:C.rose,bold:true});
    addText(slide,"การใช้งานจริงของนักเรียน\nการใช้งานจริงของครูและฝ่ายวิชาการ\nผลต่อเวลา งานค้าง หรือคุณภาพข้อมูล",690,320,450,180,{size:20,color:C.ink});
  } else if (s.layout === "summary") {
    const roles=[["นักเรียน","ยื่นคำร้อง\nติดตามสถานะ",C.blue],["ครู","มอบหมาย\nรับงาน  อนุมัติ",C.purple],["ฝ่ายวิชาการ","ตรวจผล\nปิดรายการ 100%",C.green],["ผู้ดูแล","กำหนดช่วงเวลา\nเปิดและปิด",C.amber]];
    roles.forEach(([r,a,c],i)=>{const x=68+i*296;addRoleLabel(slide,r,x,270,254,c);addText(slide,a,x,362,254,90,{size:19,color:C.ink,bold:true,align:"center"});if(i<3)addShape(slide,"line",x+254,299,42,1,"none",C.line,3);});
    addText(slide,"นำเข้าและส่งออกสนับสนุนงานข้อมูลของฝ่ายวิชาการ",250,528,780,38,{size:19,color:C.purpleDark,bold:true,align:"center"});
  } else if (s.layout === "cta") {
    s.bullets.forEach((b,i)=>{const col=i%2,row=Math.floor(i/2),x=78+col*584,y=236+row*116;addShape(slide,"rectangle",x,y+3,6,68,i<3?C.purple:C.green);addText(slide,String(i+1).padStart(2,"0"),x+24,y,54,40,{size:18,color:i<3?C.purple:C.green,bold:true});addText(slide,b,x+86,y,440,70,{size:18,color:C.ink,bold:true});});
  } else {
    addBulletList(slide, s.bullets);
  }
}

await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });

const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
slides.forEach((s, i) => {
  const slide = presentation.slides.add();
  renderContent(slide, s, i + 1);
});

const candidatePath = path.join(buildDir, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href);
const requirements = {
  explicitTotalSlideCount: 23,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
};
const result = await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-bullet-geometry", "--validate-heading-fit"],
  fontPolicy: { basis: "design", families: [font] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(buildDir, "MST-GRS-presentation-v1.validation.json"),
});

console.log(JSON.stringify({ finalPath, result }, null, 2));
