"use client";

import { Building2, CalendarClock, Clock, Package, Plus, Search, Wallet } from "lucide-react";
import Link from "next/link";
import { BookingRow } from "@/components/bookings";
import { EmptyState, Loading, PageHeader, Panel, PanelTitle, TrustBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listBookings } from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";

const STATUS_VARIANT = { pending: "warn", approved: "good", rejected: "bad", revoked: "muted" } as const;

export default function HomePage() {
  const { user, memberships, approved } = useSession();
  const bookings = useAsync(() => listBookings(), approved.length ? "bookings" : null);
  const needsMe = (bookings.data ?? []).filter((b) => b.nextAction && !b.nextAction.startsWith("wait_"));

  return (
    <>
      <PageHeader
        title={`Hi, ${user.displayName.split(" ")[0]}`}
        subtitle={<span className="inline-flex items-center gap-2">Your trust score <TrustBadge trust={user.trust} /></span>}
        actions={
          approved.length ? (
            <>
              <Link href="/listings">
                <Button variant="outline">
                  <Search /> Browse
                </Button>
              </Link>
              <Link href="/listings/new">
                <Button>
                  <Plus /> List something
                </Button>
              </Link>
            </>
          ) : null
        }
      />

      {!user.upiVpa && approved.length ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <Wallet className="size-4" /> Add your UPI ID before you lend. Borrowers pay you straight to it.
          </span>
          <Link href="/profile">
            <Button size="sm" variant="outline">
              Add UPI ID
            </Button>
          </Link>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {approved.length ? (
            <Panel>
              <PanelTitle aside={<Link href="/bookings" className="text-sm text-accent hover:underline">All bookings</Link>}>
                Needs your attention
              </PanelTitle>
              {bookings.loading && !bookings.data ? (
                <Loading />
              ) : needsMe.length ? (
                <div className="divide-y divide-line">
                  {needsMe.map((b) => (
                    <BookingRow key={b.id} booking={b} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<CalendarClock />}
                  title="Nothing waiting on you"
                  body="When a neighbour requests your item, or a booking needs your payment or review, it shows up here."
                  action={
                    <Link href="/listings">
                      <Button size="sm">Find something to borrow</Button>
                    </Link>
                  }
                />
              )}
            </Panel>
          ) : (
            <Panel>
              <PanelTitle>Get started</PanelTitle>
              {memberships.some((m) => m.status === "pending") ? (
                <EmptyState
                  icon={<Clock />}
                  title="Waiting for your society admin"
                  body="They check your proof against your flat. Meanwhile, add your UPI ID so you can lend from day one."
                  action={
                    <Link href="/profile">
                      <Button size="sm">Complete your profile</Button>
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Building2 />}
                  title="Join your society"
                  body="Find your society, pick your tower and flat, and upload a proof of residence."
                  action={
                    <Link href="/onboarding">
                      <Button size="sm">Join a society</Button>
                    </Link>
                  }
                />
              )}
            </Panel>
          )}
        </div>

        <Panel>
          <PanelTitle
            aside={
              <Link href="/onboarding" className="text-sm text-accent hover:underline">
                Join another
              </Link>
            }
          >
            Your societies
          </PanelTitle>
          {memberships.length ? (
            <ul className="space-y-3">
              {memberships.map((m) => (
                <li key={m.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{m.societyName}</p>
                      <p className="text-sm text-fg-muted">
                        {m.towerName} · {m.flatNo} · {m.occupancy}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">Requested {formatIST(m.createdAt, { time: false })}</p>
                  {m.status === "rejected" || m.status === "revoked" ? (
                    <Link href="/onboarding" className="mt-2 inline-block text-sm text-accent hover:underline">
                      Apply again with a new proof
                    </Link>
                  ) : null}
                  {m.role === "society_admin" && m.status === "approved" ? (
                    <Link href={`/admin/${m.societyId}`} className="mt-2 inline-block text-sm text-accent hover:underline">
                      Open admin console
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Package />}
              title="No societies yet"
              action={
                <Link href="/onboarding">
                  <Button size="sm">Join a society</Button>
                </Link>
              }
            />
          )}
        </Panel>
      </div>
    </>
  );
}
