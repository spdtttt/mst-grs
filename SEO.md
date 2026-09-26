# SEO และการเปิดให้ค้นพบเว็บไซต์

URL หลัก: https://mst-grs-xcua.vercel.app/

## สิ่งที่ตั้งค่าในโค้ด

- หน้าแรกมี title, description, canonical, Open Graph, Twitter card และ WebSite JSON-LD
- หน้าแรกเปิด index ส่วนหน้าภายในและหน้าทดลองยังรับค่า noindex จาก root layout
- Sitemap มีเฉพาะหน้าแรก ไม่มีข้อมูลนักเรียนหรือ URL งานรายบุคคล
- robots.txt อนุญาตการ crawl เพื่อให้บอตอ่าน noindex ของหน้าภายในได้ การป้องกันข้อมูลยังใช้ระบบสิทธิ์และการเข้าสู่ระบบ
- Vercel Preview ใช้ noindex และ robots disallow พร้อม sitemap ว่าง
- Query เช่น `/?next=/dashboard` ใช้ canonical หน้าแรกเพื่อรวม URL ที่มีเนื้อหาเดียวกัน

## หลัง deploy บน Vercel

1. เปิด Google Search Console และเพิ่ม property แบบ URL prefix: `https://mst-grs-xcua.vercel.app/`
2. เลือกยืนยันด้วย HTML tag แล้วคัดลอกเฉพาะค่า `content` ใส่ Environment Variable ชื่อ `GOOGLE_SITE_VERIFICATION` ใน Vercel สำหรับ Production
3. Redeploy แล้วกดยืนยันใน Search Console
4. ส่ง sitemap: `https://mst-grs-xcua.vercel.app/sitemap.xml`
5. ใช้ URL Inspection ตรวจหน้าแรกและเลือก Request indexing
6. หากผู้ดูแลเว็บไซต์โรงเรียนอนุญาต ให้เพิ่มลิงก์จากเว็บไซต์โรงเรียนมาที่ระบบนี้ เพื่อให้นักเรียนและเครื่องมือค้นหาพบทางเข้า

ตรวจ HTML หน้าแรกหลัง deploy ว่ามี `index, follow` และ canonical ที่ตรงกับ URL หลัก รวมถึงตรวจว่า robots.txt และ sitemap.xml ตอบ 200 การส่ง sitemap หรือขอจัดทำดัชนีไม่รับประกันอันดับหรือเวลาที่จะปรากฏในผลค้นหา

หากเปลี่ยนโดเมน ให้แก้ `src/lib/site.ts` ตั้ง redirect จากโดเมนเดิม และยืนยันโดเมนใหม่ใน Search Console

## เอกสารอ้างอิง

- [Google: robots meta tag และ noindex](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
- [Google: สร้างและส่ง sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: ขอให้ crawl URL อีกครั้ง](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
