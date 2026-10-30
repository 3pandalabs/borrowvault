"use client";

import { ImagePlus, Loader2, Plus, Trash2, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { errorMessage, getCategories, uploadFile } from "@/lib/api";
import { paiseToRupeesInput, rupeesToPaise } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { ChecklistItem, ChecklistType, Listing, ListingInput, ListingKind, ListingStatus } from "@/lib/types";
import { ErrorText, Field, Panel, PanelTitle, selectClass } from "./common";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 8 * 1024 * 1024;
const TYPE_LABEL: Record<ChecklistType, string> = {
  bool: "Yes / no",
  percent: "Percent",
  choice: "Choice",
  count: "Count",
  text: "Note",
};

type Photo = { key: string; preview: string | null };

export type ListingFormValue = Omit<ListingInput, "societyId"> & { status?: ListingStatus };

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function ListingForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Listing;
  submitLabel: string;
  onSubmit: (v: ListingFormValue) => Promise<void>;
}) {
  const { user } = useSession();
  const categories = useAsync(getCategories, "categories");

  const [kind, setKind] = useState<ListingKind>(initial?.kind ?? "item");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [hourly, setHourly] = useState(paiseToRupeesInput(initial?.hourlyPaise));
  const [daily, setDaily] = useState(paiseToRupeesInput(initial?.dailyPaise));
  const [weekend, setWeekend] = useState(paiseToRupeesInput(initial?.weekendPaise));
  const [deposit, setDeposit] = useState(paiseToRupeesInput(initial?.depositPaise ?? 0));
  const [replacement, setReplacement] = useState(paiseToRupeesInput(initial?.replacementValuePaise));
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial?.checklistTemplate ?? []);
  const [slots, setSlots] = useState<string[]>(initial?.requiredPhotoSlots ?? []);
  const [slotInput, setSlotInput] = useState("");
  const [photos, setPhotos] = useState<Photo[]>(
    (initial?.photoKeys ?? []).map((key, i) => ({ key, preview: initial?.photoUrls?.[i] ?? null })),
  );
  const [status, setStatus] = useState<ListingStatus>(initial?.status ?? "active");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = (categories.data ?? []).filter((c) => c.kind === kind);

  function applyPreset(key: string) {
    setCategory(key);
    const p = categories.data?.find((c) => c.key === key);
    // Only prefill when there's nothing to overwrite, or on a fresh listing:
    // the lender's own edits to the checklist must not be silently replaced.
    if (p && kind === "item" && (!initial || (checklist.length === 0 && slots.length === 0))) {
      setChecklist(p.checklistTemplate.map((c) => ({ ...c })));
      setSlots([...p.requiredPhotoSlots]);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!PHOTO_TYPES.includes(f.type)) throw new Error(`${f.name}: use JPEG, PNG or WebP.`);
        if (f.size > PHOTO_MAX) throw new Error(`${f.name} is over 8 MB.`);
        const key = await uploadFile("listing_photo", f);
        setPhotos((p) => [...p, { key, preview: URL.createObjectURL(f) }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function updateItem(i: number, patch: Partial<ChecklistItem>) {
    setChecklist((c) => c.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const hourlyPaise = rupeesToPaise(hourly);
    const dailyPaise = rupeesToPaise(daily);
    const weekendPaise = rupeesToPaise(weekend);
    const depositPaise = kind === "skill" ? 0 : (rupeesToPaise(deposit) ?? 0);
    const replacementValuePaise = rupeesToPaise(replacement);
    for (const [label, raw, val] of [
      ["Hourly price", hourly, hourlyPaise],
      ["Daily price", daily, dailyPaise],
      ["Weekend price", weekend, weekendPaise],
      ["Replacement value", replacement, replacementValuePaise],
    ] as const) {
      if (raw.trim() && val === null) return setError(`${label}: enter an amount in rupees, like 350 or 350.50.`);
    }
    if (kind === "item" && deposit.trim() && rupeesToPaise(deposit) === null) return setError("Deposit: enter an amount in rupees.");
    if (!hourlyPaise && !dailyPaise && !weekendPaise) return setError("Set at least one price: hourly, daily or weekend.");
    if (!category) return setError("Pick a category.");
    const cleanChecklist =
      kind === "skill"
        ? []
        : checklist
            .filter((c) => c.label.trim())
            .map((c) => ({
              id: c.id,
              label: c.label.trim(),
              type: c.type,
              ...(c.type === "choice" ? { options: (c.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
            }));
    if (cleanChecklist.some((c) => c.type === "choice" && (c.options?.length ?? 0) < 2))
      return setError("Each choice item needs at least two options.");
    const cleanSlots = kind === "skill" ? [] : slots.map((s) => s.trim()).filter(Boolean);
    if (kind === "item" && cleanSlots.length === 0)
      return setError("Items need at least one required photo slot (e.g. front), so handover and return can be compared.");

    setBusy(true);
    try {
      await onSubmit({
        kind,
        category,
        title: title.trim(),
        description: description.trim(),
        ...(hourlyPaise ? { hourlyPaise } : {}),
        ...(dailyPaise ? { dailyPaise } : {}),
        ...(weekendPaise ? { weekendPaise } : {}),
        depositPaise,
        ...(replacementValuePaise ? { replacementValuePaise } : {}),
        checklistTemplate: cleanChecklist,
        requiredPhotoSlots: cleanSlots,
        photoKeys: photos.map((p) => p.key),
        ...(initial ? { status } : {}),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user.upiVpa) {
    return (
      <Panel className="text-center">
        <Wallet className="mx-auto size-8 text-accent" />
        <p className="mt-3 font-medium">Add your UPI ID first</p>
        <p className="mt-1 text-sm text-fg-muted">Borrowers pay you directly over UPI, so a UPI ID is required before you can lend.</p>
        <Link href="/profile" className="mt-4 inline-block">
          <Button>Add UPI ID</Button>
        </Link>
      </Panel>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Panel className="space-y-4">
        <PanelTitle>What are you offering?</PanelTitle>
        {!initial ? (
          <div className="flex gap-2">
            {(["item", "skill"] as const).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => {
                  setKind(k);
                  setCategory("");
                }}
                className={`flex-1 rounded-xl border px-4 py-3 text-left text-sm ${kind === k ? "border-accent bg-emerald-50" : "border-line"}`}
              >
                <span className="block font-medium">{k === "item" ? "An item" : "A skill or service"}</span>
                <span className="text-fg-muted">{k === "item" ? "Lend a thing, with a deposit and photo proof" : "Tutoring, repairs, help with a move"}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="cat" hint={kind === "item" ? "Picking one fills in a starter checklist and photo slots you can edit." : undefined}>
            <select id="cat" required className={selectClass} value={category} onChange={(e) => applyPreset(e.target.value)}>
              <option value="" disabled>
                {categories.loading ? "Loading…" : "Choose…"}
              </option>
              {presets.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
              {category && !presets.some((c) => c.key === category) ? <option value={category}>{category}</option> : null}
            </select>
          </Field>
          <Field label="Title" htmlFor="title">
            <Input id="title" required maxLength={120} placeholder="Bosch GSB 500 drill" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label="Description" htmlFor="desc">
          <Textarea id="desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {initial ? (
          <Field label="Status" htmlFor="status">
            <select id="status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as ListingStatus)}>
              <option value="active">Active: visible and bookable</option>
              <option value="paused">Paused: hidden for now</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        ) : null}
      </Panel>

      <Panel className="space-y-4">
        <PanelTitle>Price</PanelTitle>
        <p className="-mt-2 text-sm text-fg-muted">In rupees. Set at least one. Paid to your UPI ID: {user.upiVpa}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Per hour (₹)" htmlFor="hr">
            <Input id="hr" inputMode="decimal" value={hourly} onChange={(e) => setHourly(e.target.value)} />
          </Field>
          <Field label="Per day (₹)" htmlFor="day">
            <Input id="day" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
          <Field label="Per weekend (₹)" htmlFor="wk">
            <Input id="wk" inputMode="decimal" value={weekend} onChange={(e) => setWeekend(e.target.value)} />
          </Field>
        </div>
        {kind === "item" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deposit (₹)" htmlFor="dep" hint="The most a dispute can award you. 0 for none.">
              <Input id="dep" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </Field>
            <Field label="Replacement value (₹, optional)" htmlFor="rep">
              <Input id="rep" inputMode="decimal" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Panel>

      {kind === "item" ? (
        <>
          <Panel>
            <PanelTitle
              aside={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setChecklist((c) => [...c, { id: newId(), label: "", type: "bool" }])}
                >
                  <Plus /> Add item
                </Button>
              }
            >
              Handover checklist
            </PanelTitle>
            <p className="mb-3 text-sm text-fg-muted">
              Both of you answer this at handover and at return, so differences stand out. Each booking freezes a copy, so later
              edits don&apos;t affect bookings already made.
            </p>
            {checklist.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-sm text-fg-muted">
                No checklist items yet. Add things like &quot;Charger included&quot; or &quot;Battery level&quot;.
              </p>
            ) : (
              <ul className="space-y-2">
                {checklist.map((it, i) => (
                  <li key={it.id} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_9rem_auto]">
                    <Input aria-label="Label" placeholder="Label" value={it.label} onChange={(e) => updateItem(i, { label: e.target.value })} />
                    <select
                      aria-label="Answer type"
                      className={selectClass}
                      value={it.type}
                      onChange={(e) => updateItem(i, { type: e.target.value as ChecklistType })}
                    >
                      {Object.entries(TYPE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setChecklist((c) => c.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                    {it.type === "choice" ? (
                      <Input
                        className="sm:col-span-3"
                        placeholder="Options, comma-separated: none, minor, visible"
                        value={(it.options ?? []).join(", ")}
                        onChange={(e) => updateItem(i, { options: e.target.value.split(",").map((s) => s.trimStart()) })}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Required photo slots</PanelTitle>
            <p className="mb-3 text-sm text-fg-muted">
              The app asks both of you to photograph each slot at handover and return. At least one is required.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {slots.map((s, i) => (
                <span key={`${s}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-sm">
                  {s}
                  <button type="button" aria-label={`Remove ${s}`} onClick={() => setSlots((x) => x.filter((_, j) => j !== i))}>
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              {slots.length === 0 ? <span className="text-sm text-amber-700">No slots yet.</span> : null}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. front, serial, accessories"
                value={slotInput}
                onChange={(e) => setSlotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (slotInput.trim()) setSlots((s) => [...s, slotInput.trim()]);
                    setSlotInput("");
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (slotInput.trim()) setSlots((s) => [...s, slotInput.trim()]);
                  setSlotInput("");
                }}
              >
                Add
              </Button>
            </div>
          </Panel>
        </>
      ) : null}

      <Panel>
        <PanelTitle>Listing photos</PanelTitle>
        <p className="mb-3 text-sm text-fg-muted">Shown to neighbours browsing. JPEG, PNG or WebP, up to 8 MB each.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {photos.map((p, i) => (
            <div key={p.key} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-100">
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob/presigned URL
                <img src={p.preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-xs text-fg-muted">Photo {i + 1}</span>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                className="absolute top-1 right-1 rounded-full bg-white/90 p-1"
                onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 text-xs text-fg-muted hover:bg-zinc-50">
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            Add
            <input type="file" multiple accept={PHOTO_TYPES.join(",")} className="sr-only" disabled={uploading} onChange={(e) => addPhotos(e.target.files)} />
          </label>
        </div>
      </Panel>

      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || uploading}>
          {busy ? <Loader2 className="animate-spin" /> : null} {submitLabel}
        </Button>
        <Link href={initial ? `/listings/${initial.id}` : "/listings"}>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
