import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import "@fontsource-variable/noto-sans-thai";
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
      <body className="m-0 bg-canvas font-sans text-sm leading-[1.7] text-ink [-webkit-tap-highlight-color:transparent] motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none">
        {children}
      </body>
    </html>
  );
}
