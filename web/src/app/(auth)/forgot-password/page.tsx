"use client";

import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ErrorText, Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, requestPasswordReset } from "@/lib/api";

function Form() {
  const prefill = useSearchParams().get("email") ?? "";
  const [email, setEmail] = useState(prefill);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Same answer whether or not the address exists: no account probing.
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <MailCheck className="mt-0.5 size-5 shrink-0" />
          <p>
            If <span className="font-medium">{email}</span> has an account, a reset link is on its way.
          </p>
        </div>
        <Link href="/login" className="block">
          <Button variant="outline" className="w-full">
            Back to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
        {busy ? <Loader2 className="animate-spin" /> : null} Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-fg-muted hover:text-fg">
        Back to sign in
      </Link>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 text-sm text-fg-muted">We&apos;ll email you a link to choose a new one.</p>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </>
  );
}
