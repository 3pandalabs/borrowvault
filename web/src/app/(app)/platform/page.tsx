"use client";

import { Building2, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorText, Field, LoadError, Loading, PageHeader, Panel, PanelTitle } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSociety, errorMessage, listPlatformSocieties } from "@/lib/api";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";

export default function PlatformPage() {
  const { user } = useSession();
  const [form, setForm] = useState({ name: "", city: "", lat: "", lng: "", radius: "300", email: "" });
  const societies = useAsync(listPlatformSocieties, user.isPlatformAdmin ? "platform-societies" : null);
  const action = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

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

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const radius = Number(form.radius);
  const err =
    (form.lat && (Number.isNaN(lat) || lat < -90 || lat > 90) && "Latitude must be between -90 and 90.") ||
    (form.lng && (Number.isNaN(lng) || lng < -180 || lng > 180) && "Longitude must be between -180 and 180.") ||
    (form.radius && (!Number.isInteger(radius) || radius < 50 || radius > 5000) && "Radius: whole metres, 50 to 5,000.") ||
    null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Platform admin" subtitle="Create a society and assign its first admin." />
      <Panel>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (err) return;
            action
              .run(async () => {
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
          <Button type="submit" disabled={action.busy || !!err}>
            {action.busy ? <Loader2 className="animate-spin" /> : null} Create society
          </Button>
        </form>
      </Panel>

      <Panel className="mt-4">
        <PanelTitle aside={societies.data ? <span className="text-xs text-fg-muted">{societies.data.length} total</span> : null}>
          All societies
        </PanelTitle>
        {societies.error ? (
          <LoadError error={societies.error} onRetry={societies.reload} />
        ) : !societies.data ? (
          <Loading />
        ) : societies.data.length === 0 ? (
          <p className="text-sm text-fg-muted">No societies yet. Create the first one above.</p>
        ) : (
          <ul className="divide-y divide-line">
            {societies.data.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/${s.id}`} className="flex items-center justify-between gap-2 py-3 text-sm hover:bg-zinc-50/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <Building2 className="size-4 shrink-0 text-fg-muted" />
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-fg-muted">{s.city}</span>
                    <Badge variant={s.status === "live" ? "good" : "muted"}>{s.status}</Badge>
                    <span className="hidden text-xs text-fg-muted sm:inline">
                      {s.settings?.depositMode === "p2p" ? "P2P deposits" : "Declared deposits"} · {s.radiusM} m
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-accent">
                    Admin console <ChevronRight className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
