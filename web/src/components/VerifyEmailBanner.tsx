"use client";

import { MailWarning } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, errorMessage, logout, resendVerificationEmail } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Shown on every signed-in page while the account's email is unconfirmed
 * (api/ROUTES.md "Email verification"). Joining a society needs it.
 */
export function VerifyEmailBanner() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "busy" | "sent" } | { kind: "error"; message: string }>({ kind: "idle" });
  const unverified = !user.emailVerified;

  // Verified in another tab (or the app)? Pick it up when this tab comes back.
  useEffect(() => {
    if (!unverified) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [unverified, refresh]);

  if (!unverified) return null;

  async function resend() {
    setState({ kind: "busy" });
    try {
      await resendVerificationEmail();
      setState({ kind: "sent" });
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_verified") {
        refresh();
        return;
      }
      setState({ kind: "error", message: errorMessage(err) });
    }
  }

  async function startOver() {
    await logout().catch(() => undefined);
    router.replace("/signup");
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-950" role="status">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
        <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Verify your email:</span> we sent a link to{" "}
          <span className="break-all font-medium">{user.email}</span>. You need it to join a society.{" "}
          {state.kind === "sent" ? (
            <span>Sent. Check your inbox and spam folder.</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={state.kind === "busy"}
              className="font-medium underline underline-offset-2 disabled:opacity-60"
            >
              {state.kind === "busy" ? "Sending…" : "Resend"}
            </button>
          )}
          {" · "}
          <button type="button" onClick={startOver} className="underline underline-offset-2">
            Wrong address? Sign out and sign up again
          </button>
          {state.kind === "error" ? <span className="block text-red-700">{state.message}</span> : null}
        </p>
      </div>
    </div>
  );
}
