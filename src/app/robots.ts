import type { MetadataRoute } from "next";
import { allowIndexing, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Leave pages crawlable so crawlers can read their noindex metadata.
    rules: {
      userAgent: "*",
      ...(allowIndexing ? { allow: "/" } : { disallow: "/" }),
    },
    ...(allowIndexing ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
