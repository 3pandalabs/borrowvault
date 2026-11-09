"use client";

// Blocking and reporting (ROUTES.md "Users: blocking and reporting", listing
// reports). Shared by the chat screen and the listing page.

import { Ban, Flag, Loader2, ShieldOff, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import * as api from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { ListingReportReason, UserReportReason } from "@/lib/types";
import { ErrorText, Panel, selectClass } from "./common";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";

const DETAILS_MAX = 1000;

export const USER_REPORT_REASONS: [UserReportReason, string][] = [
  ["harassment", "Harassment or threats"],
  ["spam", "Spam"],
  ["scam", "Scam or fraud"],
  ["inappropriate", "Inappropriate behaviour"],
  ["other", "Something else"],
];

export const LISTING_REPORT_REASONS: [ListingReportReason, string][] = [
  ["prohibited_item", "Prohibited item or service"],
  ["misleading", "Misleading"],
  ["offensive", "Offensive"],
  ["scam", "Scam or fraud"],
  ["other", "Something else"],
];

export const reasonLabel = (list: [string, string][], key: string) => list.find(([k]) => k === key)?.[1] ?? key;

function Modal({
  title,
  icon,
  onClose,
  busy,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <Panel role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold [&_svg]:size-4">
            {icon} {title}
          </h2>
          <button aria-label="Close" className="rounded-full p-1 text-fg-muted hover:bg-zinc-100" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {children}
      </Panel>
    </div>
  );
}

function ReasonReportDialog<R extends string>({
  title,
  intro,
  reasons,
  footnote,
  submit,
  onClose,
  onDone,
}: {
  title: string;
  intro: React.ReactNode;
  reasons: [R, string][];
  footnote: string;
  submit: (b: { reason: R; details?: string }) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState<R | "">("");
  const [details, setDetails] = useState("");
  const action = useAction();
  const tooLong = details.trim().length > DETAILS_MAX;
  return (
    <Modal title={title} icon={<Flag />} onClose={onClose} busy={action.busy}>
      <p className="mb-3 text-sm text-fg-muted">{intro}</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason || tooLong) return;
          action.run(async () => {
            try {
              await submit({ reason, details: details.trim() || undefined });
            } catch (err) {
              // Your earlier report is still open: same end state.
              if (!(err instanceof api.ApiError && err.message === "already_reported")) throw err;
            }
            onDone();
          }, api.errorMessage);
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium text-zinc-700">
            Reason
          </label>
          <select
            id={`${id}-reason`}
            className={selectClass}
            value={reason}
            onChange={(e) => setReason(e.target.value as R)}
            required
          >
            <option value="" disabled>
              Pick a reason
            </option>
            {reasons.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-details`} className="text-sm font-medium text-zinc-700">
            Details (optional)
          </label>
          <Textarea id={`${id}-details`} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
          <p className={tooLong ? "text-xs text-red-600" : "text-xs text-fg-muted"}>
            {tooLong ? `Keep it to ${DETAILS_MAX} characters.` : footnote}
          </p>
        </div>
        <ErrorText>{action.error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={!reason || tooLong || action.busy}>
            {action.busy ? <Loader2 className="animate-spin" /> : <Flag />} Send report
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReportUserDialog({
  userId,
  name,
  onClose,
  onDone,
}: {
  userId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <ReasonReportDialog
      title={`Report ${name}`}
      intro="Your society admins and the BorrowVault team will look at it. They won't tell this person who reported them."
      reasons={USER_REPORT_REASONS}
      footnote="Say what happened. Don't include passwords or bank details."
      submit={(b) => api.reportUser(userId, b)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

export function ReportListingDialog({
  listingId,
  title,
  onClose,
  onDone,
}: {
  listingId: string;
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <ReasonReportDialog
      title="Report this listing"
      intro={`Tell your society admins what's wrong with "${title}". They can take it down.`}
      reasons={LISTING_REPORT_REASONS}
      footnote="Say what's wrong with it."
      submit={(b) => api.reportListing(listingId, b)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Block (with a confirm step) or unblock. `blocked` = the caller has blocked them. */
export function BlockButton({
  userId,
  name,
  blocked,
  onChanged,
  size = "sm",
}: {
  userId: string;
  name: string;
  blocked: boolean;
  onChanged: (blocked: boolean) => void;
  size?: "sm" | "default";
}) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  if (blocked) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <Button
          size={size}
          variant="outline"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api.unblockUser(userId);
              onChanged(false);
            }, api.errorMessage)
          }
        >
          {action.busy ? <Loader2 className="animate-spin" /> : <ShieldOff />} Unblock
        </Button>
        <ErrorText>{action.error}</ErrorText>
      </span>
    );
  }
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setConfirming(true)}>
        <Ban /> Block
      </Button>
      {confirming ? (
        <Modal title={`Block ${name}?`} icon={<Ban />} onClose={() => setConfirming(false)} busy={action.busy}>
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>Neither of you can message the other.</li>
            <li>Neither of you can start a new booking with the other.</li>
            <li>You won&apos;t see each other&apos;s listings.</li>
            <li>Bookings you already have carry on as normal, because money and items are involved.</li>
            <li>They aren&apos;t told. You can unblock them any time from your profile.</li>
          </ul>
          <ErrorText>{action.error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={action.busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api.blockUser(userId);
                  setConfirming(false);
                  onChanged(true);
                }, api.errorMessage)
              }
            >
              {action.busy ? <Loader2 className="animate-spin" /> : <Ban />} Block
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
