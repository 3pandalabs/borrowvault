"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText, Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, errorMessage, setTokens, signup } from "@/lib/api";
import { PHONE_RE } from "@/lib/format";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const phone = form.phone.replace(/[\s-]/g, "");
    if (!PHONE_RE.test(phone)) {
      setError("Enter a 10-digit Indian mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await signup({ ...form, phone });
      setTokens(res.accessToken, res.refreshToken);
      router.push("/onboarding");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Couldn't create that account. Try signing in instead."
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-fg-muted">Next you&apos;ll pick your society and flat.</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Your name" htmlFor="name" hint="Neighbours see this on your listings and bookings.">
          <Input id="name" required autoComplete="name" value={form.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" hint="10-digit Indian mobile.">
          <Input id="phone" type="tel" required autoComplete="tel" inputMode="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null} Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
