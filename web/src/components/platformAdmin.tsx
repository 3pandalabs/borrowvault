"use client";

import { Check, FileCheck2, Loader2, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import * as api from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import type { AdminRequestStatus, PlatformAdminRequest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DocLink, KIND_LABEL, lengthError, mapsUrl, RequestStatusBadge, SocietyAdminsList } from "./adminRequests";
import { EmptyState, ErrorText, LoadError, Loading, Panel, PanelTitle } from "./common";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";

const STATUS_TABS: AdminRequestStatus[] = ["pending", "nominated", "approved", "rejected", "withdrawn", "declined", "cancelled"];
// docUrls are presigned for 10 minutes; refetch a little before that.
const DOC_URL_TTL_MS = 8 * 60 * 1000;

type Loaded = { at: number; rows: PlatformAdminRequest[] };

export function AdminRequestsQueue() {
  const [status, setStatus] = useState<AdminRequestStatus>("pending");
  const list = useAsync<Loaded>(
    async () => ({ at: Date.now(), rows: await api.listPlatformAdminRequests(status) }),
    `platform-requests|${status}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const current = list.data?.rows.find((r) => r.id === selected) ?? null;

  /** A doc URL that is still valid, refetching the queue if this page has sat open too long. */
  async function freshDocUrl(id: string, doc: keyof PlatformAdminRequest["docUrls"]): Promise<string> {
    const cached = list.data?.rows.find((r) => r.id === id)?.docUrls[doc];
    if (cached && list.data && Date.now() - list.data.at < DOC_URL_TTL_MS) return cached;
    const rows = await api.listPlatformAdminRequests(status);
    list.setData({ at: Date.now(), rows });
    const url = rows.find((r) => r.id === id)?.docUrls[doc];
    if (!url) throw new Error("This request has moved out of this list. Refresh and find it again.");
    return url;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setSelected(null);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-sm capitalize",
                status === s ? "border-accent bg-emerald-50 text-accent" : "border-line bg-white",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.rows.length ? (
          <EmptyState
            icon={<FileCheck2 />}
            title={status === "pending" ? "Nothing waiting for review" : `No ${status} requests`}
            body={status === "pending" ? "New society registrations and admin applications show up here, oldest first." : undefined}
            action={
              <Button size="sm" variant="outline" onClick={list.reload}>
                Refresh
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {list.data.rows.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-50",
                    selected === r.id && "bg-emerald-50",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.societyName}</span>
                    <span className="block truncate text-sm text-fg-muted">
                      {KIND_LABEL[r.kind]} · {r.requester.displayName}
                      {r.nominatedBy ? ` · nominated by ${r.nominatedBy.displayName}` : ""}
                      {r.resultingTier === "pilot" ? " · becomes a pilot" : ""}
                    </span>
                    {r.kind === "nominate_admin" && r.status === "pending" && r.autoApproveAt ? (
                      <span className="block truncate text-xs text-amber-700">
                        {`Auto-approves ${formatIST(r.autoApproveAt)}`}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">{formatIST(r.createdAt, { time: false })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {current ? (
          <RequestReview
            key={current.id}
            r={current}
            docUrl={(doc) => freshDocUrl(current.id, doc)}
            onChanged={() => {
              setSelected(null);
              list.reload();
            }}
          />
        ) : list.data?.rows.length ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-fg-muted">
            Pick a request on the left to check the documents and decide.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RequestReview({
  r,
  docUrl,
  onChanged,
}: {
  r: PlatformAdminRequest;
  docUrl: (doc: keyof PlatformAdminRequest["docUrls"]) => Promise<string>;
  onChanged: () => void;
}) {
  const p = r.proposedSociety;
  const [note, setNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const approve = useAction();
  const reject = useAction();

  const noteErr = lengthError("Note", note, 0, 1000);
  const rejectErr = lengthError("Reason", rejectNote, 5, 1000);
  const busy = approve.busy || reject.busy;

  function doApprove() {
    if (noteErr) return;
    const what =
      r.kind === "new_society"
        ? `Create "${r.societyName}" and make ${r.requester.displayName} its admin?`
        : `Make ${r.requester.displayName} an admin of ${r.societyName}?`;
    if (!window.confirm(what)) return;
    approve
      .run(() => api.approveAdminRequest(r.id, note.trim() ? { note: note.trim() } : {}), api.errorMessage)
      .then((ok) => ok && onChanged());
  }

  function doReject() {
    if (rejectNote.trim().length < 5 || rejectErr) return;
    if (!window.confirm(`Reject this request? ${r.requester.displayName} is emailed your reason.`)) return;
    reject.run(() => api.rejectAdminRequest(r.id, rejectNote.trim()), api.errorMessage).then((ok) => ok && onChanged());
  }

  return (
    <Panel>
      <PanelTitle aside={<RequestStatusBadge status={r.status} />}>{r.societyName}</PanelTitle>
      <p className="-mt-2 mb-4 text-sm text-fg-muted">
        {KIND_LABEL[r.kind]}
        {r.nominatedBy ? ` · Nominated by ${r.nominatedBy.displayName}` : ""}
      </p>
      {r.resultingTier === "pilot" ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          Approving creates a pilot society: up to 50 members, values up to ₹5,000, and disputes ruled by BorrowVault. Mark
          it verified later from the societies list.
        </p>
      ) : null}
      {r.kind === "nominate_admin" ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          {r.status === "pending" && r.autoApproveAt
            ? `Auto-approves on ${formatIST(r.autoApproveAt)} unless you reject it first. You can also approve it now.`
            : r.status === "nominated"
              ? "Waiting for the nominee to accept and upload their ID proof."
              : "A society admin vouched for this person instead of an authorisation letter."}
        </p>
      ) : null}

      <h3 className="mb-1 text-sm font-medium">Requester</h3>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">Name</dt>
        <dd>{r.requester.displayName}</dd>
        <dt className="text-fg-muted">Email</dt>
        <dd className="break-all">{r.requester.email}</dd>
        <dt className="text-fg-muted">Phone</dt>
        <dd>{r.requester.phone}</dd>
        <dt className="text-fg-muted">Role</dt>
        <dd>{r.committeeRole}</dd>
        <dt className="text-fg-muted">Sent</dt>
        <dd>{formatIST(r.createdAt)}</dd>
        {r.reviewedAt ? (
          <>
            <dt className="text-fg-muted">Reviewed</dt>
            <dd>{formatIST(r.reviewedAt)}</dd>
          </>
        ) : null}
      </dl>

      {p ? (
        <>
          <h3 className="mb-1 text-sm font-medium">Proposed society</h3>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">Name</dt>
            <dd>{p.name}</dd>
            <dt className="text-fg-muted">City</dt>
            <dd>{p.city}</dd>
            <dt className="text-fg-muted">Address</dt>
            <dd className="whitespace-pre-line">{p.address}</dd>
            <dt className="text-fg-muted">Location</dt>
            <dd>
              <a href={mapsUrl(p.centerLat, p.centerLng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                <MapPin className="size-3.5" /> Check on Google Maps
              </a>
            </dd>
            <dt className="text-fg-muted">Their flat</dt>
            <dd>
              {p.towerName} · {p.flatNo} ({p.occupancy})
            </dd>
          </dl>
        </>
      ) : r.society ? (
        <>
          <h3 className="mb-1 text-sm font-medium">Society</h3>
          <p className="mb-4 text-sm">
            {`${r.society.name} · ${r.society.city} · ${r.society.tier === "pilot" ? "Pilot" : "Verified"} · ${r.society.memberCount} members`}{" "}
            <Link href={`/admin/${r.society.id}?tab=admins`} className="text-accent hover:underline">
              Current admins
            </Link>
          </p>
        </>
      ) : null}
      {p && r.society ? (
        <p className="-mt-2 mb-4 text-sm">
          Live as{" "}
          <Link href={`/admin/${r.society.id}`} className="text-accent hover:underline">
            {r.society.name}
          </Link>
        </p>
      ) : null}

      {r.statement ? (
        <>
          <h3 className="mb-1 text-sm font-medium">Their note</h3>
          <p className="mb-4 whitespace-pre-line rounded-lg bg-zinc-50 p-3 text-sm">{r.statement}</p>
        </>
      ) : null}

      <h3 className="mb-2 text-sm font-medium">Documents</h3>
      <div className="mb-4 flex flex-wrap gap-2">
        {r.docUrls.idProof ? <DocLink label="ID proof" getUrl={() => docUrl("idProof")} /> : null}
        {r.docUrls.residenceProof ? <DocLink label="Proof of residence" getUrl={() => docUrl("residenceProof")} /> : null}
        {r.docUrls.rwaRegistration ? (
          <DocLink label="RWA certificate (older request)" getUrl={() => docUrl("rwaRegistration")} />
        ) : null}
        {r.docUrls.authorization ? (
          <DocLink label="Authorisation letter (older request)" getUrl={() => docUrl("authorization")} />
        ) : null}
        {!Object.keys(r.docUrls).length ? (
          <p className="text-sm text-fg-muted">No documents yet. The nominee uploads their ID proof when they accept.</p>
        ) : null}
      </div>

      {r.reviewNote ? (
        <p className="mb-4 rounded-lg bg-zinc-50 p-3 text-sm">
          <span className="font-medium">Review note:</span> {r.reviewNote}
        </p>
      ) : null}

      {r.status === "pending" ? (
        <div className="space-y-4 border-t border-line pt-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Approve</h3>
            <Textarea
              placeholder="Note to the requester (optional)"
              maxLength={1000}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <ErrorText>{noteErr}</ErrorText>
            <Button disabled={busy || !!noteErr} onClick={doApprove}>
              {approve.busy ? <Loader2 className="animate-spin" /> : <Check />} Approve
            </Button>
            <ErrorText>{approve.error}</ErrorText>
          </div>
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="text-sm font-medium">Reject</h3>
            <Textarea
              placeholder="Reason, emailed to the requester (at least 5 characters)"
              maxLength={1000}
              rows={2}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
            />
            <ErrorText>{rejectNote.trim() ? rejectErr : null}</ErrorText>
            <Button variant="outline" disabled={busy || rejectNote.trim().length < 5 || !!rejectErr} onClick={doReject}>
              {reject.busy ? <Loader2 className="animate-spin" /> : <X />} Reject
            </Button>
            <ErrorText>{reject.error}</ErrorText>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/** A society's admins with "Remove admin" (platform admins only). */
export function PlatformSocietyAdmins({ societyId }: { societyId: string }) {
  const admins = useAsync(() => api.platformSocietyAdmins(societyId), `platform-admins:${societyId}`);
  const [error, setError] = useState<string | null>(null);
  if (admins.error) return <LoadError error={admins.error} onRetry={admins.reload} />;
  if (!admins.data) return <Loading />;
  return (
    <div>
      <SocietyAdminsList
        admins={admins.data}
        onRevoke={async (a, note) => {
          setError(null);
          try {
            admins.setData(await api.revokeSocietyAdmin(societyId, a.membershipId, note));
            return true;
          } catch (e) {
            setError(api.errorMessage(e));
            return false;
          }
        }}
      />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
