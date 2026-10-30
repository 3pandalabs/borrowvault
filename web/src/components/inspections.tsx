"use client";

import { AlertTriangle, MapPin, MapPinOff, Smartphone } from "lucide-react";
import { useState } from "react";
import { formatIST } from "@/lib/format";
import type { ChecklistAnswer, ChecklistItem, Inspection, Media as MediaT, InspectionPhase } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

export function answerText(item: ChecklistItem, a: ChecklistAnswer | undefined): string {
  if (!a) return "—";
  let v: string;
  if (item.type === "bool") v = a.ok === undefined ? "—" : a.ok ? "Yes" : "No";
  else if (item.type === "percent") v = a.value === undefined ? "—" : `${a.value}%`;
  else v = a.value === undefined || a.value === "" ? (a.ok === undefined ? "—" : a.ok ? "OK" : "Not OK") : String(a.value);
  return a.note ? `${v} · "${a.note}"` : v;
}

function answerKey(a: ChecklistAnswer | undefined) {
  return a ? `${a.ok ?? ""}|${a.value ?? ""}` : "";
}

function Media({ m, className }: { m: MediaT | undefined; className?: string }) {
  if (!m) {
    return (
      <div className={cn("flex aspect-[4/3] items-center justify-center rounded-lg bg-zinc-100 text-xs text-fg-muted", className)}>
        No photo
      </div>
    );
  }
  const flags =
    m.noLocation || !m.withinGeofence || m.clockSkewFlag ? (
      <span className="mt-1 flex flex-wrap gap-1">
        {m.noLocation ? <Badge variant="warn">No location</Badge> : !m.withinGeofence ? <Badge variant="bad">Outside geofence</Badge> : null}
        {m.clockSkewFlag ? <Badge variant="warn">Clock skew</Badge> : null}
      </span>
    ) : null;
  return (
    <div>
      {m.mime.startsWith("video/") ? (
        <video src={m.url} controls className={cn("aspect-[4/3] w-full rounded-lg bg-black object-contain", className)} />
      ) : (
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- 10-minute presigned URL */}
          <img src={m.url} alt={m.slot} className={cn("aspect-[4/3] w-full rounded-lg bg-zinc-100 object-cover", className)} />
        </a>
      )}
      {flags}
    </div>
  );
}

