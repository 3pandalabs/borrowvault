"use client";

import { Building, Check, Copy, FileText, Gavel, KeyRound, Loader2, MapPin, Plus, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EmptyState, ErrorText, Field, LoadError, Loading, PageHeader, Panel, PanelTitle, selectClass, StateBadge } from "@/components/common";
import { DISPUTE_CATEGORY } from "@/components/disputes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/lib/api";
import { formatCountdown, formatINR, formatIST } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { AdminMembership, DepositMode, MembershipStatus, Society } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "members", label: "Members", icon: Users },
  { key: "towers", label: "Towers & invites", icon: Building },
  { key: "disputes", label: "Disputes", icon: Gavel },
  { key: "settings", label: "Settings", icon: Settings },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function AdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Admin />
    </Suspense>
  );
}

function Admin() {
  const { societyId } = useParams<{ societyId: string }>();
  const { adminOf, user } = useSession();
  const router = useRouter();
  const tabParam = useSearchParams().get("tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "members";
  const membership = adminOf.find((m) => m.societyId === societyId);
  // Platform admins needn't be members; fetch the name for the header.
  const society = useAsync(() => api.getSociety(societyId), !membership && user.isPlatformAdmin ? `society:${societyId}` : null);

  if (!membership && !user.isPlatformAdmin) {
    return (
      <EmptyState
        title="You're not an admin of this society"
        body="Society admins are assigned by 3PandaLabs when a society goes live."
        action={
          <Link href="/home">
            <Button size="sm">Go home</Button>
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader title={membership?.societyName ?? society.data?.name ?? "Society admin"} subtitle="Society admin console" />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => router.replace(`/admin/${societyId}?tab=${key}`)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              tab === key ? "border-accent font-medium text-accent" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "members" ? <Members societyId={societyId} /> : null}
      {tab === "towers" ? <Towers societyId={societyId} /> : null}
      {tab === "disputes" ? <Disputes societyId={societyId} /> : null}
      {tab === "settings" ? <SocietySettings societyId={societyId} /> : null}
    </>
  );
}

// ---------- members ----------

const STATUS_TABS: MembershipStatus[] = ["pending", "approved", "rejected", "revoked"];

function Members({ societyId }: { societyId: string }) {
  const [status, setStatus] = useState<MembershipStatus>("pending");
  const list = useAsync(() => api.adminMemberships(societyId, status), `${societyId}|${status}`);
  const [selected, setSelected] = useState<string | null>(null);
  const current = list.data?.find((m) => m.id === selected) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setSelected(null);
              }}
              className={cn("rounded-full border px-3 py-1 text-sm capitalize", status === s ? "border-accent bg-emerald-50 text-accent" : "border-line bg-white")}
            >
              {s}
            </button>
          ))}
        </div>
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Users />}
            title={status === "pending" ? "No one waiting for approval" : `No ${status} members`}
            body={status === "pending" ? "Share an invite code on your society's WhatsApp group or notice board to bring residents in." : undefined}
            action={
              <Link href={`/admin/${societyId}?tab=towers`}>
                <Button size="sm">Generate an invite code</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {list.data.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setSelected(m.id)}
                  className={cn("flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-50", selected === m.id && "bg-emerald-50")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.user.displayName}</span>
                    <span className="text-sm text-fg-muted">
                      {m.towerName} · {m.flatNo} · {m.occupancy}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {m.proofKey ? <FileText className="size-4 text-fg-muted" aria-label="Has proof" /> : null}
                    <span className="text-xs text-fg-muted">{formatIST(m.createdAt, { time: false })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {current ? (
          <MemberReview
            key={current.id}
            m={current}
            onChanged={() => {
              setSelected(null);
              list.reload();
            }}
          />
        ) : list.data?.length ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-fg-muted">
            Pick a resident on the left to see their proof and decide.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemberReview({ m, onChanged }: { m: AdminMembership; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const action = useAction();
  const proof = useAsync(() => api.storageUrl(m.proofKey!), m.proofKey ? `proof:${m.proofKey}` : null);
  const act = (fn: () => Promise<unknown>) => action.run(fn, api.errorMessage).then((ok) => ok && onChanged());
  const isPdf = m.proofKey?.toLowerCase().endsWith(".pdf");

  return (
    <Panel>
      <PanelTitle aside={<Badge variant="muted">{m.status}</Badge>}>{m.user.displayName}</PanelTitle>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">Flat</dt>
        <dd>
          {m.towerName} · {m.flatNo} ({m.occupancy})
        </dd>
        <dt className="text-fg-muted">Email</dt>
        <dd className="break-all">{m.user.email}</dd>
        <dt className="text-fg-muted">Phone</dt>
        <dd>{m.user.phone}</dd>
        <dt className="text-fg-muted">Requested</dt>
        <dd>{formatIST(m.createdAt)}</dd>
      </dl>

      <p className="mb-2 text-sm font-medium">Proof of residence</p>
      {!m.proofKey ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          No proof uploaded{m.status === "pending" ? ". They joined with an invite code only: confirm the flat another way before approving." : "."}
        </p>
      ) : proof.error ? (
        <ErrorText>{api.errorMessage(proof.error)}</ErrorText>
      ) : !proof.data ? (
        <Loading label="Loading proof…" />
      ) : (
        <div className="mb-4 overflow-hidden rounded-xl border border-line bg-zinc-50">
          {isPdf ? (
            <iframe src={proof.data.url} title="Proof" className="h-96 w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- presigned URL
            <img src={proof.data.url} alt="Proof of residence" className="max-h-[28rem] w-full object-contain" />
          )}
          <a href={proof.data.url} target="_blank" rel="noopener noreferrer" className="block border-t border-line px-3 py-2 text-xs text-accent hover:underline">
            Open in a new tab
          </a>
        </div>
      )}

      {m.status === "pending" ? (
        <div className="space-y-2">
          <Input placeholder="Note to the resident (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={action.busy} onClick={() => act(() => api.approveMembership(m.id, note.trim() || undefined))}>
              <Check /> Approve
            </Button>
            <Button variant="outline" disabled={action.busy} onClick={() => act(() => api.rejectMembership(m.id, note.trim() || undefined))}>
              <X /> Reject
            </Button>
          </div>
        </div>
      ) : m.status === "approved" ? (
        <Button
          variant="destructive"
          disabled={action.busy}
          onClick={() => {
            if (window.confirm(`Revoke ${m.user.displayName}'s membership? They lose access to listings and bookings in this society.`))
              act(() => api.revokeMembership(m.id));
          }}
        >
          Revoke membership
        </Button>
      ) : null}
      <ErrorText>{action.error}</ErrorText>
    </Panel>
  );
}

// ---------- towers & invite codes ----------

function Towers({ societyId }: { societyId: string }) {
  const towers = useAsync(() => api.getTowers(societyId), `towers:${societyId}`);
  const codes = useAsync(() => api.listInviteCodes(societyId), `codes:${societyId}`);
  const [name, setName] = useState("");
  const add = useAction();
  const gen = useAction();
  const [towerId, setTowerId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelTitle>Towers</PanelTitle>
        {towers.error ? (
          <LoadError error={towers.error} onRetry={towers.reload} />
        ) : !towers.data ? (
          <Loading />
        ) : towers.data.length ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {towers.data.map((t) => (
              <li key={t.id} className="rounded-full bg-zinc-100 px-3 py-1 text-sm">
                {t.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-amber-700">No towers yet. Residents can&apos;t join until you add at least one.</p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.run(() => api.createTower(societyId, name.trim()), api.errorMessage).then((ok) => {
              if (ok) {
                setName("");
                towers.reload();
              }
            });
          }}
        >
          <Input placeholder="Tower A, Block 3, Phase 2…" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={add.busy || !name.trim()}>
            <Plus /> Add
          </Button>
        </form>
        <ErrorText>{add.error}</ErrorText>
      </Panel>

      <Panel>
        <PanelTitle>Invite codes</PanelTitle>
        <p className="mb-3 text-sm text-fg-muted">
          One code per tower, valid 30 days. Post it on the society WhatsApp group or notice board. A code only gets someone to
          &quot;pending&quot;: you still approve each resident.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            gen.run(() => api.createInviteCode(societyId, towerId), api.errorMessage).then((ok) => ok && codes.reload());
          }}
        >
          <select aria-label="Tower" className={selectClass} value={towerId} onChange={(e) => setTowerId(e.target.value)}>
            <option value="" disabled>
              {towers.data?.length === 0 ? "Add a tower first" : "Choose a tower…"}
            </option>
            {(towers.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={gen.busy || !towerId}>
            {gen.busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Generate
          </Button>
        </form>
        <ErrorText>{gen.error}</ErrorText>
        {codes.error ? (
          <LoadError error={codes.error} onRetry={codes.reload} />
        ) : codes.data?.length ? (
          <ul className="mt-4 space-y-2">
            {codes.data.map((c) => (
              <li key={c.code} className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
                <span className="min-w-0">
                  <span className="font-mono text-lg tracking-widest">{c.code}</span>
                  <span className="block text-xs text-fg-muted">
                    {c.towerName} · expires {formatIST(c.expiresAt, { time: false })} · used {c.usedCount} {c.usedCount === 1 ? "time" : "times"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(`Join our society on BorrowVault: https://borrowvault.3pandalabs.com/signup (invite code ${c.code})`)
                      .then(() => setCopied(c.code), () => undefined)
                  }
                >
                  {copied === c.code ? <Check /> : <Copy />} {copied === c.code ? "Copied" : "Copy"}
                </Button>
              </li>
            ))}
          </ul>
        ) : codes.data ? (
          <p className="mt-4 text-sm text-fg-muted">No codes yet. Pick a tower and generate one.</p>
        ) : null}
      </Panel>
    </div>
  );
}

// ---------- disputes ----------

function Disputes({ societyId }: { societyId: string }) {
  const [status, setStatus] = useState("");
  const list = useAsync(() => api.adminDisputes(societyId, status || undefined), `disputes:${societyId}|${status}`);

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ["", "All"],
          ["open", "Open"],
          ["resolved", "Resolved"],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={cn("rounded-full border px-3 py-1 text-sm", status === v ? "border-accent bg-emerald-50 text-accent" : "border-line bg-white")}
          >
            {l}
          </button>
        ))}
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Gavel />}
          title="No disputes"
          body="When a lender and borrower can't agree on a return, it lands here for you to rule on."
          action={
            <Link href={`/admin/${societyId}?tab=members`}>
              <Button size="sm" variant="outline">
                Review pending members
              </Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {list.data.map((d) => (
            <li key={d.id}>
              <Link href={`/admin/${societyId}/disputes/${d.booking.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {d.booking.listing.title}
                    <Badge variant="bad">{DISPUTE_CATEGORY[d.category] ?? d.category}</Badge>
                    <StateBadge state={d.booking.state} />
                  </span>
                  <span className="text-sm text-fg-muted">
                    {d.booking.lender.towerName}-{d.booking.lender.flatNo} vs {d.booking.borrower.towerName}-{d.booking.borrower.flatNo} · claim{" "}
                    {formatINR(d.claimedPaise)}
                    {d.offerPaise != null ? ` · offer ${formatINR(d.offerPaise)}` : ""}
                  </span>
                </span>
                <span className="text-xs text-fg-muted">
                  {d.resolvedAt ? `Resolved ${formatIST(d.resolvedAt, { time: false })}` : d.deadlineAt ? `Due ${formatCountdown(d.deadlineAt)}` : d.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- settings ----------

function SocietySettings({ societyId }: { societyId: string }) {
  const society = useAsync(() => api.getSociety(societyId), `society:${societyId}`);
  if (society.error) return <LoadError error={society.error} onRetry={society.reload} />;
  if (!society.data) return <Loading />;
  // After a save the form keeps its (now saved) values; "dirty" compares against the fresh society.
  return <SettingsForm key={society.data.id} society={society.data} onSaved={society.setData} />;
}

function SettingsForm({ society, onSaved }: { society: Society; onSaved: (s: Society) => void }) {
  const [lat, setLat] = useState(society.centerLat == null ? "" : String(society.centerLat));
  const [lng, setLng] = useState(society.centerLng == null ? "" : String(society.centerLng));
  const [radius, setRadius] = useState(society.radiusM == null ? "" : String(society.radiusM));
  const [mode, setMode] = useState<DepositMode>(society.settings?.depositMode ?? "declared");
  const action = useAction();
  const [justSaved, setJustSaved] = useState(false);

  const latN = Number(lat);
  const lngN = Number(lng);
  const rN = Number(radius);
  const geoErr =
    (!lat.trim() || Number.isNaN(latN) || latN < -90 || latN > 90 ? "Latitude must be between -90 and 90." : null) ??
    (!lng.trim() || Number.isNaN(lngN) || lngN < -180 || lngN > 180 ? "Longitude must be between -180 and 180." : null) ??
    (!Number.isInteger(rN) || rN < 50 || rN > 5000 ? "Radius must be a whole number of metres, 50 to 5,000." : null);
  const dirty =
    latN !== society.centerLat || lngN !== society.centerLng || rN !== society.radiusM || mode !== society.settings?.depositMode;

  function fillMyLocation() {
    navigator.geolocation?.getCurrentPosition((p) => {
      setLat(p.coords.latitude.toFixed(6));
      setLng(p.coords.longitude.toFixed(6));
    });
  }

  return (
    <Panel className="max-w-2xl">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (geoErr) return;
          action.run(async () => {
            const next = await api.patchSociety(society.id, {
              centerLat: latN,
              centerLng: lngN,
              radiusM: rN,
              settings: { depositMode: mode },
            });
            setJustSaved(true);
            onSaved(next);
          }, api.errorMessage);
        }}
      >
        <div>
          <PanelTitle aside={<Badge variant="muted">{society.status}</Badge>}>
            {society.name}, {society.city}
          </PanelTitle>
          <p className="mb-1 text-sm font-medium">Geofence</p>
          <p className="mb-3 text-sm text-fg-muted">
            Handover and return photos are checked against this circle. Put the centre in the middle of the society and pick a radius that
            covers every tower.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Centre latitude" htmlFor="lat">
              <Input id="lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            </Field>
            <Field label="Centre longitude" htmlFor="lng">
              <Input id="lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
            </Field>
            <Field label="Radius (m)" htmlFor="rad">
              <Input id="rad" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={fillMyLocation}>
              <MapPin /> Use my current location
            </Button>
            {!geoErr ? (
              <a href={`https://www.google.com/maps?q=${latN},${lngN}`} target="_blank" rel="noopener noreferrer">
                <Button type="button" size="sm" variant="ghost">
                  Check on Google Maps
                </Button>
              </a>
            ) : null}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium">Deposit mode</p>
          <div className="space-y-2">
            {(
              [
                ["declared", "Declared", "No deposit money moves. If a dispute awards damages, the borrower owes it as a recorded debt."],
                ["p2p", "Peer-to-peer", "The borrower pays the deposit to the lender over UPI, and the lender refunds it after a clean return."],
              ] as const
            ).map(([v, l, d]) => (
              <label key={v} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", mode === v ? "border-accent bg-emerald-50" : "border-line")}>
                <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1" />
                <span>
                  <span className="font-medium">{l}</span>
                  <span className="block text-fg-muted">{d}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-muted">Changes apply to new bookings.</p>
        </div>

        <ErrorText>{geoErr ?? action.error}</ErrorText>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={action.busy || !!geoErr || !dirty}>
            {action.busy ? <Loader2 className="animate-spin" /> : null} Save settings
          </Button>
          {justSaved && !dirty ? <span className="text-sm text-accent">Saved</span> : null}
        </div>
      </form>
    </Panel>
  );
}
