"use client";

import { AlertTriangle, Loader2, ShieldCheck, Star } from "lucide-react";
import Link from "next/link";
import { errorMessage } from "@/lib/api";
import type { BookingState, Trust } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "./ui/badge";
import { Button } from "./ui/button";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-fg-muted" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  );
}

/** A load failure always offers a retry, never a dead end. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="my-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      <p className="flex items-center gap-2">
        <AlertTriangle className="size-4" /> {errorMessage(error)}
      </p>
      <div className="mt-3 flex gap-2">
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Link href="/home">
          <Button size="sm" variant="ghost">
            Go home
          </Button>
        </Link>
      </div>
    </div>
  );
}

/** Empty states must always offer the next action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white/70 px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-fg-muted [&_svg]:size-8">{icon}</div> : null}
      <p className="font-medium text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-md text-sm text-fg-muted">{body}</p> : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>
    </div>
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("rounded-2xl border border-line bg-white p-5 shadow-sm", className)} {...props} />;
}

export function PanelTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-fg">{children}</h2>
      {aside}
    </div>
  );
}

export function TrustBadge({ trust, compact }: { trust?: Trust | null; compact?: boolean }) {
  if (!trust) return null;
  const variant: BadgeVariant = trust.completed === 0 ? "muted" : trust.score >= 4 ? "good" : trust.score >= 3 ? "info" : "warn";
  return (
    <Badge variant={variant} title={`${trust.completed} completed · ${trust.disputesLost} disputes lost`}>
      {trust.completed === 0 ? <ShieldCheck className="size-3" /> : <Star className="size-3 fill-current" />}
      {trust.completed === 0 ? "New neighbour" : trust.score.toFixed(1)}
      {!compact && trust.completed > 0 ? <span className="opacity-70">({trust.completed})</span> : null}
    </Badge>
  );
}

const STATE_LABEL: Record<BookingState, [string, BadgeVariant]> = {
  REQUESTED: ["Requested", "info"],
  ACCEPTED: ["Accepted · awaiting payment", "info"],
  DEPOSIT_HELD: ["Paid", "good"],
  HANDOVER_PENDING: ["Handover due", "warn"],
  ACTIVE: ["In use", "good"],
  OVERDUE: ["Overdue", "bad"],
  RETURN_PENDING: ["Return under review", "warn"],
  COMPLETED: ["Completed", "muted"],
  DISPUTED: ["Disputed", "bad"],
  RESOLVED: ["Resolved", "muted"],
  DECLINED: ["Declined", "muted"],
  EXPIRED: ["Expired", "muted"],
  CANCELLED: ["Cancelled", "muted"],
};

export function StateBadge({ state }: { state: BookingState }) {
  const [label, variant] = STATE_LABEL[state] ?? [state, "muted"];
  return <Badge variant={variant}>{label}</Badge>;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none text-zinc-700">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}

export const selectClass =
  "flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 md:text-sm";
