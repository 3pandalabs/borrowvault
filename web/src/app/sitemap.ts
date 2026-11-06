import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public, indexable URLs only: the landing page and the legal pages.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date("2026-11-06"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date("2026-11-06"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
