export const siteUrl = "https://mst-grs-xcua.vercel.app";
export const siteName = "MST GRS";
export const siteTitle =
  "ระบบแก้ไขผลการเรียนคงค้าง โรงเรียนเมืองสุราษฎร์ธานี | MST GRS";
export const siteDescription =
  "MST GRS ระบบแก้ไขผลการเรียนคงค้าง โรงเรียนเมืองสุราษฎร์ธานี สำหรับนักเรียนยื่นคำร้องและติดตามงาน ครูมอบหมายงานและตรวจรับ และฝ่ายวิชาการติดตามผลการแก้ไข";

// Preview deployments must not compete with the production URL in search.
export const allowIndexing = process.env.VERCEL_ENV !== "preview";
