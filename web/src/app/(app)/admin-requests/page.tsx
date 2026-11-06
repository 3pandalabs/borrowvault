"use client";

import { CheckCircle2, FileCheck2, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { DocLink, DOC_GUIDE, KIND_LABEL, RequestStatusBadge } from "@/components/adminRequests";
import { EmptyState, ErrorText, LoadError, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { errorMessage, myAdminRequests, storageUrl, withdrawAdminRequest } from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { AdminRequest } from "@/lib/types";

export default function MyAdminRequestsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MyRequests />
    </Suspense>
  );
}

function MyRequests() {
  const submitted = useSearchParams().get("submitted") === "1";
  const { adminOf, approved, refresh } = useSession();
  const list = useAsync(myAdminRequests, "admin-requests-mine");

  // An approval makes the requester an admin: refresh the session once so the
  // header gains the admin-console link without a sign-out.
  const refreshed = useRef(false);
  useEffect(() => {
    if (refreshed.current || !list.data) return;
    const stale = list.data.some((r) => r.status === "approved" && r.societyId && !adminOf.some((m) => m.societyId === r.societyId));
    if (stale) {
      refreshed.current = true;
      refresh();
    }
  }, [list.data, adminOf, refresh]);

  const canJoinAdmin = approved.filter((m) => m.role !== "society_admin");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="My admin requests"
        subtitle="Requests to register a society or to become one of its admins. BorrowVault reviews each one against your documents."
        actions={
          <Link href="/societies/register">
            <Button variant="outline" size="sm">
              <Plus /> Register a society
            </Button>
          </Link>
        }
      />

      {submitted ? (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>
            Sent. BorrowVault&apos;s team checks your documents and emails you when there&apos;s a decision. You can follow
            it here.
          </span>
        </div>
      ) : null}

      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 />}
          title="No requests yet"
          body="Committee members can register their society on BorrowVault, or apply to be an admin of a society they already live in."
          action={
            <>
              <Link href="/societies/register">
                <Button size="sm">Register your society</Button>
              </Link>
              {canJoinAdmin.map((m) => (
                <Link key={m.id} href={`/admin-requests/new?societyId=${m.societyId}`}>
                  <Button size="sm" variant="outline">
                    Become an admin of {m.societyName}
                  </Button>
                </Link>
              ))}
            </>
          }
        />
      ) : (
        <ul className="space-y-3">
          {list.data.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              onChanged={(next) => list.setData(list.data!.map((x) => (x.id === next.id ? next : x)))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestCard({ r, onChanged }: { r: AdminRequest; onChanged: (r: AdminRequest) => void }) {
  const action = useAction();
  const [showDocs, setShowDocs] = useState(false);
  const p = r.proposedSociety;
  const docs: [string, string | null][] = [
    [DOC_GUIDE.rwaRegistration.label, r.docs.rwaRegistrationKey],
    [DOC_GUIDE.authorization.label, r.docs.authorizationKey],
    [DOC_GUIDE.idProof.label, r.docs.idProofKey],
  ];

  return (
    <li>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{KIND_LABEL[r.kind]}</p>
            <p className="mt-0.5 font-semibold">{r.societyName}</p>
            <p className="text-sm text-fg-muted">
              {p ? `${p.city} · ${p.towerName} · ${p.flatNo} · ` : ""}
              {r.committeeRole} · sent {formatIST(r.createdAt, { time: false })}
            </p>
          </div>
          <RequestStatusBadge status={r.status} />
        </div>

        {r.status === "rejected" && r.reviewNote ? (
          <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
            <p className="font-medium">Why it wasn&apos;t approved</p>
            <p className="mt-1 whitespace-pre-line">{r.reviewNote}</p>
            <p className="mt-2 text-xs">
              You can send a new request with updated documents
              {r.kind === "new_society" ? (
                <>
                  {" "}
                  from{" "}
                  <Link href="/societies/register" className="underline">
                    Register your society
                  </Link>
                </>
              ) : r.societyId ? (
                <>
                  {" "}
                  from{" "}
                  <Link href={`/admin-requests/new?societyId=${r.societyId}`} className="underline">
                    Become an admin
                  </Link>
                </>
              ) : null}
              .
            </p>
          </div>
        ) : null}

        {r.status === "approved" ? (
          <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
            <p>
              {r.kind === "new_society"
                ? `${r.societyName} is live on BorrowVault and you're its admin. Add your towers and share invite codes to bring neighbours in.`
                : `You're now an admin of ${r.societyName}.`}
            </p>
            {r.reviewNote ? <p className="mt-1 whitespace-pre-line text-xs">Note from BorrowVault: {r.reviewNote}</p> : null}
            {r.societyId ? (
              <Link href={`/admin/${r.societyId}`} className="mt-2 inline-block">
                <Button size="sm">Open admin console</Button>
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowDocs((s) => !s)}>
            {showDocs ? "Hide documents" : "View my documents"}
          </Button>
          {r.status === "pending" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={action.busy}
              onClick={() => {
                if (window.confirm("Withdraw this request? You can send a new one later."))
                  action.run(async () => onChanged(await withdrawAdminRequest(r.id)), errorMessage);
              }}
            >
              Withdraw
            </Button>
          ) : null}
        </div>
        {showDocs ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {docs
              .filter((d): d is [string, string] => !!d[1])
              .map(([label, key]) => (
                <DocLink key={key} label={label} getUrl={async () => (await storageUrl(key)).url} />
              ))}
          </div>
        ) : null}
        <ErrorText>{action.error}</ErrorText>
      </Panel>
    </li>
  );
}
