import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// One entry on purpose: the landing page is the only public, indexable URL.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}
