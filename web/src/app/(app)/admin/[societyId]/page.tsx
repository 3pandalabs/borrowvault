"use client";

import { Building, Check, Copy, FileText, Flag, Gavel, KeyRound, Loader2, MapPin, Plus, Settings, ShieldCheck, Users, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PilotBadge, PilotLimits, SocietyAdminsList } from "@/components/adminRequests";
import { EmptyState, ErrorText, Field, LoadError, Loading, PageHeader, Panel, PanelTitle, selectClass, StateBadge } from "@/components/common";
import { DISPUTE_CATEGORY } from "@/components/disputes";
import { REPORT_KINDS, Reports, type ReportKind } from "@/components/reports";
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
  // Report emails link to /admin/<id>/reports (older ones to /message-reports); both redirect here.
  { key: "reports", label: "Reports", icon: Flag },
  { key: "admins", label: "Admins", icon: ShieldCheck },
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
  const params = useSearchParams();
  // "message-reports" is the old tab key (links in older report emails).
  const tabParam = params.get("tab") === "message-reports" ? "reports" : params.get("tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "members";
  const kindParam = params.get("kind");
  const reportKind: ReportKind = REPORT_KINDS.some((k) => k === kindParam) ? (kindParam as ReportKind) : "messages";
  const membership = adminOf.find((m) => m.societyId === societyId);
  // Platform admins needn't be members; fetch the name for the header.
  const society = useAsync(() => api.getSociety(societyId), !membership && user.isPlatformAdmin ? `society:${societyId}` : null);
  const canAdmin = !!membership || user.isPlatformAdmin;
  const tier = membership?.societyTier ?? society.data?.tier;
  // Small calls for the tab badges (each list is max 100 by contract).
  const openReports = useAsync(async () => {
    const [messages, users, listings] = await Promise.all([
      api.adminMessageReports(societyId, "open"),
      api.adminUserReports(societyId, "open"),
      api.adminListingReports(societyId, "open"),
    ]);
    return { messages: messages.length, users: users.length, listings: listings.length };
  }, canAdmin ? `open-reports:${societyId}` : null);
  const openCounts = openReports.data ?? { messages: 0, users: 0, listings: 0 };
  const openReportCount = openCounts.messages + openCounts.users + openCounts.listings;

  if (!membership && !user.isPlatformAdmin) {
    return (
      <EmptyState
        title="You're not an admin of this society"
        body="Society admins are verified by BorrowVault. If you live here, you can apply with your ID proof, or ask an admin to nominate you."
        action={
          <>
            <Link href={`/admin-requests/new?societyId=${societyId}`}>
              <Button size="sm">Apply to be an admin</Button>
            </Link>
            <Link href="/home">
              <Button size="sm" variant="outline">
                Go home
              </Button>
            </Link>
          </>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={membership?.societyName ?? society.data?.name ?? "Society admin"}
        subtitle="Society admin console"
        actions={tier === "pilot" ? <PilotBadge /> : null}
      />
      {tier === "pilot" ? (
        <div className="mb-5">
          <PilotLimits />
        </div>
      ) : null}
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
            {key === "reports" && openReportCount ? (
              <Badge variant="warn" aria-label={`${openReportCount} open`}>
                {openReportCount >= 100 ? "99+" : openReportCount}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>
      {tab === "members" ? <Members societyId={societyId} /> : null}
      {tab === "towers" ? <Towers societyId={societyId} /> : null}
      {tab === "disputes" ? <Disputes societyId={societyId} /> : null}
      {tab === "reports" ? (
        <Reports
          societyId={societyId}
          kind={reportKind}
          openCounts={openCounts}
          onKind={(k) => router.replace(`/admin/${societyId}?tab=reports&kind=${k}`)}
          onChanged={openReports.reload}
        />
      ) : null}
      {tab === "settings" ? <SocietySettings societyId={societyId} /> : null}
      {tab === "admins" ? <Admins societyId={societyId} canNominate={!!membership} /> : null}
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
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {m.user.displayName}
                      {m.role === "society_admin" ? <Badge variant="info">Admin</Badge> : null}
                    </span>
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
  const { user } = useSession();
  // Only platform admins can reject or revoke an admin membership (403 admin_membership_platform_only).
  const adminLocked = m.role === "society_admin" && !user.isPlatformAdmin;
  const [note, setNote] = useState("");
  const action = useAction();
  const proof = useAsync(() => api.storageUrl(m.proofKey!), m.proofKey ? `proof:${m.proofKey}` : null);
  const act = (fn: () => Promise<unknown>) => action.run(fn, api.errorMessage).then((ok) => ok && onChanged());
  const isPdf = m.proofKey?.toLowerCase().endsWith(".pdf");

  return (
    <Panel>
      <PanelTitle
        aside={
          <span className="flex gap-1">
            {m.role === "society_admin" ? <Badge variant="info">Admin</Badge> : null}
            <Badge variant="muted">{m.status}</Badge>
          </span>
        }
      >
        {m.user.displayName}
      </PanelTitle>
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

      {adminLocked && (m.status === "pending" || m.status === "approved") ? (
        <p className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
          {m.user.displayName} is a society admin. Only BorrowVault can {m.status === "pending" ? "reject" : "remove"} an
          admin: write to 3PandaLabs if they should step down.
        </p>
      ) : null}
      {m.status === "pending" ? (
        <div className="space-y-2">
          <Input placeholder="Note to the resident (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={action.busy} onClick={() => act(() => api.approveMembership(m.id, note.trim() || undefined))}>
              <Check /> Approve
            </Button>
            {adminLocked ? null : (
              <Button variant="outline" disabled={action.busy} onClick={() => act(() => api.rejectMembership(m.id, note.trim() || undefined))}>
                <X /> Reject
              </Button>
            )}
          </div>
        </div>
      ) : m.status === "approved" && !adminLocked ? (
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
  const [radius] = useState(society.radiusM == null ? "" : String(society.radiusM));
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

  const [geoNote, setGeoNote] = useState<string | null>(null);
  function fillMyLocation() {
    setGeoNote(null);
    if (!navigator.geolocation) return setGeoNote("This browser can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setGeoNote(`Location updated (accurate to about ${Math.round(p.coords.accuracy)} m). Save to keep it.`);
      },
      () => setGeoNote("Couldn't get your location. Allow location access in your browser and try again."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
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
          <p className="mb-1 text-sm font-medium">Location</p>
          <p className="mb-3 text-sm text-fg-muted">
            Handover and return photos are checked against this location. To move it, stand near the middle of the society and tap the
            button.
          </p>
          {geoNote ? <p className="mb-2 text-xs text-fg-muted">{geoNote}</p> : null}
          <div className="flex flex-wrap gap-2">
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
                [
                  "declared",
                  "Declared (recommended to start)",
                  "No deposit money changes hands. The borrower pays only the rental fee to the lender over UPI.",
                  [
                    "The listing still shows a deposit amount: it is the agreed value the borrower is answerable for.",
                    "If the item comes back damaged or missing and a dispute awards damages, that amount is recorded against the borrower as a debt they must pay before borrowing again.",
                    "Best for trusted neighbours and low-value items. Easiest for residents, but lenders rely on the borrower paying the debt.",
                  ],
                ],
                [
                  "p2p",
                  "Peer-to-peer deposit",
                  "The borrower pays the rental fee and the full deposit to the lender over UPI before handover.",
                  [
                    "The lender holds the deposit and refunds it over UPI after a clean return, then the borrower confirms receiving it.",
                    "If the refund isn’t confirmed within 24 hours, a dispute is opened automatically on the borrower’s behalf.",
                    "If there’s damage, the lender can raise a dispute and the award is settled out of the deposit.",
                    "Best for higher-value items. Lenders are better protected, but borrowers need the deposit money upfront.",
                  ],
                ],
              ] as const
            ).map(([v, l, d, points]) => (
              <label key={v} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", mode === v ? "border-accent bg-emerald-50" : "border-line")}>
                <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1" />
                <span>
                  <span className="font-medium">{l}</span>
                  <span className="block text-fg-muted">{d}</span>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-fg-muted">
                    {points.map((pt) => (
                      <li key={pt}>{pt}</li>
                    ))}
                  </ul>
                </span>
              </label>
            ))}
          </div>
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

// ---------- admins ----------

function Admins({ societyId, canNominate }: { societyId: string; canNominate: boolean }) {
  const { user } = useSession();
  const admins = useAsync(() => api.societyAdmins(societyId), `admins:${societyId}`);
  return (
    <div className="max-w-2xl space-y-4">
      <Panel>
        <PanelTitle>Society admins</PanelTitle>
        <p className="mb-3 text-sm text-fg-muted">
          To add an admin, nominate a resident below, or the resident applies from their account. Every admin uploads their
          own ID proof. Only BorrowVault can remove an admin.
        </p>
        {admins.error ? (
          <LoadError error={admins.error} onRetry={admins.reload} />
        ) : !admins.data ? (
          <Loading />
        ) : (
          <SocietyAdminsList admins={admins.data} />
        )}
        {user.isPlatformAdmin ? (
          <p className="mt-3 text-xs text-fg-muted">
            Platform admin: remove admins from{" "}
            <Link href="/platform?tab=societies" className="text-accent hover:underline">
              Platform › Societies
            </Link>
            .
          </p>
        ) : null}
      </Panel>
      <Nominations societyId={societyId} canNominate={canNominate} onApproved={admins.reload} />
    </div>
  );
}

const NOMINATION_STATUS: Record<string, string> = {
  nominated: "Waiting for them to accept",
  pending: "Accepted, in review",
  approved: "Now an admin",
  rejected: "Not approved",
  withdrawn: "Withdrawn by them",
  declined: "Declined",
  cancelled: "Cancelled",
};

function Nominations({ societyId, canNominate, onApproved }: { societyId: string; canNominate: boolean; onApproved: () => void }) {
  const { user } = useSession();
  const list = useAsync(() => api.societyNominations(societyId), `nominations:${societyId}`);
  const residents = useAsync(
    () => api.adminMemberships(societyId, "approved"),
    `approved-members:${societyId}`,
  );
  const [pick, setPick] = useState("");
  const nominate = useAction();
  const cancel = useAction();

  const open = new Set(
    (list.data ?? []).filter((n) => n.status === "nominated" || n.status === "pending").map((n) => n.requesterId),
  );
  const candidates = (residents.data ?? []).filter(
    (m) => m.role !== "society_admin" && m.user.id !== user.id && !open.has(m.user.id),
  );

  return (
    <Panel>
      <PanelTitle>Co-admin nominations</PanelTitle>
      <p className="mb-3 text-sm text-fg-muted">
        Nominate an approved resident you trust. They accept by uploading their ID proof. They become an admin 48 hours
        later, unless BorrowVault rejects it first.
      </p>
      {canNominate ? (
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pick) return;
            nominate
              .run(async () => {
                await api.nominateCoAdmin(societyId, { membershipId: pick });
                setPick("");
                list.reload();
              }, api.errorMessage);
          }}
        >
          <Field label="Resident" htmlFor="nominee">
            <select id="nominee" className={selectClass} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{residents.data ? (candidates.length ? "Pick a resident" : "No residents to nominate") : "Loading…"}</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.user.displayName} · ${m.towerName} ${m.flatNo}`}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={!pick || nominate.busy}>
            {nominate.busy ? <Loader2 className="animate-spin" /> : <Plus />} Nominate
          </Button>
        </form>
      ) : (
        <p className="mb-4 text-xs text-fg-muted">Only this society&apos;s own admins can nominate co-admins.</p>
      )}
      <ErrorText>{nominate.error ?? cancel.error}</ErrorText>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <p className="text-sm text-fg-muted">No nominations yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((n) => {
            const canCancel = (n.status === "nominated" || n.status === "pending") && n.nominatedBy?.id === user.id;
            return (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{n.requesterId === user.id ? "You" : nomineeName(n.requesterId, residents.data)}</p>
                  <p className="text-fg-muted">
                    {`${NOMINATION_STATUS[n.status] ?? n.status} · nominated by ${n.nominatedBy?.displayName ?? "an admin"} on ${formatIST(n.createdAt, { time: false })}`}
                  </p>
                  {n.status === "pending" && n.autoApproveAt ? (
                    <p className="text-xs text-amber-700">{`Becomes an admin on ${formatIST(n.autoApproveAt)}`}</p>
                  ) : null}
                </div>
                {canCancel ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cancel.busy}
                    onClick={() => {
                      if (!window.confirm("Cancel this nomination?")) return;
                      cancel.run(async () => {
                        await api.cancelNomination(n.id);
                        list.reload();
                        onApproved();
                      }, api.errorMessage);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** The nominee's name from the approved-members list (AdminRequest only carries their id). */
function nomineeName(userId: string, members: AdminMembership[] | null | undefined): string {
  return members?.find((m) => m.user.id === userId)?.user.displayName ?? "A resident";
}
