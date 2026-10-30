import type { NextConfig } from "next";

// Fail the build rather than shipping a bundle that points at localhost.
// NEXT_PUBLIC_* is inlined at build time, so an unset value silently compiles
// the fallback in src/lib/api.ts into every browser bundle. .env.production
// supplies the value; this assertion makes a future omission loud.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is unset at build time. It is inlined into the browser " +
      "bundle, so wrangler.jsonc `vars` cannot supply it — set it in web/.env.production.",
  );
}

const nextConfig: NextConfig = {
  // Listing photos, proofs and inspection media arrive as short-lived R2
  // presigned URLs. next/image is deliberately not used for them: the
  // optimizer would cache a URL that expires in ten minutes.
  images: { unoptimized: true },
};

export default nextConfig;
