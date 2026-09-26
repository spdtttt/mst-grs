import Login from "@/components/login";
import type { Metadata } from "next";
import {
  allowIndexing,
  siteDescription,
  siteName,
  siteTitle,
  siteUrl,
} from "@/lib/site";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";
import { safeReturnPath } from "@/lib/navigation";
import { isRole } from "@/lib/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: { canonical: "/" },
  robots: { index: allowIndexing, follow: true },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined },
  openGraph: {
    type: "website",
    url: "/",
    siteName,
    title: siteTitle,
    description: siteDescription,
    locale: "th_TH",
    images: [{ url: "/icon.png", alt: "MST GRS โรงเรียนเมืองสุราษฎร์ธานี" }],
  },
  twitter: {
    card: "summary",
    title: siteTitle,
    description: siteDescription,
    images: ["/icon.png"],
  },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );
  if (configured()) {
    const db = await supabase();
    const {
      data: { user },
    } = await db.auth.getUser();

    if (user) {
      const { data: profile } = await db
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (isRole(profile?.role)) redirect(next);
    }
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: siteName,
            alternateName: "MST Grade Recovery System",
            url: `${siteUrl}/`,
            description: siteDescription,
            inLanguage: "th",
          }).replace(/</g, "\\u003c"),
        }}
      />
      <Login next={next} />
    </>
  );
}
