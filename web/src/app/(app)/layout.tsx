import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

// Every signed-in surface is noindex. robots.txt also disallows these paths,
// but the meta tag is the signal that actually keeps a linked URL out.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
