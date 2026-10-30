"use client";

import { CalendarDays, ImageOff, Loader2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, ErrorText, Field, LoadError, Loading, Panel, PanelTitle, selectClass, TrustBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, createBooking, errorMessage, getAvailability, getListing } from "@/lib/api";
import { formatINR, formatRange, istLocalToIso } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { priceLine } from "@/lib/listing";
import { useSession } from "@/lib/session";
import type { Listing, PricingUnit } from "@/lib/types";

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const listing = useAsync(() => getListing(id), `listing:${id}`);

  if (listing.error) return <LoadError error={listing.error} onRetry={listing.reload} />;
  if (!listing.data) return <Loading />;
  const l = listing.data;
  const isOwner = l.owner.id === user.id;
  const photos = l.photoUrls ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          {photos.length ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {photos.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- presigned URL
                <img key={i} src={u} alt="" className={`w-full object-cover ${i === 0 ? "aspect-[4/3] sm:col-span-2" : "aspect-square"}`} />
              ))}
            </div>
          ) : (
            <div className="flex aspect-[16/7] items-center justify-center bg-zinc-100">
              <ImageOff className="size-10 text-zinc-300" />
            </div>
          )}
        </div>

        <Panel>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={l.kind === "skill" ? "info" : "muted"}>{l.kind === "skill" ? "Skill" : "Item"}</Badge>
            <span className="text-sm text-fg-muted">{l.category}</span>
            {l.status !== "active" ? <Badge variant="warn">{l.status}</Badge> : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{l.title}</h1>
          <p className="mt-1 text-lg">{priceLine(l)}</p>
          {l.kind === "item" ? (
            <p className="text-sm text-fg-muted">
              Deposit {formatINR(l.depositPaise)}
              {l.replacementValuePaise ? ` · Replacement value ${formatINR(l.replacementValuePaise)}` : ""}
            </p>
          ) : null}
          {l.description ? <p className="mt-4 whitespace-pre-line text-sm text-fg">{l.description}</p> : null}
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-sm">
            <span className="font-medium">{l.owner.displayName}</span>
            <span className="text-fg-muted">
              {l.owner.towerName} · {l.owner.flatNo}
            </span>
            <TrustBadge trust={l.owner.trust} />
          </div>
        </Panel>

        {l.kind === "item" && (l.checklistTemplate.length || l.requiredPhotoSlots.length) ? (
          <Panel>
            <PanelTitle>Checked at handover and return</PanelTitle>
            {l.checklistTemplate.length ? (
              <ul className="mb-3 list-inside list-disc text-sm text-fg-muted">
                {l.checklistTemplate.map((c) => (
                  <li key={c.id}>
                    {c.label}
                    {c.type === "choice" && c.options ? ` (${c.options.join(" / ")})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {l.requiredPhotoSlots.map((s) => (
                <Badge key={s} variant="outline">
                  📷 {s}
                </Badge>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="space-y-4">
        {isOwner ? (
          <Panel>
            <PanelTitle>This is your listing</PanelTitle>
            <p className="mb-3 text-sm text-fg-muted">Requests from neighbours show up in your bookings.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/listings/${l.id}/edit`}>
                <Button>
                  <Pencil /> Edit listing
                </Button>
              </Link>
              <Link href="/bookings?role=lender">
                <Button variant="outline">Requests</Button>
              </Link>
            </div>
          </Panel>
        ) : l.status === "active" ? (
          <RequestForm listing={l} />
        ) : (
          <EmptyState
            title="Not taking bookings right now"
            body="The owner has paused this listing."
            action={
              <Link href="/listings">
                <Button size="sm">Browse other listings</Button>
              </Link>
            }
          />
        )}
        <Availability listingId={l.id} />
      </div>
    </div>
  );
}

function RequestForm({ listing: l }: { listing: Listing }) {
  const router = useRouter();
  const units = (
    [
      ["hourly", l.hourlyPaise, "Hourly"],
      ["daily", l.dailyPaise, "Daily"],
      ["weekend", l.weekendPaise, "Weekend"],
    ] as const
  ).filter(([, p]) => p);
  const [pricing, setPricing] = useState<PricingUnit>(units[0]?.[0] ?? "daily");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMs = start ? new Date(`${start}:00+05:30`).getTime() : NaN;
  const endMs = end ? new Date(`${end}:00+05:30`).getTime() : NaN;
  const valid = !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs;
  const hours = valid ? (endMs - startMs) / 3_600_000 : 0;
  const unitPrice = units.find(([u]) => u === pricing)?.[1] ?? 0;
  const estimate =
    !valid || !unitPrice
      ? null
      : pricing === "hourly"
        ? Math.ceil(hours) * unitPrice
        : pricing === "daily"
          ? Math.ceil(hours / 24) * unitPrice
          : unitPrice; // weekend: flat, up to 72 h (ROUTES.md)

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("The end has to be after the start.");
    if (hours > 30 * 24) return setError("Bookings can be at most 30 days.");
    if (pricing === "weekend" && hours > 72) return setError("Weekend pricing covers up to 72 hours. Pick daily for longer.");
    setBusy(true);
    setError(null);
    try {
      const b = await createBooking({ listingId: l.id, startsAt: istLocalToIso(start), endsAt: istLocalToIso(end), pricing });
      router.push(`/bookings/${b.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? `You can't borrow right now. Borrowing is paused while you owe an unpaid dispute award or your trust score is below 2.0.${err.message && err.message !== "request_failed" ? ` (${err.message})` : ""}`
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelTitle>Request to {l.kind === "skill" ? "book" : "borrow"}</PanelTitle>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Pricing" htmlFor="pricing">
          <select id="pricing" className={selectClass} value={pricing} onChange={(e) => setPricing(e.target.value as PricingUnit)}>
            {units.map(([u, p, label]) => (
              <option key={u} value={u}>
                {label}: {formatINR(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From (IST)" htmlFor="start">
          <Input id="start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Until (IST)" htmlFor="end">
          <Input id="end" type="datetime-local" required value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        {estimate !== null ? (
          <div className="rounded-xl bg-zinc-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-fg-muted">Estimated fee</span>
              <span className="font-medium">{formatINR(estimate)}</span>
            </div>
            {l.depositPaise ? (
              <div className="flex justify-between">
                <span className="text-fg-muted">Deposit</span>
                <span>{formatINR(l.depositPaise)}</span>
              </div>
            ) : null}
            <p className="mt-1 text-xs text-fg-muted">The final amount is set when the lender accepts. You pay over UPI after that.</p>
          </div>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy || !valid}>
          {busy ? <Loader2 className="animate-spin" /> : null} Send request
        </Button>
      </form>
    </Panel>
  );
}

function Availability({ listingId }: { listingId: string }) {
  const busy = useAsync(() => {
    // Default window is now → +90 days.
    return getAvailability(listingId);
  }, `avail:${listingId}`);

  return (
    <Panel>
      <PanelTitle>
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4" /> Booked in the next 90 days
        </span>
      </PanelTitle>
      {busy.error ? (
        <ErrorText>{errorMessage(busy.error)}</ErrorText>
      ) : !busy.data ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : busy.data.length === 0 ? (
        <p className="text-sm text-fg-muted">Free the whole time. Pick any slot.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {busy.data.map((r, i) => (
            <li key={i} className="rounded-lg bg-zinc-50 px-3 py-1.5">
              {formatRange(r.startsAt, r.endsAt)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
