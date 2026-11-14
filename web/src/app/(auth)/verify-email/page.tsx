"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ErrorText } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage, verifyEmail } from "@/lib/api";
import { useSignedIn } from "@/lib/session";

// Public: the link in the signup email lands here (api/ROUTES.md "Email
// verification"). Works signed in or out, in a different browser too.

type State = { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

function Verify({ token }: { token: string }) {
  const signedIn = useSignedIn();
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // Once per page load (StrictMode runs effects twice; the API is idempotent anyway).
    if (started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(() => setState({ kind: "done" }))
      .catch((err) =>
        setState({
          kind: "error",
          message:
            err instanceof ApiError && err.status === 400
              ? "That link has expired or isn't valid any more. Sign in and use Resend in the banner to get a new one."
              : errorMessage(err),
        }),
      );
  }, [token]);

  if (state.kind === "working") {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" /> Confirming your email…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <ErrorText>{state.message}</ErrorText>
        <Link href={signedIn ? "/home" : "/login"} className="block">
          <Button className="w-full">{signedIn ? "Go to BorrowVault" : "Sign in"}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
        <p>Email confirmed. You can now join your society. If you started in the app, go back to it.</p>
      </div>
      <Link href={signedIn ? "/home" : "/login"} className="block">
        <Button className="w-full">{signedIn ? "Continue" : "Sign in"}</Button>
      </Link>
    </div>
  );
}

function FromQuery() {
  const token = useSearchParams().get("token") ?? "";
  if (!token) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">This link is missing its token. Open the link from the email again, or sign in and resend it.</p>
        <Link href="/login" className="block">
          <Button className="w-full">Sign in</Button>
        </Link>
      </div>
    );
  }
  return <Verify token={token} />;
}

export default function VerifyEmailPage() {
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold">Confirm your email</h1>
      <Suspense fallback={null}>
        <FromQuery />
      </Suspense>
    </>
  );
}
