"use client";

import { CheckCircle2, Clock, FileUp, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorText, Field, PageHeader, Panel, selectClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, getTowers, joinSociety, searchSocieties, uploadFile } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Membership, Occupancy, SocietySearchResult } from "@/lib/types";

const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const PROOF_MAX = 10 * 1024 * 1024;

export default function OnboardingPage() {
  const { refresh } = useSession();
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState<string | null>(null);
  const results = useAsync(() => searchSocieties(submittedQ ?? ""), submittedQ === null ? null : `s:${submittedQ}`);
  const [society, setSociety] = useState<SocietySearchResult | null>(null);
  const towers = useAsync(() => getTowers(society!.id), society ? `t:${society.id}` : null);

  const [towerId, setTowerId] = useState("");
  const [flatNo, setFlatNo] = useState("");
  const [occupancy, setOccupancy] = useState<Occupancy>("owner");
  const [inviteCode, setInviteCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Membership | null>(null);

  function pickFile(f: File | null) {
    setFileError(null);
    if (!f) return setFile(null);
    if (!PROOF_TYPES.includes(f.type)) return setFileError("Use a PDF, JPEG or PNG.");
    if (f.size > PROOF_MAX) return setFileError("That file is over 10 MB.");
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!society) return;
    if (!file && !inviteCode.trim()) {
      setError("Upload a proof of residence, or enter the invite code your society admin shared.");
      return;
    }
    setError(null);
    try {
      let proofKey: string | undefined;
      if (file) {
        setBusy("upload");
        proofKey = await uploadFile("proof", file);
      }
      setBusy("join");
      const m = await joinSociety(society.id, {
        towerId,
        flatNo: flatNo.trim(),
        occupancy,
        inviteCode: inviteCode.trim() || undefined,
        proofKey,
      });
      setDone(m);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <Panel className="text-center">
          <Clock className="mx-auto size-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-semibold">Pending approval</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Your request to join <span className="font-medium text-fg">{done.societyName}</span> as {done.towerName} ·{" "}
            {done.flatNo} is with your society admin. You&apos;ll be able to browse and lend once they approve it.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/profile">
              <Button>Add your UPI ID meanwhile</Button>
            </Link>
            <Link href="/home">
              <Button variant="outline">Go to home</Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Join your society" subtitle="Your society admin approves every resident against a real flat." />

      <Panel className="mb-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs text-accent-fg">1</span>
          Find your society
        </h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQ(q.trim());
          }}
        >
          <Input placeholder="Society name or city" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="dark" disabled={!q.trim()}>
            <Search /> Search
          </Button>
        </form>
        {results.loading ? <p className="mt-3 text-sm text-fg-muted">Searching…</p> : null}
        {results.error ? <ErrorText>{errorMessage(results.error)}</ErrorText> : null}
        {results.data && !results.loading ? (
          results.data.length ? (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {results.data.map((s) => (
                <li key={s.id}>
                  <button
                    className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 ${society?.id === s.id ? "bg-emerald-50" : ""}`}
                    onClick={() => {
                      setSociety(s);
                      setTowerId("");
                    }}
                  >
                    <span>
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-2 text-sm text-fg-muted">{s.city}</span>
                    </span>
                    {society?.id === s.id ? <CheckCircle2 className="size-4 text-accent" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <EmptyState
                title="No live society matches that"
                body="BorrowVault opens one society at a time. Ask your society committee to write to 3PandaLabs to get yours set up, or try a different spelling."
                action={
                  <a href="mailto:hello@3pandalabs.com?subject=BorrowVault%20for%20our%20society">
                    <Button size="sm" variant="outline">
                      Request your society
                    </Button>
                  </a>
                }
              />
            </div>
          )
        ) : null}
      </Panel>

      {society ? (
        <Panel>
          <form onSubmit={submit} className="space-y-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs text-accent-fg">2</span>
              Your flat in {society.name}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tower / block" htmlFor="tower">
                <select id="tower" required className={selectClass} value={towerId} onChange={(e) => setTowerId(e.target.value)}>
                  <option value="" disabled>
                    {towers.loading ? "Loading…" : "Choose…"}
                  </option>
                  {(towers.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {towers.data && towers.data.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    This society has no towers set up yet. Ask your society admin to add yours.
                  </p>
                ) : null}
              </Field>
              <Field label="Flat number" htmlFor="flat">
                <Input id="flat" required placeholder="e.g. 1204" value={flatNo} onChange={(e) => setFlatNo(e.target.value)} />
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

            <Field label="Invite code (optional)" htmlFor="invite" hint="8 characters, from your society's WhatsApp group or notice board.">
              <Input
                id="invite"
                maxLength={8}
                className="font-mono uppercase"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              />
            </Field>

            <Field
              label="Proof of residence"
              hint="Maintenance bill, rent agreement, allotment letter or electricity bill showing your flat. PDF, JPEG or PNG, up to 10 MB. Only your society admin sees it."
              error={fileError}
            >
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-sm hover:bg-zinc-100">
                <FileUp className="size-5 text-fg-muted" />
                <span className="truncate">{file ? file.name : "Choose a file"}</span>
                <input
                  type="file"
                  accept={PROOF_TYPES.join(",")}
                  className="sr-only"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </Field>

            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full sm:w-auto" disabled={!!busy || !towerId || !flatNo.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy === "upload" ? "Uploading proof…" : busy === "join" ? "Sending…" : "Request to join"}
            </Button>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
