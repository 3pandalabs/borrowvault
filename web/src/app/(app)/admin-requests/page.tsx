"use client";

import { CheckCircle2, FileCheck2, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  DocLink,
  DOC_GUIDE,
  DocPicker,
  type DocSlot,
  emptySlot,
  KIND_LABEL,
  lengthError,
  RequestStatusBadge,
  uploadDocs,
} from "@/components/adminRequests";
import { EmptyState, ErrorText, Field, LoadError, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import {
  acceptNomination,
  declineNomination,
  errorMessage,
  myAdminRequests,
  storageUrl,
  withdrawAdminRequest,
} from "@/lib/api";
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
        subtitle="Your requests to register a society or become an admin, and co-admin nominations for you. Every admin uploads their own ID proof."
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
          body="Any resident can register their society on BorrowVault, or apply to be an admin of a society they already live in."
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

/** Nominee's answer to a co-admin nomination: upload ID proof (required) + optional note, or decline. */
function NominationAnswer({ r, onChanged }: { r: AdminRequest; onChanged: (r: AdminRequest) => void }) {
  const action = useAction();
  const [slot, setSlot] = useState<DocSlot>(emptySlot);
  const [statement, setStatement] = useState("");
  const [tried, setTried] = useState(false);
  const stmtErr = lengthError("Note", statement, 0, 1000);

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
      <p>
        {`${r.nominatedBy?.displayName ?? "An admin"} nominated you as a co-admin of ${r.societyName}. Admins approve residents, issue invite codes and settle disputes.`}
      </p>
      <p className="text-xs text-fg-muted">
        To accept, upload your ID proof. BorrowVault approves you automatically 48 hours later, unless its team rejects it first.
      </p>
      <DocPicker kind="idProof" slot={slot} onPick={setSlot} showMissing={tried} />
      <Field label="Anything we should know? (optional)" htmlFor={`stmt-${r.id}`} error={stmtErr} hint={`${statement.trim().length}/1000`}>
        <Textarea id={`stmt-${r.id}`} maxLength={1000} rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={action.busy}
          onClick={() => {
            setTried(true);
            if (!slot.file || stmtErr) return;
            action.run(async () => {
              const keys = await uploadDocs({ idProofKey: slot }, (_k, key) => setSlot((s) => ({ ...s, key })));
              const s = statement.trim();
              onChanged(await acceptNomination(r.id, { idProofKey: keys.idProofKey, ...(s ? { statement: s } : {}) }));
            }, errorMessage);
          }}
        >
          {action.busy ? <Loader2 className="animate-spin" /> : null} Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={action.busy}
          onClick={() => {
            if (window.confirm("Decline this nomination?")) action.run(async () => onChanged(await declineNomination(r.id)), errorMessage);
          }}
        >
          Decline
        </Button>
      </div>
      <ErrorText>{action.error}</ErrorText>
    </div>
  );
}

function RequestCard({ r, onChanged }: { r: AdminRequest; onChanged: (r: AdminRequest) => void }) {
  const action = useAction();
  const [showDocs, setShowDocs] = useState(false);
  const p = r.proposedSociety;
  const docs: [string, string | null][] = [
    [DOC_GUIDE.idProof.label, r.docs.idProofKey],
    [DOC_GUIDE.residenceProof.label, r.docs.residenceProofKey],
    ["RWA registration certificate", r.docs.rwaRegistrationKey],
    ["Authorisation letter", r.docs.authorizationKey],
  ];
  const hasDocs = docs.some((d) => !!d[1]);

  return (
    <li>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{KIND_LABEL[r.kind]}</p>
            <p className="mt-0.5 font-semibold">{r.societyName}</p>
            <p className="text-sm text-fg-muted">
              {p ? `${p.city} · ${p.towerName} · ${p.flatNo} · ` : ""}
              {r.nominatedBy ? `Nominated by ${r.nominatedBy.displayName} · ` : ""}
              {r.committeeRole} · sent {formatIST(r.createdAt, { time: false })}
            </p>
          </div>
          <RequestStatusBadge status={r.status} />
        </div>

        {r.kind === "nominate_admin" && r.status === "nominated" ? <NominationAnswer r={r} onChanged={onChanged} /> : null}

        {r.kind === "nominate_admin" && r.status === "pending" && r.autoApproveAt ? (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            {`You accepted. You become an admin on ${formatIST(r.autoApproveAt)}, unless BorrowVault rejects it before then.`}
          </p>
        ) : null}

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
                ? `${r.societyName} is live on BorrowVault as a pilot society, and you're its admin. Add your towers and share invite codes to bring neighbours in.`
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
          {hasDocs ? (
            <Button size="sm" variant="ghost" onClick={() => setShowDocs((s) => !s)}>
              {showDocs ? "Hide documents" : "View my documents"}
            </Button>
          ) : null}
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
