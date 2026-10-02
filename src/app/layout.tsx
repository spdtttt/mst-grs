import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import "@fontsource-variable/noto-sans-thai";
import "@fontsource/prompt/400.css";
import "@fontsource/prompt/500.css";
import "@fontsource/prompt/600.css";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "MST GRS | ระบบแก้ไขผลการเรียนคงค้าง",
  description: "ระบบจัดการผลการเรียนคงค้างและติดตามการแก้ไขผลการเรียน",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className="scheme-light">
      <body className="m-0 bg-canvas font-sans text-sm leading-[1.7] text-ink [-webkit-tap-highlight-color:transparent] motion-reduce:[&_*]:scroll-auto">
        {children}
      </body>
    </html>
  );
}
