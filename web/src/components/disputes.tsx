"use client";

import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { useState } from "react";
import { errorMessage, raiseDispute, rateBooking, respondDispute, tryGeo, uploadBookingMedia } from "@/lib/api";
import { formatCountdown, formatINR, formatIST, rupeesToPaise } from "@/lib/format";
import type { BookingDetail, Dispute, DisputeCategory, DisputeStatus, MediaPhase } from "@/lib/types";
import { ErrorText, Field, selectClass } from "./common";
import { MediaGrid } from "./inspections";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";

export const DISPUTE_CATEGORY: Record<DisputeCategory, string> = {
  damage: "Damage",
  missing_part: "Missing part",
  not_returned: "Not returned",
  not_as_described: "Not as described",
  late: "Late",
};

const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: "Open",
  awaiting_response: "Awaiting response",
  under_review: "Under review",
  escalated: "Escalated to 3PandaLabs",
  resolved: "Resolved",
  withdrawn: "Withdrawn",
};

export const EVIDENCE_TYPES = ["image/jpeg", "image/png"];
const EVIDENCE_MAX = 15 * 1024 * 1024;

export function DisputeSummary({ d, partyName }: { d: Dispute; partyName?: (userId: string) => string }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="bad">{DISPUTE_CATEGORY[d.category] ?? d.category}</Badge>
        <Badge variant={d.status === "escalated" ? "warn" : "muted"}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
        {d.deadlineAt && !d.resolvedAt ? <span className="text-fg-muted">Next step due {formatCountdown(d.deadlineAt)}</span> : null}
      </div>
      <p>
        <span className="text-fg-muted">Raised </span>
        {formatIST(d.createdAt)}
        <span className="text-fg-muted"> by </span>
        {d.raisedBySystem || d.raisedBy === "system"
          ? "BorrowVault, automatically, for the borrower"
          : (partyName?.(d.raisedBy) ?? "a party")}
        <span className="text-fg-muted"> · claim </span>
        <span className="font-medium">{formatINR(d.claimedPaise)}</span>
        {d.offerPaise != null ? (
          <>
            <span className="text-fg-muted"> · offer </span>
            <span className="font-medium">{formatINR(d.offerPaise)}</span>
          </>
        ) : null}
      </p>
      <p className="whitespace-pre-line rounded-lg bg-zinc-50 p-3">{d.description}</p>
      <MediaGrid media={d.media ?? []} />
      {d.responseText ? (
        <p className="whitespace-pre-line rounded-lg bg-zinc-50 p-3">
          <span className="block text-xs text-fg-muted">Response</span>
          {d.responseText}
        </p>
      ) : null}
      {d.resolvedAt ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-emerald-900">
          Resolved {formatIST(d.resolvedAt)} · award {formatINR(d.awardPaise ?? 0)}
          {d.rulingNote ? ` · "${d.rulingNote}"` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Picks evidence photos (JPEG/PNG, ≤15 MB, max `max`). */
export function EvidencePicker({ files, setFiles, max = 10 }: { files: File[]; setFiles: (f: File[]) => void; max?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs">
          <span className="truncate">{f.name}</span>
          <button type="button" aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      {files.length < max ? (
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs">
          <ImagePlus className="size-3.5" /> Add photo
          <input
            type="file"
            accept={EVIDENCE_TYPES.join(",")}
            multiple
            className="sr-only"
            onChange={(e) =>
              setFiles(
                [...files, ...Array.from(e.target.files ?? []).filter((f) => EVIDENCE_TYPES.includes(f.type) && f.size <= EVIDENCE_MAX)].slice(0, max),
              )
            }
          />
        </label>
      ) : null}
    </div>
  );
}

/** Uploads evidence files for one phase/slot prefix; returns media ids. */
export async function uploadEvidence(
  bookingId: string,
  phase: MediaPhase,
  slotFor: (i: number) => string,
  files: File[],
  onProgress: (msg: string) => void,
): Promise<string[]> {
  if (!files.length) return [];
  onProgress("Getting location…");
  // Best effort: no fix is stored as "no location", never rejected.
  const geo = await tryGeo();
  const ids: string[] = [];
  for (const [i, f] of files.entries()) {
    onProgress(`Uploading photo ${i + 1} of ${files.length}…`);
    ids.push(await uploadBookingMedia(bookingId, phase, slotFor(i), f, geo));
  }
  return ids;
}

export function RaiseDisputeForm({
  bookingId,
  onDone,
  onCancel,
}: {
  bookingId: string;
  onDone: (b: BookingDetail) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<DisputeCategory>("damage");
  const [description, setDescription] = useState("");
  const [claim, setClaim] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const claimedPaise = claim.trim() ? rupeesToPaise(claim) : 0;
    if (claimedPaise === null) return setError("Enter the claim in rupees.");
    if (description.trim().length < 10) return setError("Describe what happened in at least 10 characters.");
    setError(null);
    try {
      const mediaIds = await uploadEvidence(bookingId, "dispute", (i) => `dispute-${i + 1}`, files, setBusy);
      setBusy("Submitting…");
      onDone(await raiseDispute(bookingId, { category, description: description.trim(), claimedPaise, mediaIds }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What went wrong?" htmlFor="dcat">
        <select id="dcat" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory)}>
          {Object.entries(DISPUTE_CATEGORY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Claim (₹)"
        htmlFor="claim"
        hint="Up to the deposit or the item's replacement value, whichever is higher. A borrower may claim up to the fee plus deposit. 0 to just put it on record."
      >
        <Input id="claim" inputMode="decimal" value={claim} onChange={(e) => setClaim(e.target.value)} />
      </Field>
      <Field label="Describe it" htmlFor="ddesc" hint="10 to 2,000 characters.">
        <Textarea id="ddesc" required rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Extra photos (optional, JPEG or PNG)">
        <EvidencePicker files={files} setFiles={setFiles} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={!!busy || !description.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : null} {busy ?? "Submit dispute"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RespondDisputeForm({
  bookingId,
  claimedPaise,
  onDone,
}: {
  bookingId: string;
  claimedPaise: number;
  onDone: (b: BookingDetail) => void;
}) {
  const [text, setText] = useState("");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const offerPaise = offer.trim() ? rupeesToPaise(offer) : undefined;
    if (offerPaise === null) return setError("Enter the offer in rupees.");
    if (offerPaise !== undefined && offerPaise > claimedPaise) return setError(`An offer can't exceed the claim (${formatINR(claimedPaise)}).`);
    setBusy(true);
    setError(null);
    try {
      onDone(await respondDispute(bookingId, { responseText: text.trim(), ...(offerPaise !== undefined ? { offerPaise } : {}) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Your side" htmlFor="resp">
        <Textarea id="resp" required rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field
        label="Offer to settle (₹, optional)"
        htmlFor="offer"
        hint={`The claim is ${formatINR(claimedPaise)}. You can respond once. If they accept your offer, it's settled without a ruling.`}
      >
        <Input id="offer" inputMode="decimal" value={offer} onChange={(e) => setOffer(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy || !text.trim()}>
        {busy ? <Loader2 className="animate-spin" /> : null} Send response
      </Button>
    </form>
  );
}

export function RatingForm({ bookingId, otherName, onDone }: { bookingId: string; otherName: string; onDone: () => void }) {
  const [stars, setStars] = useState(0);
  const [punctual, setPunctual] = useState(false);
  const [careful, setCareful] = useState(false);
  const [asDescribed, setAsDescribed] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stars) return setError("Pick 1 to 5 stars.");
    setBusy(true);
    setError(null);
    try {
      await rateBooking(bookingId, { stars, punctual, careful, asDescribed, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-fg-muted">How was it with {otherName}?</p>
      <div className="flex gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} stars`} onClick={() => setStars(n)}>
            <Star className={`size-7 ${n <= stars ? "fill-amber-400 text-amber-400" : "text-zinc-300"}`} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {(
          [
            ["Punctual", punctual, setPunctual],
            ["Careful", careful, setCareful],
            ["As described", asDescribed, setAsDescribed],
          ] as const
        ).map(([label, v, set]) => (
          <label key={label} className="flex items-center gap-1.5">
            <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /> {label}
          </label>
        ))}
      </div>
      <Textarea placeholder="Anything to add? (optional)" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null} Submit rating
      </Button>
    </form>
  );
}
