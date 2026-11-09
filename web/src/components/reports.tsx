"use client";

// Society admin console, Reports tab (ROUTES.md "Reports review"): reported
// chat messages, people and listings. Same review pattern as message reports.

import { Ban, CheckCircle2, Flag, ImageOff, Loader2, Trash2, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import * as api from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import type { ListingReport, PartyInfo, ReportFilter, UserReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorText, LoadError, Loading, Panel } from "./common";
import { MessageReports } from "./messageReports";
import { LISTING_REPORT_REASONS, reasonLabel, USER_REPORT_REASONS } from "./safety";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";

export const REPORT_KINDS = ["messages", "users", "listings"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const KIND_LABEL: Record<ReportKind, string> = { messages: "Messages", users: "People", listings: "Listings" };
const NOTE_MAX = 1000;
const REMOVE_NOTE_MIN = 5;

const who = (p: PartyInfo) => (p.towerName || p.flatNo ? `${p.displayName} (${p.towerName ?? ""}-${p.flatNo ?? ""})` : p.displayName);

export function Reports({
  societyId,
  kind,
  openCounts,
  onKind,
  onChanged,
}: {
  societyId: string;
  kind: ReportKind;
  openCounts: Record<ReportKind, number>;
  onKind: (k: ReportKind) => void;
  onChanged: () => void;
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Report type">
        {REPORT_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => onKind(k)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm",
              kind === k ? "border-accent bg-emerald-50 font-medium text-accent" : "border-line bg-white",
            )}
          >
            {KIND_LABEL[k]}
            {openCounts[k] ? (
              <Badge variant="warn" aria-label={`${openCounts[k]} open`}>
                {openCounts[k] >= 100 ? "99+" : openCounts[k]}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>
      {kind === "messages" ? <MessageReports societyId={societyId} onChanged={onChanged} /> : null}
      {kind === "users" ? <UserReports societyId={societyId} onChanged={onChanged} /> : null}
      {kind === "listings" ? <ListingReports societyId={societyId} onChanged={onChanged} /> : null}
    </>
  );
}

function StatusFilter({ value, onChange }: { value: ReportFilter; onChange: (v: ReportFilter) => void }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {(
        [
          ["open", "Open"],
          ["closed", "Closed"],
        ] as const
      ).map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn("rounded-full border px-3 py-1 text-sm", value === v ? "border-accent bg-emerald-50 text-accent" : "border-line bg-white")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function ReasonBox({ reporter, reason, details }: { reporter: PartyInfo; reason: string; details: string | null }) {
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="text-xs font-medium">{`${who(reporter)} reported it: ${reason}`}</p>
      {details ? <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{details}</p> : null}
    </div>
  );
}

function Decided({ label, at, note }: { label: string; at: string | null; note: string | null }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-sm text-fg-muted">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <span>
        {`${label} ${formatIST(at)}`}
        {note ? (
          <>
            : <span className="whitespace-pre-wrap text-fg">{note}</span>
          </>
        ) : null}
      </span>
    </p>
  );
}

// ---------- people ----------

function UserReports({ societyId, onChanged }: { societyId: string; onChanged: () => void }) {
  const [status, setStatus] = useState<ReportFilter>("open");
  const list = useAsync(() => api.adminUserReports(societyId, status), `user-reports:${societyId}|${status}`);
  return (
    <>
      <StatusFilter value={status} onChange={setStatus} />
      <p className="mb-3 text-sm text-fg-muted">
        Residents report people they think break the rules. Your decision is recorded only. To act on someone, talk to
        them, or revoke their membership on the Members tab.
      </p>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<UserX />}
          title={status === "open" ? "No reported people" : "No closed reports yet"}
          body={status === "open" ? "When a resident reports someone, it lands here for you to look at." : undefined}
          action={
            <Link href={`/admin/${societyId}?tab=members`}>
              <Button size="sm" variant="outline">
                See members
              </Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {list.data.map((r) => (
            <li key={r.id}>
              <UserReportCard
                r={r}
                onDone={() => {
                  list.reload();
                  onChanged();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UserReportCard({ r, onDone }: { r: UserReport; onDone: () => void }) {
  const [note, setNote] = useState("");
  const action = useAction();
  const tooLong = note.trim().length > NOTE_MAX;
  const decide = (decision: "reviewed" | "dismissed") =>
    action.run(async () => {
      await api.reviewUserReport(r.id, { decision, note: note.trim() || undefined });
      onDone();
    }, api.errorMessage);
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <UserX className="size-4 text-fg-muted" /> {who(r.reported)}
          <Badge variant={r.status === "open" ? "warn" : "muted"}>
            {r.status === "open" ? "Open" : r.status === "reviewed" ? "Reviewed" : "Dismissed"}
          </Badge>
        </p>
        <span className="text-xs text-fg-muted">{`Reported ${formatIST(r.createdAt)}`}</span>
      </div>
      <ReasonBox reporter={r.reporter} reason={reasonLabel(USER_REPORT_REASONS, r.reason)} details={r.details} />
      {r.status !== "open" ? (
        <Decided label={r.status === "reviewed" ? "Reviewed" : "Dismissed"} at={r.reviewedAt} note={r.reviewNote} />
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor={`unote-${r.id}`} className="text-sm font-medium text-zinc-700">
            Note (optional)
          </label>
          <Textarea
            id={`unote-${r.id}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you decided, e.g. spoke to both residents"
          />
          {tooLong ? <p className="text-xs text-red-600">{`Keep the note to ${NOTE_MAX} characters.`}</p> : null}
          <ErrorText>{action.error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={action.busy || tooLong} onClick={() => decide("reviewed")}>
              {action.busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Mark reviewed
            </Button>
            <Button size="sm" variant="outline" disabled={action.busy || tooLong} onClick={() => decide("dismissed")}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------- listings ----------

function ListingReports({ societyId, onChanged }: { societyId: string; onChanged: () => void }) {
  const [status, setStatus] = useState<ReportFilter>("open");
  const list = useAsync(() => api.adminListingReports(societyId, status), `listing-reports:${societyId}|${status}`);
  return (
    <>
      <StatusFilter value={status} onChange={setStatus} />
      <p className="mb-3 text-sm text-fg-muted">
        Residents report listings that break the rules. Remove a listing to take it down for good: the owner sees your
        note and can&apos;t put it back up. Bookings already under way carry on.
      </p>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Flag />}
          title={status === "open" ? "No reported listings" : "No closed reports yet"}
          body={status === "open" ? "When a resident reports a listing, it lands here for you to look at." : undefined}
          action={
            <Link href="/listings">
              <Button size="sm" variant="outline">
                Browse listings
              </Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {list.data.map((r) => (
            <li key={r.id}>
              <ListingReportCard
                r={r}
                onDone={() => {
                  list.reload();
                  onChanged();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ListingReportCard({ r, onDone }: { r: ListingReport; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"idle" | "remove">("idle");
  const action = useAction();
  const trimmed = note.trim();
  const tooLong = trimmed.length > NOTE_MAX;
  const removed = r.listing.status === "removed";
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-100">
          {r.listing.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned URL
            <img src={r.listing.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageOff className="size-5 text-zinc-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {removed ? (
              <span>{r.listing.title}</span>
            ) : (
              <Link href={`/listings/${r.listing.id}`} className="hover:text-accent">
                {r.listing.title}
              </Link>
            )}
            <Badge variant={r.status === "open" ? "warn" : "muted"}>
              {r.status === "open" ? "Open" : r.status === "actioned" ? "Listing removed" : "Dismissed"}
            </Badge>
            {removed && r.status === "open" ? <Badge variant="bad">Removed</Badge> : null}
          </p>
          <p className="text-sm text-fg-muted">{`Owner: ${who(r.listing.owner)}`}</p>
        </div>
        <span className="text-xs text-fg-muted">{`Reported ${formatIST(r.createdAt)}`}</span>
      </div>
      <ReasonBox reporter={r.reporter} reason={reasonLabel(LISTING_REPORT_REASONS, r.reason)} details={r.details} />
      {r.status !== "open" ? (
        <Decided label={r.status === "actioned" ? "Listing removed" : "Dismissed"} at={r.reviewedAt} note={r.reviewNote} />
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor={`lnote-${r.id}`} className="text-sm font-medium text-zinc-700">
            {mode === "remove" ? "Note to the owner (required)" : "Note (optional)"}
          </label>
          <Textarea
            id={`lnote-${r.id}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "remove" ? "Why it was removed. The owner sees this." : "What you decided"}
          />
          {tooLong ? (
            <p className="text-xs text-red-600">{`Keep the note to ${NOTE_MAX} characters.`}</p>
          ) : mode === "remove" && trimmed.length < REMOVE_NOTE_MIN ? (
            <p className="text-xs text-fg-muted">{`At least ${REMOVE_NOTE_MIN} characters.`}</p>
          ) : null}
          <ErrorText>{action.error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            {mode === "remove" ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={action.busy || tooLong || trimmed.length < REMOVE_NOTE_MIN}
                  onClick={() =>
                    action.run(async () => {
                      await api.removeListing(r.listing.id, trimmed);
                      onDone();
                    }, api.errorMessage)
                  }
                >
                  {action.busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove listing
                </Button>
                <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => setMode("idle")}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="destructive" disabled={action.busy} onClick={() => setMode("remove")}>
                  <Ban /> Remove listing
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.busy || tooLong}
                  onClick={() =>
                    action.run(async () => {
                      await api.dismissListingReport(r.id, trimmed || undefined);
                      onDone();
                    }, api.errorMessage)
                  }
                >
                  {action.busy ? <Loader2 className="animate-spin" /> : null} Dismiss
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
