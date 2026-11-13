"use client";

import { ChevronRight, ExternalLink, FileUp, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { errorMessage, uploadFile } from "@/lib/api";
import { formatIST } from "@/lib/format";
import type { AdminRequest, AdminRequestKind, AdminRequestStatus, SocietyAdmin } from "@/lib/types";
import { Field } from "./common";
import { Badge, type BadgeVariant } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// Shared pieces of the "verified admin requests" flow (api/ROUTES.md, "Admin
// requests"): document pickers for the request forms, status chips, and the
// society-admins list used by the society console and the platform page.

export const ADMIN_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const ADMIN_DOC_MAX = 10 * 1024 * 1024;

export type DocKind = "idProof" | "residenceProof";

export const DOC_GUIDE: Record<DocKind, { label: string; hint: string }> = {
  idProof: {
    label: "Your ID proof",
    hint: "A masked Aadhaar (only the last 4 digits visible), PAN card, passport or driving licence. Please don't upload a full Aadhaar number.",
  },
  residenceProof: {
    label: "Proof that you live in the society",
    hint: "A maintenance bill, rent agreement, allotment letter or electricity bill that shows your flat.",
  },
};

/** The pilot rules (api/ROUTES.md "Pilot societies"), as short sentences. */
export const PILOT_LIMITS = [
  "Up to 50 members, admins included.",
  "Deposits and replacement values up to ₹5,000 per listing.",
  "The BorrowVault team rules disputes, not the society admins.",
] as const;

export const PILOT_VALUE_CAP_PAISE = 500_000;

/** Small "Pilot society" chip. */
export function PilotBadge() {
  return <Badge variant="muted">Pilot society</Badge>;
}

/** Pilot explanation for admins (society console, register page). */
export function PilotLimits({ intro }: { intro?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950">
      <p className="font-medium">{intro ?? "This is a pilot society. Until BorrowVault verifies it:"}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {PILOT_LIMITS.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-1">The BorrowVault team lifts these limits when it marks the society verified.</p>
    </div>
  );
}

/** One document slot: the picked file and, once uploaded, its key (reused on retry). */
export type DocSlot = { file: File | null; key: string | null; error: string | null };
export const emptySlot: DocSlot = { file: null, key: null, error: null };

export function pickDoc(f: File | null): DocSlot {
  if (!f) return emptySlot;
  if (!ADMIN_DOC_TYPES.includes(f.type)) return { file: null, key: null, error: "Use a PDF, JPEG or PNG." };
  if (f.size > ADMIN_DOC_MAX) return { file: null, key: null, error: "That file is over 10 MB." };
  if (f.size === 0) return { file: null, key: null, error: "That file is empty." };
  return { file: f, key: null, error: null };
}

/**
 * Uploads every slot that hasn't been uploaded yet (presign `admin_doc` → PUT)
 * and reports each key back, so a retry after a failed submit doesn't upload
 * the same file twice.
 */
export async function uploadDocs<K extends string>(
  slots: Record<K, DocSlot>,
  onUploaded: (k: K, key: string) => void,
): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(slots) as K[]) {
    const s = slots[k];
    if (s.key) {
      out[k] = s.key;
      continue;
    }
    if (!s.file) throw new Error("Add all the documents before sending.");
    const key = await uploadFile("admin_doc", s.file);
    onUploaded(k, key);
    out[k] = key;
  }
  return out;
}

export function DocPicker({
  kind,
  slot,
  onPick,
  showMissing,
}: {
  kind: DocKind;
  slot: DocSlot;
  onPick: (s: DocSlot) => void;
  showMissing?: boolean;
}) {
  const { label, hint } = DOC_GUIDE[kind];
  const error = slot.error ?? (showMissing && !slot.file ? "Required." : null);
  return (
    <Field label={label} hint={`${hint} PDF, JPEG or PNG, up to 10 MB.`} error={error}>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-sm hover:bg-zinc-100">
        <FileUp className="size-5 shrink-0 text-fg-muted" />
        <span className="truncate">{slot.file ? slot.file.name : "Choose a file"}</span>
        {slot.key ? <Badge variant="good">Uploaded</Badge> : null}
        <input
          type="file"
          accept={ADMIN_DOC_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => onPick(pickDoc(e.target.files?.[0] ?? null))}
        />
      </label>
    </Field>
  );
}

/** null when fine (or still empty), else a message. Lengths are counted on the trimmed value, as the API trims. */
export function lengthError(label: string, value: string, min: number, max: number): string | null {
  const n = value.trim().length;
  if (n === 0 && min > 0) return null; // "required" is shown on submit
  if (n < min) return `${label}: at least ${min} characters.`;
  if (n > max) return `${label}: at most ${max} characters.`;
  return null;
}

