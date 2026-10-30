"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { ErrorText, Field, PageHeader, Panel, PanelTitle, TrustBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, updateMe } from "@/lib/api";
import { PHONE_RE, VPA_RE } from "@/lib/format";
import { useSession } from "@/lib/session";

export default function ProfilePage() {
  const { user, memberships, setMe } = useSession();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone);
  const [upiVpa, setUpiVpa] = useState(user.upiVpa ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    </div>
  );
}
