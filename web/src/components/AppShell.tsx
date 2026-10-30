"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, logout } from "@/lib/api";
import { SessionProvider, useMeLoader, useSession, useSignedIn } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Backdrop } from "./Backdrop";
import { LoadError, Loading, selectClass } from "./common";
import { Logo } from "./Wordmark";

/**
 * Gate on what renders, NOT a security boundary: every request carries a
 * bearer token the API validates. No middleware (see ../../CLAUDE.md).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signedIn = useSignedIn();
  const me = useMeLoader(signedIn);

  useEffect(() => {
    if (!signedIn) router.replace("/login");
  }, [signedIn, router]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login");
  }, [me.error, router]);

  if (!signedIn) return null;

  return (
    <div className="min-h-screen">
      <Backdrop />
      {me.data ? (
        <SessionProvider me={me.data} refresh={me.reload} setMe={me.setData}>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
        </SessionProvider>
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-8">
          {me.error ? <LoadError error={me.error} onRetry={me.reload} /> : <Loading />}
        </main>
      )}
    </div>
  );
}

function Header() {
  const { user, approved, adminOf, active, setActiveSociety } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links: { href: string; label: string }[] = [
    { href: "/home", label: "Home" },
    ...(approved.length ? [{ href: "/listings", label: "Browse" }, { href: "/bookings", label: "Bookings" }] : []),
    { href: "/profile", label: "Profile" },
    ...adminOf.map((m) => ({
      href: `/admin/${m.societyId}`,
      label: adminOf.length > 1 ? `Admin · ${m.societyName}` : "Society admin",
    })),
    ...(user.isPlatformAdmin ? [{ href: "/platform", label: "Platform" }] : []),
  ];

  async function signOut() {
    await logout().catch(() => undefined);
    router.replace("/login");
  }

  const nav = links.map((l) => (
    <Link
      key={l.href}
      href={l.href}
      onClick={() => setOpen(false)}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm text-fg-muted hover:bg-zinc-100 hover:text-fg",
        pathname === l.href || (l.href !== "/home" && pathname.startsWith(l.href)) ? "bg-zinc-100 font-medium text-fg" : "",
      )}
    >
      {l.label}
    </Link>
  ));

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Logo href="/home" />
        <nav className="hidden items-center gap-1 md:flex">{nav}</nav>
        <div className="flex items-center gap-2">
          {approved.length > 1 && active ? (
            <select
              aria-label="Society"
              className={cn(selectClass, "hidden h-9 w-44 md:flex")}
              value={active.societyId}
              onChange={(e) => setActiveSociety(e.target.value)}
            >
              {approved.map((m) => (
                <option key={m.id} value={m.societyId}>
                  {m.societyName}
                </option>
              ))}
            </select>
          ) : null}
          <button
            onClick={signOut}
            className="hidden items-center gap-1 rounded-full px-3 py-1.5 text-sm text-fg-muted hover:bg-zinc-100 hover:text-fg md:inline-flex"
          >
            <LogOut className="size-4" /> Sign out
          </button>
          <button className="rounded-full p-2 md:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-line px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">{nav}</nav>
          {approved.length > 1 && active ? (
            <select
              aria-label="Society"
              className={cn(selectClass, "mt-2")}
              value={active.societyId}
              onChange={(e) => setActiveSociety(e.target.value)}
            >
              {approved.map((m) => (
                <option key={m.id} value={m.societyId}>
                  {m.societyName}
                </option>
              ))}
            </select>
          ) : null}
          <button onClick={signOut} className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-sm text-fg-muted">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      ) : null}
    </header>
  );
}

/** For resident pages that need an approved membership: renders the next step otherwise. */
export function RequireApproved({ children }: { children: React.ReactNode }) {
  const { active, memberships } = useSession();
  if (active) return <>{children}</>;
  const pending = memberships.some((m) => m.status === "pending");
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-6 text-center">
      <p className="font-medium">{pending ? "Your membership is waiting for approval" : "Join your society first"}</p>
      <p className="mt-1 text-sm text-fg-muted">
        {pending
          ? "Your society admin checks your proof against your flat. You'll be able to borrow and lend as soon as they approve."
          : "Listings and bookings are only visible to approved residents of the same society."}
      </p>
      <Link
        href={pending ? "/home" : "/onboarding"}
        className="mt-4 inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-fg"
      >
        {pending ? "See membership status" : "Join a society"}
      </Link>
    </div>
  );
}
