"use client";

import { Clock, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DocPicker, type DocSlot, emptySlot, lengthError, uploadDocs } from "@/components/adminRequests";
import { EmptyState, ErrorText, Field, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ApiError, createAdminRequest, errorMessage, myAdminRequests } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";

type Docs = { idProofKey: DocSlot };

// /admin-requests/new?societyId=<uuid> (the mobile app deep-links here).
export default function NewAdminRequestPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewAdminRequest />
    </Suspense>
  );
}

function NewAdminRequest() {
  const societyId = useSearchParams().get("societyId");
  const { approved } = useSession();
  if (societyId) return <BecomeAdmin key={societyId} societyId={societyId} />;

  // No society chosen: pick one of the caller's approved, non-admin memberships.
  const eligible = approved.filter((m) => m.role !== "society_admin");
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Become a society admin" subtitle="Pick the society you live in." />
      {eligible.length ? (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {eligible.map((m) => (
            <li key={m.id}>
              <Link
                href={`/admin-requests/new?societyId=${m.societyId}`}
                className="block px-4 py-3 text-sm font-medium hover:bg-zinc-50"
              >
                {m.societyName}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No society to apply for"
          body="You can apply to be an admin of a society you're an approved resident of. If yours isn't on BorrowVault yet, register it."
          action={
            <Link href="/societies/register">
              <Button size="sm">Register your society</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}

function BecomeAdmin({ societyId }: { societyId: string }) {
  const { approved, refresh } = useSession();
  const router = useRouter();
  const membership = approved.find((m) => m.societyId === societyId);
  const mine = useAsync(myAdminRequests, membership && membership.role !== "society_admin" ? "admin-requests-mine" : null);

  const [committeeRole, setCommitteeRole] = useState("");
  const [statement, setStatement] = useState("");
  const [docs, setDocs] = useState<Docs>({ idProofKey: emptySlot });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"upload" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!membership) {
    return (
      <EmptyState
        title="Join this society first"
        body="Only approved residents can apply to be a society admin. If your society isn't on BorrowVault yet, you can register it."
        action={
          <>
            <Link href="/onboarding">
              <Button size="sm">Join a society</Button>
            </Link>
            <Link href="/societies/register">
              <Button size="sm" variant="outline">
                Register your society
              </Button>
            </Link>
          </>
        }
      />
    );
  }

  if (membership.role === "society_admin") {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title={`You're already an admin of ${membership.societyName}`}
        action={
          <Link href={`/admin/${societyId}`}>
            <Button size="sm">Open admin console</Button>
          </Link>
        }
      />
    );
  }

  if (mine.loading && !mine.data) return <Loading />;
  const pending = mine.data?.find(
    (r) =>
      r.societyId === societyId &&
      ((r.kind === "join_admin" && r.status === "pending") ||
        (r.kind === "nominate_admin" && (r.status === "pending" || r.status === "nominated"))),
  );
  if (pending) {
    const nominated = pending.kind === "nominate_admin";
    return (
      <div className="mx-auto max-w-lg">
        <Panel className="text-center">
          <Clock className="mx-auto size-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-semibold">
            {nominated ? "You have an open co-admin nomination" : "Your request is under review"}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            {nominated
              ? `An admin of ${membership.societyName} nominated you as co-admin. Answer it on My requests.`
              : `BorrowVault is checking your request for ${membership.societyName}.`}
          </p>
          <Link href="/admin-requests" className="mt-5 inline-block">
            <Button>See my requests</Button>
          </Link>
        </Panel>
      </div>
    );
  }

  const roleErr = lengthError("Role", committeeRole, 2, 60) ?? (tried && !committeeRole.trim() ? "Required." : null);
  const stmtErr = lengthError("Note", statement, 0, 1000);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!committeeRole.trim() || roleErr || stmtErr || !docs.idProofKey.file) {
      setError("Fix the highlighted fields first.");
      return;
    }
    try {
      setBusy("upload");
      const keys = await uploadDocs(docs, (k, key) => setDocs((d) => ({ ...d, [k]: { ...d[k], key } })));
      setBusy("send");
      const s = statement.trim();
      await createAdminRequest({
        kind: "join_admin",
        societyId,
        committeeRole: committeeRole.trim(),
        ...(s ? { statement: s } : {}),
        docs: keys,
      });
      router.push("/admin-requests?submitted=1");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Membership no longer approved (or never was): the session is stale.
        refresh();
        setError("You need an approved membership in this society to apply. Check your membership status on Home.");
      } else if (err instanceof ApiError && err.message === "already_admin") {
        refresh();
        setError(errorMessage(err));
      } else {
        setError(errorMessage(err));
      }
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Become an admin of ${membership.societyName}`}
        subtitle="Admins approve residents, issue invite codes and settle disputes. Every admin uploads their own ID proof, and BorrowVault checks it."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Panel className="space-y-4">
          <p className="text-sm text-fg-muted">
            Applying as resident of {membership.towerName} · {membership.flatNo}.
          </p>
          <Field
            label="Your role in the society"
            htmlFor="role"
            error={roleErr}
            hint="e.g. Resident, Secretary, Treasurer, Committee member."
          >
            <Input id="role" maxLength={60} value={committeeRole} onChange={(e) => setCommitteeRole(e.target.value)} />
          </Field>
          <Field
            label="Anything we should know? (optional)"
            htmlFor="stmt"
            error={stmtErr}
            hint={`${statement.trim().length}/1000`}
          >
            <Textarea id="stmt" maxLength={1000} rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
          </Field>
        </Panel>

        <Panel className="space-y-4">
          <div>
            <h2 className="font-semibold">ID proof</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Only BorrowVault&apos;s verification team can open it. Your society&apos;s current admins don&apos;t see it.
            </p>
          </div>
          <DocPicker
            kind="idProof"
            slot={docs.idProofKey}
            onPick={(s) => setDocs((d) => ({ ...d, idProofKey: s }))}
            showMissing={tried}
          />
        </Panel>

        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!!busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy === "upload" ? "Uploading ID proof…" : busy === "send" ? "Sending…" : "Send for verification"}
          </Button>
          <Link href="/admin-requests" className="text-sm text-fg-muted hover:text-fg hover:underline">
            My requests
          </Link>
        </div>
      </form>
    </div>
  );
}
