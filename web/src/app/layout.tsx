import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { geistSans } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";

const TITLE = "BorrowVault: borrow, lend and share skills inside your society";
const DESCRIPTION =
  "Borrow a drill, lend a stroller, or offer an hour of tutoring to verified neighbours in your own gated society. Photo-proof handovers and returns, payments straight over UPI.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · BorrowVault" },
  description: DESCRIPTION,
  applicationName: "BorrowVault",
  openGraph: { type: "website", siteName: "BorrowVault", locale: "en_IN", url: SITE_URL, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
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
