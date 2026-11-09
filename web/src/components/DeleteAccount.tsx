"use client";

// The interactive half of /delete-account (ROUTES.md "Account deletion").
// Signed out: a sign-in link that comes back here. Signed in: the blockers from
// GET /me/deletion, then a password confirm that calls POST /me/delete.

import { CheckCircle2, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import * as api from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useMeLoader, useSignedIn } from "@/lib/session";
import type { DeletionBlocker, DeletionBlockerKind } from "@/lib/types";
import { ErrorText, Loading, StateBadge } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const BLOCKER_COPY: Record<DeletionBlockerKind, string> = {
  live_booking: "Booking still in progress. Finish it, or cancel or decline it if you still can.",
  open_dispute: "Open dispute. Wait for it to be settled or ruled on.",
  unpaid_award: "Dispute award not settled yet. Pay it, or confirm you received it.",
  refund_owed: "Refund still owed. Send it, or confirm you received it.",
};

export function DeleteAccountPanel() {
  const signedIn = useSignedIn();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="size-5" /> Your account is deleted
        </p>
        <p className="mt-2 text-sm">
          You have been signed out on this device, and every other sign-in has ended. If you use the app, sign out there
          too. You can sign up again with the same email address at any time.
        </p>
        <Link href="/" className="mt-3 inline-block">
          <Button size="sm" variant="outline">
            Go to the home page
          </Button>
        </Link>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="rounded-2xl border border-line bg-bg-subtle p-5">
        <p className="font-semibold text-fg">Sign in to delete your account</p>
        <p className="mt-1 text-sm text-fg-muted">
          We need to know it is really you. Sign in, and you will come straight back to this page.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/login?next=${encodeURIComponent("/delete-account")}`}>
            <Button size="sm">Sign in</Button>
          </Link>
          <Link href="/forgot-password">
            <Button size="sm" variant="ghost">
              Forgot your password?
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return <SignedIn onDeleted={() => setDone(true)} />;
}

function SignedIn({ onDeleted }: { onDeleted: () => void }) {
  const me = useMeLoader(true);
  const check = useAsync(api.getDeletionCheck, "deletion-check");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DeletionBlocker[] | null>(null);

  if (check.error || me.error) {
    const e = check.error ?? me.error;
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        <p>{api.errorMessage(e)}</p>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              check.reload();
              me.reload();
            }}
          >
            Try again
          </Button>
          {e instanceof api.ApiError && e.status === 401 ? (
            <Link href={`/login?next=${encodeURIComponent("/delete-account")}`}>
              <Button size="sm">Sign in</Button>
            </Link>
          ) : null}
        </div>
      </div>
    );
  }
  if (!check.data || !me.data) return <Loading />;

  const open = blockers ?? check.data.blockers;
  const canDelete = open.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      // The server already ended every session, so don't call /auth/logout.
      api.clearTokens();
      onDeleted();
    } catch (err) {
      const b = api.deletionBlockers(err);
      if (b) setBlockers(b);
      setError(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Signed in as <span className="font-medium text-fg">{me.data.user.email}</span>.
      </p>
      {!canDelete ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Finish these first</p>
          <p className="mt-1">
            Other residents are counting on these. Once they are done, come back here to delete your account.
          </p>
          <ul className="mt-3 space-y-2">
            {open.map((b) => (
              <li key={`${b.kind}:${b.bookingId}`} className="rounded-xl bg-white/70 p-3">
                <Link href={`/bookings/${b.bookingId}`} className="flex flex-wrap items-center gap-2 font-medium hover:underline">
                  {b.listingTitle || `Booking BV-${b.bookingId.slice(0, 8)}`} <StateBadge state={b.state} />
                </Link>
                <p className="mt-1 text-amber-900/90">{BLOCKER_COPY[b.kind] ?? "Still open."}</p>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => {
              setBlockers(null);
              setError(null);
              check.reload();
            }}
          >
            Check again
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
          <p className="font-semibold text-rose-900">Delete your account for good</p>
          <p className="text-sm text-rose-900">This can&apos;t be undone. Type your password to confirm.</p>
          <div className="space-y-1.5">
            <label htmlFor="delete-password" className="text-sm font-medium text-zinc-700">
              Password
            </label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="destructive" disabled={busy || !password}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete my account
          </Button>
        </form>
      )}
      {!canDelete && error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
