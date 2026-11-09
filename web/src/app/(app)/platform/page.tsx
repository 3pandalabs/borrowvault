"use client";

import { BadgeCheck, Building2, ChevronDown, ChevronRight, FileCheck2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EmptyState, ErrorText, Field, LoadError, Loading, PageHeader, Panel, PanelTitle } from "@/components/common";
import { AdminRequestsQueue, PlatformSocietyAdmins } from "@/components/platformAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSociety, errorMessage, listPlatformSocieties, verifySociety } from "@/lib/api";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Society } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "requests", label: "Admin requests", icon: FileCheck2 },
  { key: "societies", label: "Societies", icon: Building2 },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function PlatformPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Platform />
    </Suspense>
  );
}

function Platform() {
  const { user } = useSession();
  const router = useRouter();
  const tabParam = useSearchParams().get("tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "requests";

  if (!user.isPlatformAdmin) {
    return (
      <EmptyState
        title="Platform admins only"
        body="This page is for 3PandaLabs operations."
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
      <PageHeader title="Platform admin" subtitle="Verify society admins and manage societies." />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => router.replace(`/platform?tab=${key}`)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              tab === key ? "border-accent font-medium text-accent" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "requests" ? <AdminRequestsQueue /> : <Societies />}
    </>
  );
}

const DAY_MS = 24 * 3_600_000;

function PilotRow({ s, onVerified }: { s: Society; onVerified: (s: Society) => void }) {
  const action = useAction();
  const [now] = useState(() => Date.now());
  const days = Math.max(0, Math.floor((now - Date.parse(s.createdAt)) / DAY_MS));
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-medium">{s.name}</span>
          <span className="block text-fg-muted">
            {`${s.city} · ${days === 1 ? "1 day" : `${days} days`} old · ${s.memberCount} of 50 members`}
          </span>
        </span>
        <Button
          size="sm"
          disabled={action.busy}
          onClick={() => {
            if (!window.confirm(`Mark ${s.name} verified? This lifts the pilot limits.`)) return;
            action.run(async () => onVerified(await verifySociety(s.id)), errorMessage);
          }}
        >
          {action.busy ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Mark verified
        </Button>
      </div>
      <ErrorText>{action.error}</ErrorText>
    </li>
  );
}

function Societies() {
  const [form, setForm] = useState({ name: "", city: "", lat: "", lng: "", radius: "300", email: "" });
  const societies = useAsync(listPlatformSocieties, "platform-societies");
  const action = useAction();
  const [openAdmins, setOpenAdmins] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const radius = Number(form.radius);
  const err =
    (form.lat && (Number.isNaN(lat) || lat < -90 || lat > 90) && "Latitude must be between -90 and 90.") ||
    (form.lng && (Number.isNaN(lng) || lng < -180 || lng > 180) && "Longitude must be between -180 and 180.") ||
    (form.radius && (!Number.isInteger(radius) || radius < 50 || radius > 5000) && "Radius: whole metres, 50 to 5,000.") ||
    null;

  const pilots = (societies.data ?? []).filter((s) => s.tier === "pilot");

  return (
    <div className="mx-auto max-w-3xl">
      {pilots.length ? (
        <Panel className="mb-4">
          <PanelTitle aside={<span className="text-xs text-fg-muted">{pilots.length} pilot</span>}>Pilot societies</PanelTitle>
          <p className="mb-3 text-sm text-fg-muted">
            Pilots allow up to 50 members and values up to ₹5,000, and BorrowVault rules their disputes. Mark one verified when
            you trust it. That lifts the limits.
          </p>
          <ul className="divide-y divide-line">
            {pilots.map((s) => (
              <PilotRow
                key={s.id}
                s={s}
                onVerified={(v) => societies.setData((societies.data ?? []).map((x) => (x.id === v.id ? v : x)))}
              />
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel>
        <PanelTitle aside={societies.data ? <span className="text-xs text-fg-muted">{societies.data.length} total</span> : null}>
          All societies
        </PanelTitle>
        {societies.error ? (
          <LoadError error={societies.error} onRetry={societies.reload} />
        ) : !societies.data ? (
          <Loading />
        ) : societies.data.length === 0 ? (
          <p className="text-sm text-fg-muted">No societies yet. They appear here once a registration request is approved.</p>
        ) : (
          <ul className="divide-y divide-line">
            {societies.data.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Building2 className="size-4 shrink-0 text-fg-muted" />
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-fg-muted">{s.city}</span>
                    <Badge variant={s.status === "live" ? "good" : "muted"}>{s.status}</Badge>
                    {s.tier === "pilot" ? <Badge variant="warn">pilot</Badge> : null}
                    <span className="text-xs text-fg-muted">{`${s.memberCount} members`}</span>
                    <span className="hidden text-xs text-fg-muted sm:inline">
                      {s.settings?.depositMode === "p2p" ? "P2P deposits" : "Declared deposits"} · {s.radiusM} m
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setOpenAdmins((o) => (o === s.id ? null : s.id))}>
                      {openAdmins === s.id ? <ChevronDown /> : <ChevronRight />} Admins
                    </Button>
                    <Link href={`/admin/${s.id}`} className="flex items-center gap-1 px-2 text-accent hover:underline">
                      Admin console <ChevronRight className="size-4" />
                    </Link>
                  </span>
                </div>
                {openAdmins === s.id ? (
                  <div className="mt-2 rounded-xl border border-line bg-zinc-50/60 px-4">
                    <PlatformSocietyAdmins societyId={s.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-4">
        <PanelTitle>Create a society directly</PanelTitle>
        <p className="mb-4 text-sm text-fg-muted">
          For staff use only. It creates a verified society straight away. Societies normally register themselves through
          an admin request (the Admin requests tab) and start as pilots.
        </p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (err) return;
            action.run(async () => {
              const s = await createSociety({
                name: form.name.trim(),
                city: form.city.trim(),
                centerLat: lat,
                centerLng: lng,
                radiusM: radius,
                adminUserEmail: form.email.trim(),
              });
              societies.setData([s, ...(societies.data ?? []).filter((x) => x.id !== s.id)]);
              setForm({ name: "", city: "", lat: "", lng: "", radius: "300", email: "" });
            }, errorMessage);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Society name" htmlFor="name">
              <Input id="name" required value={form.name} onChange={set("name")} />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" required value={form.city} onChange={set("city")} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Centre latitude" htmlFor="lat">
              <Input id="lat" required inputMode="decimal" value={form.lat} onChange={set("lat")} />
            </Field>
            <Field label="Centre longitude" htmlFor="lng">
              <Input id="lng" required inputMode="decimal" value={form.lng} onChange={set("lng")} />
            </Field>
            <Field label="Radius (m)" htmlFor="rad">
              <Input id="rad" required inputMode="numeric" value={form.radius} onChange={set("radius")} />
            </Field>
          </div>
          <Field
            label="Society admin's email"
            htmlFor="email"
            hint="They must already have a BorrowVault account. They become an approved society admin straight away."
          >
            <Input id="email" type="email" required value={form.email} onChange={set("email")} />
          </Field>
          <ErrorText>{err ?? action.error}</ErrorText>
          <Button type="submit" variant="outline" disabled={action.busy || !!err}>
            {action.busy ? <Loader2 className="animate-spin" /> : null} Create society
          </Button>
        </form>
      </Panel>
    </div>
  );
}
