import type { MetadataRoute } from "next";
import { allowIndexing, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return allowIndexing ? [{ url: `${siteUrl}/` }] : [];
}
