"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RequireApproved } from "@/components/AppShell";
import { BookingRow } from "@/components/bookings";
import { EmptyState, LoadError, Loading, PageHeader, Panel, selectClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { listBookings } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { BookingState } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATES: BookingState[] = [
  "REQUESTED",
  "ACCEPTED",
  "DEPOSIT_HELD",
  "HANDOVER_PENDING",
  "ACTIVE",
  "OVERDUE",
  "RETURN_PENDING",
  "DISPUTED",
  "COMPLETED",
  "RESOLVED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
];

export default function BookingsPage() {
  return (
    <RequireApproved>
      <Suspense fallback={<Loading />}>
        <Bookings />
      </Suspense>
    </RequireApproved>
  );
}

function Bookings() {
  const initialRole = useSearchParams().get("role");
  const [role, setRole] = useState<"" | "lender" | "borrower">(
    initialRole === "lender" || initialRole === "borrower" ? initialRole : "",
  );
  const [state, setState] = useState<BookingState | "">("");
  const list = useAsync(() => listBookings({ role: role || undefined, state }), `${role}|${state}`);
  const rows = list.data ?? [];
  // Bookings waiting on me first, then the rest by start time.
  const sorted = [...rows].sort((a, b) => {
    const am = a.nextAction && !a.nextAction.startsWith("wait_") ? 0 : 1;
    const bm = b.nextAction && !b.nextAction.startsWith("wait_") ? 0 : 1;
    return am - bm || b.startsAt.localeCompare(a.startsAt);
  });

  return (
    <>
      <PageHeader title="My bookings" subtitle="Everything you're borrowing and lending." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["", "All"],
            ["borrower", "Borrowing"],
            ["lender", "Lending"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setRole(v)}
            className={cn("rounded-full border px-4 py-1.5 text-sm", role === v ? "border-accent bg-emerald-50 text-accent" : "border-line bg-white")}
          >
            {l}
          </button>
        ))}
        <select aria-label="State" className={cn(selectClass, "ml-auto w-auto")} value={state} onChange={(e) => setState(e.target.value as BookingState | "")}>
          <option value="">Any state</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={state || role ? "No bookings match" : "No bookings yet"}
          body={
            role === "lender"
              ? "List something and requests from neighbours will appear here."
              : "Find something a neighbour is lending and send a request."
          }
          action={
            <>
              {state || role ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRole("");
                    setState("");
                  }}
                >
                  Show all
                </Button>
              ) : null}
              <Link href={role === "lender" ? "/listings/new" : "/listings"}>
                <Button size="sm">{role === "lender" ? "List something" : "Browse listings"}</Button>
              </Link>
            </>
          }
        />
      ) : (
        <Panel className="py-2">
          <div className="divide-y divide-line">
            {sorted.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
