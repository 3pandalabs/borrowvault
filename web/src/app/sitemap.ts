import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public, indexable URLs only: the landing page, the legal pages and the
// account-deletion page (Google Play links to it).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date("2026-11-09"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date("2026-11-06"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/delete-account`, lastModified: new Date("2026-11-09"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
