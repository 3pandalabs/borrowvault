"use client";

import { Ban, CheckCircle2, ChevronRight, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NominationBanners } from "@/components/adminRequests";
import { refreshNominations, useAwaitingNominations } from "@/lib/nominations";
import { ErrorText, Field, PageHeader, Panel, PanelTitle, TrustBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, myBlocks, unblockUser, updateMe } from "@/lib/api";
import { useAction, useAsync } from "@/lib/hooks";
import { PHONE_RE, VPA_RE } from "@/lib/format";
import { useSession } from "@/lib/session";

export default function ProfilePage() {
  const { user, memberships, approved, setMe } = useSession();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone);
  const [upiVpa, setUpiVpa] = useState(user.upiVpa ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nominations = useAwaitingNominations();
  // Fresh on every visit to Profile, not just on the header's 2-minute poll.
  useEffect(() => {
    void refreshNominations();
  }, []);

  const vpa = upiVpa.trim();
  const vpaError = vpa && !VPA_RE.test(vpa) ? "That doesn't look like a UPI ID. It's in the form name@bank, e.g. priya.s@okhdfcbank." : null;
  const cleanPhone = phone.replace(/[\s-]/g, "");
  const phoneError = cleanPhone && !PHONE_RE.test(cleanPhone) ? "Enter a 10-digit Indian mobile number." : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (vpaError || phoneError) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { user: next } = await updateMe({
        displayName: displayName.trim(),
        phone: cleanPhone,
        ...(vpa ? { upiVpa: vpa } : {}),
      });
      setMe({ user: next, memberships });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Your profile" subtitle={user.email} />
      <NominationBanners nominations={nominations} />
      <Panel className="mb-4">
        <PanelTitle>Trust</PanelTitle>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <TrustBadge trust={user.trust} />
          <span className="text-fg-muted">
            {user.trust.completed} completed {user.trust.completed === 1 ? "booking" : "bookings"} ·{" "}
            {user.trust.disputesLost} disputes lost
          </span>
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          Built from your neighbours&apos; ratings after each booking. On-time, careful handovers raise it.
        </p>
      </Panel>

      <Panel>
        <form onSubmit={save} className="space-y-4">
          <Field label="Display name" htmlFor="name">
            <Input id="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Mobile number" htmlFor="phone" error={phoneError}>
            <Input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field
            label="UPI ID (VPA)"
            htmlFor="vpa"
            error={vpaError}
            hint="Borrowers pay rental fees straight to this UPI ID. BorrowVault never holds your money. Required before you can lend."
          >
            <Input
              id="vpa"
              placeholder="yourname@okicici"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={upiVpa}
              onChange={(e) => setUpiVpa(e.target.value)}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !!vpaError || !!phoneError}>
              {busy ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
            {saved ? (
              <span className="flex items-center gap-1 text-sm text-accent">
                <CheckCircle2 className="size-4" /> Saved
              </span>
            ) : null}
          </div>
        </form>
      </Panel>

      <Panel className="mt-4">
        <PanelTitle
          aside={
            <Link href="/admin-requests" className="text-sm text-accent hover:underline">
              My requests
            </Link>
          }
        >
          Society admin
        </PanelTitle>
        <p className="mb-3 text-sm text-fg-muted">
          Register your society, or apply to be one of its admins. Every admin uploads their own ID proof, and BorrowVault
          checks it. Admins can also nominate you as a co-admin.
        </p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          <li>
            <Link href="/societies/register" className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-zinc-50">
              Register a new society <ChevronRight className="size-4 text-fg-muted" />
            </Link>
          </li>
          {approved.map((m) =>
            m.role === "society_admin" ? (
              <li key={m.id}>
                <Link href={`/admin/${m.societyId}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-zinc-50">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="size-4 text-accent" /> Admin of {m.societyName}
                  </span>
                  <ChevronRight className="size-4 text-fg-muted" />
                </Link>
              </li>
            ) : (
              <li key={m.id}>
                <Link
                  href={`/admin-requests/new?societyId=${m.societyId}`}
                  className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  Become an admin of {m.societyName} <ChevronRight className="size-4 text-fg-muted" />
                </Link>
              </li>
            ),
          )}
          <li>
            <Link href="/admin-requests" className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-zinc-50">
              <span className="flex items-center gap-2">
                My admin requests
                {nominations.length ? (
                  <span
                    className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg"
                    aria-label={`${nominations.length} nomination${nominations.length > 1 ? "s" : ""} waiting for you`}
                  >
                    {nominations.length}
                  </span>
                ) : null}
              </span>
              <ChevronRight className="size-4 text-fg-muted" />
            </Link>
          </li>
        </ul>
      </Panel>

      <BlockedUsers />

      <Panel className="mt-4">
        <PanelTitle>Delete account</PanelTitle>
        <p className="mb-3 text-sm text-fg-muted">
          Removes your name, contact details, listings and documents. Records shared with neighbours, like past bookings
          and chats, stay but show you as “Deleted user”.
        </p>
        <Link href="/delete-account">
          <Button variant="outline" size="sm">
            <Trash2 /> Delete my account
          </Button>
        </Link>
      </Panel>
    </div>
  );
}

function BlockedUsers() {
  const list = useAsync(myBlocks, "my-blocks");
  const action = useAction();
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <Panel className="mt-4">
      <PanelTitle>Blocked users</PanelTitle>
      <p className="mb-3 text-sm text-fg-muted">
        You and the people you block can&apos;t message each other or start new bookings, and you don&apos;t see each
        other&apos;s listings. Bookings you already have carry on.
      </p>
      {list.error ? (
        <ErrorText>{errorMessage(list.error)}</ErrorText>
      ) : !list.data ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : list.data.length === 0 ? (
        <p className="text-sm text-fg-muted">You haven&apos;t blocked anyone.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {list.data.map((b) => (
            <li key={b.user.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="flex items-center gap-2">
                <Ban className="size-4 text-fg-muted" /> {b.user.displayName}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={action.busy}
                onClick={() => {
                  setBusyId(b.user.id);
                  void action
                    .run(async () => {
                      await unblockUser(b.user.id);
                      list.setData(list.data!.filter((x) => x.user.id !== b.user.id));
                    }, errorMessage)
                    .finally(() => setBusyId(null));
                }}
              >
                {busyId === b.user.id ? <Loader2 className="animate-spin" /> : null} Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{action.error}</ErrorText>
    </Panel>
  );
}
