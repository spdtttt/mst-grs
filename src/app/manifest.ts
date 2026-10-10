import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MST Grade Recovery System",
    short_name: "MST GRS",
    description: "ระบบแก้ไขผลการเรียนคงค้าง โรงเรียนเมืองสุราษฎร์ธานี",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f6fb",
    theme_color: "#713cd1",
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        purpose: "any",
        type: "image/png",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        purpose: "any",
        type: "image/png",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        purpose: "maskable",
        type: "image/png",
      },
    ],
  };
}
