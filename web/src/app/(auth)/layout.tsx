import type { Metadata } from "next";
import { Backdrop } from "@/components/Backdrop";
import { Logo } from "@/components/Wordmark";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col items-center justify-center px-4 py-10">
      <Backdrop />
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white/90 p-6 shadow-xl shadow-zinc-900/5 backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}
