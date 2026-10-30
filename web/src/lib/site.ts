// The site's own public origin. Every absolute URL Next.js generates
// (canonical, OpenGraph, sitemap) resolves against this. Lives in lib/ so
// robots.ts and sitemap.ts don't import the root layout.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://borrowvault.3pandalabs.com";
