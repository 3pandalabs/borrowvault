import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the landing page and /privacy, /terms, /delete-account are public. Authed pages also send
// `robots: { index: false }` from their layouts, which is the stronger signal
// (a robots.txt-blocked URL can still be indexed from an inbound link).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/home",
          "/onboarding",
          "/profile",
          "/listings",
          "/bookings",
          "/messages",
          "/admin/",
          "/platform",
          "/societies",
          "/admin-requests",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
