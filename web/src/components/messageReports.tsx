"use client";

import { CheckCircle2, Flag, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import * as api from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import type { MessageReport, MessageReportStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./chat";
import { EmptyState, ErrorText, LoadError, Loading, Panel } from "./common";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";

const REVIEW_NOTE_MAX = 1000;

/** Society admin console tab: reported chat messages (ROUTES.md "Reported messages"). */
export function MessageReports({ societyId, onChanged }: { societyId: string; onChanged?: () => void }) {
  const [status, setStatus] = useState<MessageReportStatus>("open");
  const list = useAsync(() => api.adminMessageReports(societyId, status), `message-reports:${societyId}|${status}`);

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["open", "Open"],
            ["reviewed", "Reviewed"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={cn("rounded-full border px-3 py-1 text-sm", status === v ? "border-accent bg-emerald-50 text-accent" : "border-line bg-white")}
          >
            {l}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-fg-muted">
        Residents report chat messages they think break the rules. You see the message, a few around it and their reason. Marking a
        report reviewed records your decision only: messages are never hidden or deleted.
      </p>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Flag />}
          title={status === "open" ? "No reported messages" : "No reviewed reports yet"}
          body={status === "open" ? "When a resident reports a chat message, it lands here for you to look at." : undefined}
          action={
            <Link href={`/admin/${societyId}?tab=disputes`}>
              <Button size="sm" variant="outline">
                See disputes
              </Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {list.data.map((r) => (
            <li key={r.id}>
              <ReportCard
                r={r}
                onReviewed={() => {
                  list.reload();
                  onChanged?.();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReportCard({ r, onReviewed }: { r: MessageReport; onReviewed: () => void }) {
  const { owner, borrower } = r.conversation;
  const nameOf = (uid: string) =>
    uid === owner.id
      ? `${owner.displayName} (${owner.towerName}-${owner.flatNo}, lender)`
      : uid === borrower.id
        ? `${borrower.displayName} (${borrower.towerName}-${borrower.flatNo}, borrower)`
        : "Someone";
  // The reported message is always in context, but don't depend on it.
  const context = r.context.some((m) => m.id === r.message.id) ? r.context : [...r.context, r.message];

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <Link href={`/listings/${r.conversation.listing.id}`} className="hover:text-accent">
              {r.conversation.listing.title}
            </Link>
            <Badge variant={r.status === "open" ? "warn" : "muted"}>{r.status === "open" ? "Open" : "Reviewed"}</Badge>
          </p>
          <p className="text-sm text-fg-muted">
            {owner.displayName} ({owner.towerName}-{owner.flatNo}) · {borrower.displayName} ({borrower.towerName}-{borrower.flatNo})
          </p>
        </div>
        <span className="text-xs text-fg-muted">Reported {formatIST(r.createdAt)}</span>
      </div>

      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="text-xs font-medium">{r.reporter.displayName} reported it:</p>
        <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.reason}</p>
      </div>

      <ul className="mt-3 max-h-96 space-y-3 overflow-y-auto rounded-xl bg-zinc-50/60 p-3">
        {context.map((m) => (
          <MessageBubble
            key={m.id}
            m={m}
            // Lender on the left, borrower on the right, so the two voices are easy to tell apart.
            mine={m.senderId === borrower.id}
            name={nameOf(m.senderId)}
            highlight={m.id === r.message.id}
            footer={m.id === r.message.id ? <span className="font-medium text-amber-700">Reported message</span> : null}
          />
        ))}
      </ul>

      {r.status === "reviewed" ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-fg-muted">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <span>
            Reviewed {formatIST(r.reviewedAt)}
            {r.reviewNote ? (
              <>
                : <span className="whitespace-pre-wrap text-fg">{r.reviewNote}</span>
              </>
            ) : null}
          </span>
        </p>
      ) : (
        <ReviewForm id={r.id} onDone={onReviewed} />
      )}
    </Panel>
  );
}

function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const action = useAction();
  const tooLong = note.trim().length > REVIEW_NOTE_MAX;
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (tooLong) return;
        action.run(async () => {
          await api.reviewMessageReport(id, note.trim() || undefined);
          onDone();
        }, api.errorMessage);
      }}
    >
      <label htmlFor={`note-${id}`} className="text-sm font-medium text-zinc-700">
        Note (optional)
      </label>
      <Textarea
        id={`note-${id}`}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What you decided, e.g. spoke to both residents"
      />
      {tooLong ? <p className="text-xs text-red-600">Keep the note to {REVIEW_NOTE_MAX} characters.</p> : null}
      <ErrorText>{action.error}</ErrorText>
      <Button type="submit" size="sm" disabled={action.busy || tooLong}>
        {action.busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Mark reviewed
      </Button>
    </form>
  );
}