export const KIND_LABEL: Record<AdminRequestKind, string> = {
  new_society: "Register a society",
  join_admin: "Become an admin",
  nominate_admin: "Co-admin nomination",
};

const STATUS: Record<AdminRequestStatus, [string, BadgeVariant]> = {
  nominated: ["Waiting for nominee", "warn"],
  pending: ["Under review", "warn"],
  approved: ["Approved", "good"],
  rejected: ["Not approved", "bad"],
  withdrawn: ["Withdrawn", "muted"],
  declined: ["Declined", "muted"],
  cancelled: ["Cancelled", "muted"],
};

export function RequestStatusBadge({ status }: { status: AdminRequestStatus }) {
  const [label, variant] = STATUS[status] ?? [status, "muted"];
  return <Badge variant={variant}>{label}</Badge>;
}

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

/**
 * Opens a URL that has to be fetched first (presigned, 10 min) in a new tab.
 * The tab is opened synchronously in the click so popup blockers allow it.
 */
export async function openFetched(getUrl: () => Promise<string>): Promise<string | null> {
  const w = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (w) {
      w.opener = null;
      w.location.href = url;
    } else {
      window.location.href = url;
    }
    return null;
  } catch (e) {
    w?.close();
    return errorMessage(e);
  }
}

export function DocLink({ label, getUrl }: { label: string; getUrl: () => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(await openFetched(getUrl));
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ExternalLink />} {label}
      </Button>
      {error ? <span className="mt-1 text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

/** The society's admins, oldest first. `onRevoke` (platform admins only) adds "Remove admin". */
export function SocietyAdminsList({
  admins,
  onRevoke,
}: {
  admins: SocietyAdmin[];
  onRevoke?: (a: SocietyAdmin, note: string) => Promise<boolean>;
}) {
  if (!admins.length) {
    return <p className="text-sm text-amber-700">No admins. Disputes in this society escalate to BorrowVault after 72 hours.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {admins.map((a) => (
        <AdminRow key={a.membershipId} a={a} onRevoke={onRevoke} />
      ))}
    </ul>
  );
}

function AdminRow({ a, onRevoke }: { a: SocietyAdmin; onRevoke?: (a: SocietyAdmin, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const noteErr = note.trim() && lengthError("Reason", note, 5, 1000);
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="size-4 text-accent" /> {a.user.displayName}
          </p>
          <p className="text-fg-muted">
            {a.towerName && a.flatNo ? `${a.towerName} · ${a.flatNo}` : "No flat on record"} · admin since{" "}
            {formatIST(a.since, { time: false })}
          </p>
          <p className="break-all text-xs text-fg-muted">
            {a.user.email} · {a.user.phone}
          </p>
        </div>
        {onRevoke && !open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Remove admin
          </Button>
        ) : null}
      </div>
      {onRevoke && open ? (
        <form
          className="mt-2 space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (note.trim().length < 5 || noteErr) return;
            setBusy(true);
            const ok = await onRevoke(a, note.trim());
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          <p className="text-xs text-rose-900">
            {a.user.displayName} stays an approved resident but loses admin rights. The reason is emailed to them.
          </p>
          <Input
            placeholder="Reason (at least 5 characters)"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {noteErr ? <p className="text-xs text-red-600">{noteErr}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={busy || note.trim().length < 5 || !!noteErr}>
              {busy ? <Loader2 className="animate-spin" /> : null} Remove admin
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** "<Nominator> nominated you as a co-admin of <Society>": the nominee's headline. */
export function nominationHeadline(r: AdminRequest): string {
  return `${r.nominatedBy?.displayName || "An admin of your society"} nominated you as a co-admin of ${r.societyName}`;
}

/**
 * Green banner per co-admin nomination waiting for the signed-in user (Profile).
 * Renders nothing when there are none.
 */
export function NominationBanners({ nominations }: { nominations: AdminRequest[] }) {
  if (!nominations.length) return null;
  return (
    <div className="mb-4 space-y-3">
      {nominations.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{nominationHeadline(r)}</p>
            <p className="mt-0.5 text-sm text-emerald-900/80">
              Accept by uploading your ID proof, or decline. Co-admins approve residents, issue invite codes and settle disputes.
            </p>
          </div>
          <Link href="/admin-requests">
            <Button size="sm">
              Review nomination <ChevronRight />
            </Button>
          </Link>
        </div>
      ))}
    </div>
  );
}
