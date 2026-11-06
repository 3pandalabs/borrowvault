"use client";

import { Clock, Crosshair, Loader2, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DocPicker,
  type DocSlot,
  emptySlot,
  lengthError,
  mapsUrl,
  uploadDocs,
} from "@/components/adminRequests";
import { ErrorText, Field, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { createAdminRequest, errorMessage, myAdminRequests, tryGeo } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { Occupancy } from "@/lib/types";

type Docs = { rwaRegistrationKey: DocSlot; authorizationKey: DocSlot; idProofKey: DocSlot };

const EMPTY = {
  societyName: "",
  city: "",
  address: "",
  lat: "",
  lng: "",
  radius: "300",
  towerName: "",
  flatNo: "",
  committeeRole: "",
  statement: "",
};

export default function RegisterSocietyPage() {
  const router = useRouter();
  const mine = useAsync(myAdminRequests, "admin-requests-mine");
  const [form, setForm] = useState(EMPTY);
  const [occupancy, setOccupancy] = useState<Occupancy>("owner");
  const [docs, setDocs] = useState<Docs>({ rwaRegistrationKey: emptySlot, authorizationKey: emptySlot, idProofKey: emptySlot });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"upload" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  const set =
    (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const setDoc = (k: keyof Docs) => (s: DocSlot) => setDocs((d) => ({ ...d, [k]: s }));

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const radius = Number(form.radius);
  const latErr = form.lat.trim() && (Number.isNaN(lat) || lat < -90 || lat > 90) ? "Latitude must be between -90 and 90." : null;
  const lngErr =
    form.lng.trim() && (Number.isNaN(lng) || lng < -180 || lng > 180) ? "Longitude must be between -180 and 180." : null;
  const radiusErr =
    form.radius.trim() && (!Number.isInteger(radius) || radius < 50 || radius > 5000) ? "Whole metres, 50 to 5,000." : null;
  const errs = {
    societyName: lengthError("Society name", form.societyName, 2, 120),
    city: lengthError("City", form.city, 2, 80),
    address: lengthError("Address", form.address, 5, 500),
    towerName: lengthError("Tower / block", form.towerName, 1, 60),
    flatNo: lengthError("Flat number", form.flatNo, 1, 20),
    committeeRole: lengthError("Role", form.committeeRole, 2, 60),
    statement: lengthError("Note", form.statement, 0, 1000),
  };
  const required = (v: string) => (tried && !v.trim() ? "Required." : null);
  const coordsOk = !!form.lat.trim() && !!form.lng.trim() && !latErr && !lngErr;

  const pending = mine.data?.find((r) => r.kind === "new_society" && r.status === "pending");

  async function useMyLocation() {
    setGeoBusy(true);
    setGeoNote(null);
    const g = await tryGeo();
    setGeoBusy(false);
    if (!g) {
      setGeoNote("Couldn't get your location. Allow location access in your browser, or type the coordinates in.");
      return;
    }
    setForm((f) => ({ ...f, lat: g.lat.toFixed(6), lng: g.lng.toFixed(6) }));
    setGeoNote(
      `Location set (accurate to about ${g.accuracyM} m). Check it on the map: it should be near the middle of the complex.`,
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setError(null);
    const missingText = (
      ["societyName", "city", "address", "lat", "lng", "radius", "towerName", "flatNo", "committeeRole"] as const
    ).some((k) => !form[k].trim());
    const missingDoc = Object.values(docs).some((d) => !d.file);
    if (missingText || missingDoc || latErr || lngErr || radiusErr || Object.values(errs).some(Boolean)) {
      setError("Fix the highlighted fields first.");
      return;
    }
    try {
      setBusy("upload");
      const keys = await uploadDocs(docs, (k, key) => setDocs((d) => ({ ...d, [k]: { ...d[k], key } })));
      setBusy("send");
      const statement = form.statement.trim();
      await createAdminRequest({
        kind: "new_society",
        societyName: form.societyName.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        centerLat: lat,
        centerLng: lng,
        radiusM: radius,
        towerName: form.towerName.trim(),
        flatNo: form.flatNo.trim(),
        occupancy,
        committeeRole: form.committeeRole.trim(),
        ...(statement ? { statement } : {}),
        docs: keys,
      });
      router.push("/admin-requests?submitted=1");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (mine.loading && !mine.data) return <Loading />;

  if (pending) {
    return (
      <div className="mx-auto max-w-lg">
        <Panel className="text-center">
          <Clock className="mx-auto size-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-semibold">Your registration is under review</h1>
          <p className="mt-2 text-sm text-fg-muted">
            BorrowVault is checking the documents for <span className="font-medium text-fg">{pending.societyName}</span>.
            You can have one society registration open at a time.
          </p>
          <Link href="/admin-requests" className="mt-5 inline-block">
            <Button>See my requests</Button>
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Register your society"
        subtitle="For RWA and committee members. BorrowVault checks your documents, then opens your society and makes you its first admin."
      />

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Panel className="space-y-4">
          <h2 className="font-semibold">Your society</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Society name" htmlFor="sname" error={errs.societyName ?? required(form.societyName)}>
              <Input id="sname" maxLength={120} placeholder="e.g. Prestige Lakeside Habitat" value={form.societyName} onChange={set("societyName")} />
            </Field>
            <Field label="City" htmlFor="city" error={errs.city ?? required(form.city)}>
              <Input id="city" maxLength={80} value={form.city} onChange={set("city")} />
            </Field>
          </div>
          <Field label="Address" htmlFor="addr" error={errs.address ?? required(form.address)}>
            <Textarea id="addr" maxLength={500} rows={2} value={form.address} onChange={set("address")} />
          </Field>

          <div className="rounded-xl border border-line bg-zinc-50/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <MapPin className="size-4 text-accent" /> Where is it?
              </p>
              <Button type="button" size="sm" variant="outline" onClick={useMyLocation} disabled={geoBusy}>
                {geoBusy ? <Loader2 className="animate-spin" /> : <Crosshair />} Use my current location
              </Button>
            </div>
            <p className="mb-3 text-xs text-fg-muted">
              Stand near the middle of the complex and tap the button, or paste the coordinates from Google Maps. The radius
              should cover the whole campus: handover and return photos are checked against this circle to confirm they were
              taken inside the society.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Centre latitude" htmlFor="lat" error={latErr ?? required(form.lat)}>
                <Input id="lat" inputMode="decimal" placeholder="12.971599" value={form.lat} onChange={set("lat")} />
              </Field>
              <Field label="Centre longitude" htmlFor="lng" error={lngErr ?? required(form.lng)}>
                <Input id="lng" inputMode="decimal" placeholder="77.594566" value={form.lng} onChange={set("lng")} />
              </Field>
              <Field label="Radius (m)" htmlFor="rad" error={radiusErr ?? required(form.radius)} hint="300 m suits most complexes.">
                <Input id="rad" inputMode="numeric" value={form.radius} onChange={set("radius")} />
              </Field>
            </div>
            {geoNote ? <p className="mt-2 text-xs text-fg-muted">{geoNote}</p> : null}
            {coordsOk ? (
              <a
                href={mapsUrl(lat, lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-accent hover:underline"
              >
                Check this point on Google Maps
              </a>
            ) : null}
          </div>
        </Panel>

        <Panel className="space-y-4">
          <h2 className="font-semibold">You</h2>
          <p className="text-sm text-fg-muted">
            Admins are residents too: once approved, you&apos;re also a member of your own flat.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tower / block" htmlFor="tower" error={errs.towerName ?? required(form.towerName)}>
              <Input id="tower" maxLength={60} placeholder="e.g. Tower A" value={form.towerName} onChange={set("towerName")} />
            </Field>
            <Field label="Flat number" htmlFor="flat" error={errs.flatNo ?? required(form.flatNo)}>
              <Input id="flat" maxLength={20} placeholder="e.g. 1204" value={form.flatNo} onChange={set("flatNo")} />
            </Field>
          </div>
          <Field label="You live here as">
            <div className="flex flex-wrap gap-2">
              {(["owner", "tenant", "family"] as const).map((o) => (
                <label
                  key={o}
                  className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm capitalize ${occupancy === o ? "border-accent bg-emerald-50 text-accent" : "border-line"}`}
                >
                  <input type="radio" className="sr-only" name="occ" checked={occupancy === o} onChange={() => setOccupancy(o)} />
                  {o === "family" ? "Family member" : o}
                </label>
              ))}
            </div>
          </Field>
          <Field
            label="Your role on the committee"
            htmlFor="role"
            error={errs.committeeRole ?? required(form.committeeRole)}
            hint="e.g. Secretary, President, Treasurer, Committee member."
          >
            <Input id="role" maxLength={60} value={form.committeeRole} onChange={set("committeeRole")} />
          </Field>
          <Field
            label="Anything we should know? (optional)"
            htmlFor="stmt"
            error={errs.statement}
            hint={`${form.statement.trim().length}/1000. e.g. how many flats, or who else on the committee will help.`}
          >
            <Textarea id="stmt" maxLength={1000} rows={3} value={form.statement} onChange={set("statement")} />
          </Field>
        </Panel>

        <Panel className="space-y-4">
          <div>
            <h2 className="font-semibold">Documents</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Only BorrowVault&apos;s verification team can open these. Your neighbours and other admins never see them.
            </p>
          </div>
          <DocPicker kind="rwaRegistration" slot={docs.rwaRegistrationKey} onPick={setDoc("rwaRegistrationKey")} showMissing={tried} />
          <DocPicker kind="authorization" slot={docs.authorizationKey} onPick={setDoc("authorizationKey")} showMissing={tried} />
          <DocPicker kind="idProof" slot={docs.idProofKey} onPick={setDoc("idProofKey")} showMissing={tried} />
        </Panel>

        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!!busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy === "upload" ? "Uploading documents…" : busy === "send" ? "Sending…" : "Send for verification"}
          </Button>
          <Link href="/admin-requests" className="text-sm text-fg-muted hover:text-fg hover:underline">
            My requests
          </Link>
        </div>
      </form>
    </div>
  );
}
