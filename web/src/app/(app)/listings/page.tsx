"use client";

import { ImageOff, PackageSearch, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RequireApproved } from "@/components/AppShell";
import { EmptyState, LoadError, Loading, PageHeader, selectClass, TrustBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCategories, listListings } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { priceLine } from "@/lib/listing";
import type { ListingKind } from "@/lib/types";

export default function ListingsPage() {
  return (
    <RequireApproved>
      <Browse />
    </RequireApproved>
  );
}

function Browse() {
  const { active } = useSession();
  const societyId = active!.societyId;
  const [kind, setKind] = useState<ListingKind | "">("");
  const [category, setCategory] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);

  const categories = useAsync(getCategories, "categories");
  const listings = useAsync(
    // "Mine" = my own listings across all my societies, any status (ownerId=me).
    () => (mine ? listListings({ ownerId: "me", kind, category, q }) : listListings({ societyId, kind, category, q })),
    `${mine ? "me" : societyId}|${kind}|${category}|${q}`,
  );
  const cats = (categories.data ?? []).filter((c) => !kind || c.kind === kind);
  const catLabel = (key: string) => categories.data?.find((c) => c.key === key)?.label ?? key;
  const rows = listings.data ?? [];
  const filtered = !!(kind || category || q || mine);

  return (
    <>
      <PageHeader
        title="Browse"
        subtitle={`Things and skills offered by verified neighbours in ${active!.societyName}`}
        actions={
          <Link href="/listings/new">
            <Button>
              <Plus /> List something
            </Button>
          </Link>
        }
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput.trim());
          }}
        >
          <Input placeholder="Search drills, strollers, tutoring…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          <Button type="submit" variant="dark" size="icon" aria-label="Search">
            <Search />
          </Button>
        </form>
        <select
          aria-label="Kind"
          className={selectClass}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ListingKind | "");
            setCategory("");
          }}
        >
          <option value="">Items & skills</option>
          <option value="item">Items</option>
          <option value="skill">Skills</option>
        </select>
        <select aria-label="Category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
        </label>
      </div>

      {listings.error ? (
        <LoadError error={listings.error} onRetry={listings.reload} />
      ) : listings.loading && !listings.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title={filtered ? "Nothing matches those filters" : "No listings in your society yet"}
          body={
            filtered
              ? "Try a broader search, or be the one who lists it."
              : "Be the first. The drill in your cupboard is what your neighbour is about to buy."
          }
          action={
            <>
              {filtered ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setKind("");
                    setCategory("");
                    setQ("");
                    setQInput("");
                    setMine(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
              <Link href="/listings/new">
                <Button size="sm">
                  <Plus /> List something
                </Button>
              </Link>
            </>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => (
            <Link
              key={l.id}
              href={`/listings/${l.id}`}
              className="group overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition hover:shadow-md"
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100">
                {l.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL, see next.config.ts
                  <img src={l.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageOff className="size-8 text-zinc-300" />
                )}
              </div>
              <div className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant={l.kind === "skill" ? "info" : "muted"}>{l.kind === "skill" ? "Skill" : "Item"}</Badge>
                  <span className="truncate text-xs text-fg-muted">{catLabel(l.category)}</span>
                  {l.status !== "active" ? <Badge variant="warn">{l.status}</Badge> : null}
                </div>
                <p className="font-medium group-hover:text-accent">{l.title}</p>
                <p className="mt-1 text-sm text-fg">{priceLine(l)}</p>
                {l.depositPaise ? <p className="text-xs text-fg-muted">Deposit {formatINR(l.depositPaise)}</p> : null}
                {!mine ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                    {l.owner.displayName}
                    {` · ${l.owner.towerName}-${l.owner.flatNo}`}
                    <TrustBadge trust={l.owner.trust} compact />
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