/** Evidence photos (dispute media, ack objection photos) as a small grid. */
export function MediaGrid({ media }: { media: MediaT[] }) {
  if (!media.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {media.map((m) => (
        <figure key={m.id}>
          <Media m={m} />
          <figcaption className="mt-1 text-xs text-fg-muted">
            {m.slot} · {formatIST(m.receivedAt)}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function GeoStamp({ insp }: { insp: Inspection }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-fg-muted">
      {insp.noLocation ? (
        <Badge variant="warn">
          <MapPinOff className="size-3" /> No location
        </Badge>
      ) : insp.withinGeofence ? (
        <Badge variant="good">
          <MapPin className="size-3" /> Inside society
        </Badge>
      ) : (
        <Badge variant="bad">
          <MapPinOff className="size-3" /> Outside geofence
        </Badge>
      )}
      {formatIST(insp.submittedAt)}
    </span>
  );
}

export function CaptureInApp({ phase }: { phase: InspectionPhase }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      <Smartphone className="mt-0.5 size-5 shrink-0" />
      <div>
        <p className="font-medium">Use the BorrowVault app to capture {phase} photos</p>
        <p className="mt-1">
          Inspection photos are taken in the app&apos;s camera, inside the society, so they can&apos;t be swapped for older pictures.
          Open this booking in the app on your phone. You can still review and respond to the other side&apos;s inspection here.
        </p>
      </div>
    </div>
  );
}

function AckLine({ ack }: { ack: NonNullable<Inspection["ack"]> }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        <Badge variant={ack.result === "agreed" ? "good" : "bad"}>{ack.result}</Badge>{" "}
        <span className="text-fg-muted">
          by the other side, {formatIST(ack.at)}
          {ack.note ? ` · "${ack.note}"` : ""}
        </span>
      </p>
      <MediaGrid media={ack.media ?? []} />
    </div>
  );
}

/** One inspection, read-only. */
export function InspectionView({ insp, checklist }: { insp: Inspection; checklist: ChecklistItem[] }) {
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium capitalize">
          {insp.phase} · by {insp.party}
        </p>
        <GeoStamp insp={insp} />
      </div>
      {insp.media.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {insp.media.map((m) => (
            <figure key={m.id}>
              <Media m={m} />
              <figcaption className="mt-1 text-xs text-fg-muted">{m.slot}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {checklist.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {checklist.map((c) => (
            <div key={c.id} className="contents">
              <dt className="text-fg-muted">{c.label}</dt>
              <dd>{answerText(c, insp.checklistAnswers[c.id])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {insp.ack ? <AckLine ack={insp.ack} /> : null}
    </div>
  );
}

function pick(inspections: Inspection[], phase: InspectionPhase, preferParty: string) {
  const list = inspections.filter((i) => i.phase === phase);
  return list.find((i) => i.party === preferParty) ?? list[0] ?? null;
}

/**
 * Handover vs return, side by side per photo slot, with checklist differences
 * highlighted (blueprint §6.3 / §6.4). Used by the lender's return review and
 * by the admin arbitration view.
 */
export function Comparison({
  inspections,
  checklist,
  slots,
}: {
  inspections: Inspection[];
  checklist: ChecklistItem[];
  slots: string[];
}) {
  const handovers = inspections.filter((i) => i.phase === "handover");
  const returns = inspections.filter((i) => i.phase === "return");
  const [hId, setHId] = useState<string | null>(null);
  const [rId, setRId] = useState<string | null>(null);
  const h = handovers.find((i) => i.id === hId) ?? pick(inspections, "handover", "lender");
  const r = returns.find((i) => i.id === rId) ?? pick(inspections, "return", "borrower");

  const allSlots = Array.from(new Set([...slots, ...(h?.media ?? []).map((m) => m.slot), ...(r?.media ?? []).map((m) => m.slot)]));
  const diffs = checklist.filter((c) => h && r && answerKey(h.checklistAnswers[c.id]) !== answerKey(r.checklistAnswers[c.id]));

  const chooser = (list: Inspection[], value: Inspection | null, onChange: (id: string) => void) =>
    list.length > 1 ? (
      <select
        aria-label="Which inspection"
        className="ml-2 rounded border border-line bg-white px-1 text-xs"
        value={value?.id}
        onChange={(e) => onChange(e.target.value)}
      >
        {list.map((i) => (
          <option key={i.id} value={i.id}>
            by {i.party}
          </option>
        ))}
      </select>
    ) : null;

  if (!h && !r) return <p className="text-sm text-fg-muted">No inspections submitted yet.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-zinc-50 p-2">
          <p className="font-medium">
            Handover{h ? ` · by ${h.party}` : ""}
            {chooser(handovers, h, setHId)}
          </p>
          {h ? <GeoStamp insp={h} /> : <p className="text-xs text-fg-muted">Not submitted</p>}
        </div>
        <div className="rounded-lg bg-zinc-50 p-2">
          <p className="font-medium">
            Return{r ? ` · by ${r.party}` : ""}
            {chooser(returns, r, setRId)}
          </p>
          {r ? <GeoStamp insp={r} /> : <p className="text-xs text-fg-muted">Not submitted</p>}
        </div>
      </div>

      {allSlots.map((slot) => (
        <div key={slot}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">{slot}</p>
          <div className="grid grid-cols-2 gap-3">
            <Media m={h?.media.find((m) => m.slot === slot)} />
            <Media m={r?.media.find((m) => m.slot === slot)} />
          </div>
        </div>
      ))}

      {checklist.length ? (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Checklist</th>
                <th className="px-3 py-2 font-medium">Handover</th>
                <th className="px-3 py-2 font-medium">Return</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((c) => {
                const changed = diffs.includes(c);
                return (
                  <tr key={c.id} className={cn("border-t border-line", changed && "bg-amber-50")}>
                    <td className="px-3 py-2 text-fg-muted">{c.label}</td>
                    <td className="px-3 py-2">{answerText(c, h?.checklistAnswers[c.id])}</td>
                    <td className={cn("px-3 py-2", changed && "font-medium text-amber-800")}>
                      {answerText(c, r?.checklistAnswers[c.id])}
                      {changed ? <AlertTriangle className="ml-1 inline size-3.5" /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {h && r ? (
        <p className="text-sm text-fg-muted">
          {diffs.length ? `${diffs.length} checklist ${diffs.length === 1 ? "difference" : "differences"} highlighted.` : "No checklist differences."}
        </p>
      ) : null}
      {h?.ack ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Handover acknowledgement</p>
          <AckLine ack={h.ack} />
        </div>
      ) : null}
      {r?.ack ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Lender&apos;s review of the return</p>
          <AckLine ack={r.ack} />
        </div>
      ) : null}
    </div>
  );
}
