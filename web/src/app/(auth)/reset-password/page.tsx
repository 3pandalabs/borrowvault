"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ErrorText, Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, confirmPasswordReset, errorMessage } from "@/lib/api";

function Form() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">This link is missing its token. Reset links expire and only work once.</p>
        <Link href="/forgot-password" className="block">
          <Button className="w-full">Get a new link</Button>
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <p>Password changed. Sign in with the new one.</p>
        </div>
        <Link href="/login" className="block">
          <Button className="w-full">Sign in</Button>
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? "That link has expired or already been used. Ask for a new one."
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" htmlFor="password" hint="At least 10 characters.">
        <Input
          id="password"
          type="password"
          required
          minLength={10}
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input
          id="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" className="w-full" disabled={busy || password.length < 10}>
        {busy ? <Loader2 className="animate-spin" /> : null} Change password
      </Button>
      {error ? (
        <Link href="/forgot-password" className="block text-center text-sm text-fg-muted hover:text-fg">
          Request a new link
        </Link>
      ) : null}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold">Choose a new password</h1>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </>
  );
}
