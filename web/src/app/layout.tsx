import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { geistSans } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";

// Titles and share tags follow 3pandalabs/brand brand.md "Consistency rules":
// home = "<App> — <line> | by 3PandaLabs", other pages = "<Page> — BorrowVault",
// og:image = the 1200x630 card generated from brand/og (public/og.png).
const TITLE = "BorrowVault — Borrow, lend and share inside your society | by 3PandaLabs";
const DESCRIPTION =
  "Borrow a drill, lend a stroller, or offer an hour of tutoring to verified neighbours in your own gated society. Photo-proof handovers and returns, payments straight over UPI.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s — BorrowVault" },
  description: DESCRIPTION,
  applicationName: "BorrowVault",
  openGraph: {
    type: "website",
    siteName: "BorrowVault by 3PandaLabs",
    locale: "en_IN",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "BorrowVault by 3PandaLabs" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className={`flex min-h-screen flex-col antialiased ${geistSans.variable}`}>
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
