// Long-form layout for the public legal pages (/privacy, /terms). Server
// components only: no state, no client JS. The repo has no typography plugin,
// so the prose styles live here.
import Link from "next/link";
import { Backdrop } from "@/components/Backdrop";
import { Logo } from "@/components/Wordmark";

// Both mailboxes are Cloudflare Email Routing addresses on 3pandalabs.com.
// The privacy one doubles as the Grievance Officer contact (DPDP Act / IT Rules).
export const PRIVACY_EMAIL = "privacy@3pandalabs.com";
export const SUPPORT_EMAIL = "support@3pandalabs.com";

export const LAST_UPDATED = "10 November 2026";

export type TocEntry = { id: string; title: string };

export function LegalPage({
  title,
  intro,
  toc,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  toc: TocEntry[];
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <Backdrop />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex gap-4 text-sm text-fg-muted">
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-20">
        <article className="rounded-3xl border border-line bg-white/90 p-6 backdrop-blur-sm sm:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-2 text-sm text-fg-muted">Last updated: {LAST_UPDATED}</p>
          <div className="mt-6 space-y-4 text-[15px] leading-7 text-fg">{intro}</div>
          <nav aria-label="Contents" className="mt-8 rounded-2xl border border-line bg-bg-subtle p-5">
            <p className="text-sm font-semibold text-fg">Contents</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {toc.map((e) => (
                <li key={e.id}>
                  <a href={`#${e.id}`} className="text-accent hover:underline">
                    {e.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="mt-10 space-y-10">{children}</div>
        </article>
      </main>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
      <div className="mt-3 space-y-4 text-[15px] leading-7 text-fg">{children}</div>
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 font-semibold text-fg">{children}</h3>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

export function Mail({ to }: { to: string }) {
  return (
    <a href={`mailto:${to}`} className="font-medium text-accent hover:underline">
      {to}
    </a>
  );
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}
