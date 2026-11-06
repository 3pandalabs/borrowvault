"use client";

import { Flag, ImageOff, Info, Loader2, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import * as api from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Conversation, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorText, Panel, PanelTitle } from "./common";
import { Button, type ButtonProps } from "./ui/button";
import { Textarea } from "./ui/input";

/** Server limits (ROUTES.md "Chat"), counted in Unicode code points after trimming. */
export const MESSAGE_MAX = 2000;
export const REPORT_MIN = 5;
export const REPORT_MAX = 500;

export const codePoints = (s: string) => Array.from(s).length;

export const CHAT_NOTICE = "Messages can't be edited or deleted. If there's a dispute, your society admin can read this chat.";

export function ChatNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-fg-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" /> {CHAT_NOTICE}
    </p>
  );
}

/** Listing cover thumbnail with a placeholder. */
export function Cover({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- presigned URL
    <img src={url} alt="" className={cn("size-12 shrink-0 rounded-xl object-cover", className)} />
  ) : (
    <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100", className)}>
      <ImageOff className="size-5 text-zinc-300" />
    </div>
  );
}

/**
 * One message. The body is rendered as a plain React text node: no HTML, no
 * links, newlines preserved by CSS.
 */
export function MessageBubble({
  m,
  mine,
  name,
  highlight,
  footer,
}: {
  m: Message;
  mine: boolean;
  /** Shown above the bubble when set (admin views, where neither side is "me"). */
  name?: string;
  highlight?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {name ? <span className="mb-0.5 px-1 text-xs font-medium text-fg-muted">{name}</span> : null}
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm [overflow-wrap:anywhere]",
          mine ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-zinc-100 text-fg",
          highlight ? "bg-amber-100 ring-2 ring-amber-400" : "",
        )}
      >
        {m.body}
      </div>
      <div className="mt-0.5 flex items-center gap-2 px-1 text-xs text-fg-muted">
        <time dateTime={m.createdAt}>{formatIST(m.createdAt)}</time>
        {footer}
      </div>
    </li>
  );
}

/** "Ask a question" (listing) / "Message X" (booking): open or create the chat, then go there. */
export function OpenChatButton({
  open,
  children,
  ...props
}: { open: () => Promise<Conversation> } & Omit<ButtonProps, "onClick">) {
  const router = useRouter();
  const action = useAction();
  return (
    <div className="space-y-2">
      <Button
        {...props}
        disabled={action.busy || props.disabled}
        onClick={() =>
          action.run(async () => {
            const c = await open();
            router.push(`/messages/${c.id}`);
          }, api.errorMessage)
        }
      >
        {action.busy ? <Loader2 className="animate-spin" /> : <MessageCircle />} {children}
      </Button>
      <ErrorText>{action.error}</ErrorText>
    </div>
  );
}

/**
 * Admin arbitration view: the parties' chat, read-only. Admins only get it via
 * BookingDetail.conversationId (null = the parties never chatted).
 */
export function ChatHistoryPanel({ conversationId }: { conversationId: string | null }) {
  return (
    <Panel>
      <PanelTitle>Chat history</PanelTitle>
      {conversationId ? (
        <>
          <p className="mb-3 text-sm text-fg-muted">
            Everything the lender and borrower wrote to each other about this listing. Read-only; messages can&apos;t be edited or
            deleted.
          </p>
          <Link href={`/messages/${conversationId}`}>
            <Button variant="outline" className="w-full">
              <MessageCircle /> Read the chat
            </Button>
          </Link>
        </>
      ) : (
        <p className="text-sm text-fg-muted">The parties never chatted.</p>
      )}
    </Panel>
  );
}

/** Reason dialog for reporting the other participant's message. */
export function ReportDialog({
  message,
  authorName,
  onClose,
  onReported,
}: {
  message: Message;
  authorName: string;
  onClose: () => void;
  onReported: (messageId: string) => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const action = useAction();
  const len = codePoints(reason.trim());
  const valid = len >= REPORT_MIN && len <= REPORT_MAX;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !action.busy) onClose();
      }}
    >
      <Panel role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            <Flag className="size-4" /> Report this message
          </h2>
          <button aria-label="Close" className="rounded-full p-1 text-fg-muted hover:bg-zinc-100" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <blockquote className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-zinc-50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
          <span className="mb-1 block text-xs text-fg-muted">
            {authorName} · {formatIST(message.createdAt)}
          </span>
          {message.body}
        </blockquote>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            action.run(async () => {
              try {
                await api.reportMessage(message.id, reason.trim());
              } catch (err) {
                // Already reported by you: same end state.
                if (!(err instanceof api.ApiError && err.message === "already_reported")) throw err;
              }
              onReported(message.id);
            }, api.errorMessage);
          }}
        >
          <label htmlFor={`${titleId}-reason`} className="text-sm font-medium text-zinc-700">
            What&apos;s wrong with it?
          </label>
          <Textarea
            id={`${titleId}-reason`}
            rows={4}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="E.g. abusive language, asking to pay outside the booking"
          />
          <p className={cn("text-xs", len > REPORT_MAX ? "text-red-600" : "text-fg-muted")}>
            {len < REPORT_MIN
              ? `At least ${REPORT_MIN} characters.`
              : `${len}/${REPORT_MAX}.`}{" "}
            Your society admin sees this message, a few around it, and your reason. Nothing is hidden or deleted.
          </p>
          <ErrorText>{action.error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={action.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={action.busy || !valid}>
              {action.busy ? <Loader2 className="animate-spin" /> : <Flag />} Report
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
