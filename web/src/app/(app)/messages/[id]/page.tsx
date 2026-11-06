"use client";

import { ArrowLeft, Flag, Loader2, Lock, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatNotice, codePoints, Cover, MESSAGE_MAX, MessageBubble, ReportDialog } from "@/components/chat";
import { ErrorText, LoadError, Loading, Panel, StateBadge, TrustBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import * as api from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Conversation, Message } from "@/lib/types";
import { refreshUnread } from "@/lib/unread";
import { cn } from "@/lib/utils";

const POLL_MS = 5_000;
/** Show the character counter once the draft gets this close to the limit. */
const COUNTER_FROM = MESSAGE_MAX - 200;

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const conv = useAsync(() => api.getConversation(id), `conversation:${id}`);

  if (conv.error)
    return (
      <>
        <BackLink href="/messages" label="All messages" />
        <LoadError error={conv.error} onRetry={conv.reload} />
      </>
    );
  if (!conv.data) return <Loading />;
  return <Chat key={id} c={conv.data} reload={conv.reload} />;
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}

// ---------- message loading + polling ----------

type ThreadState = { loaded: boolean; error: unknown; messages: Message[]; olderHasMore: boolean };

const appendNew = (have: Message[], incoming: Message[]) => {
  const ids = new Set(have.map((m) => m.id));
  return [...have, ...incoming.filter((m) => !ids.has(m.id))];
};

/**
 * Messages in SERVER order (never re-sorted by createdAt). `messages` only ever
 * holds what pages/polls returned; a message we just sent sits in `pending`
 * until a poll returns it in its real position, so a reply the other side sent
 * a moment earlier can never end up below ours.
 */
function useThread(conversationId: string) {
  const [state, setState] = useState<ThreadState>({ loaded: false, error: null, messages: [], olderHasMore: false });
  const [pending, setPending] = useState<Message[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [older, setOlder] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const newest = useRef<string | null>(null);
  const pollNow = useRef<() => void>(() => undefined);

  // Newest page first.
  useEffect(() => {
    let alive = true;
    api.getMessages(conversationId).then(
      (r) => {
        if (!alive) return;
        newest.current = r.messages.at(-1)?.id ?? null;
        setState({ loaded: true, error: null, messages: r.messages, olderHasMore: r.hasMore });
      },
      (error) => alive && setState((s) => ({ ...s, error })),
    );
    return () => {
      alive = false;
    };
  }, [conversationId, attempt]);

  // Poll `after=<newest>` every 5 s while the tab is visible; loop at once while hasMore.
  useEffect(() => {
    if (!state.loaded) return;
    let alive = true;
    let timer: number | undefined;
    let running = false;
    let again = false;
    const visible = () => document.visibilityState === "visible";

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      window.clearTimeout(timer);
      try {
        do {
          again = false;
          let more = true;
          while (alive && more && visible()) {
            const after = newest.current;
            const r = await api.getMessages(conversationId, after ? { after } : {});
            if (!alive) return;
            more = !!after && r.hasMore;
            if (!r.messages.length) continue;
            newest.current = r.messages[r.messages.length - 1].id;
            const got = new Set(r.messages.map((m) => m.id));
            setState((s) =>
              after
                ? { ...s, messages: appendNew(s.messages, r.messages) }
                : // Was empty: this is the newest page.
                  { ...s, messages: r.messages, olderHasMore: r.hasMore },
            );
            setPending((p) => p.filter((m) => !got.has(m.id)));
          }
        } while (alive && again);
      } catch {
        // Transient (offline, deploy): the next tick retries.
      } finally {
        running = false;
        // Hidden tabs stop here; becoming visible restarts the loop.
        if (alive && visible()) timer = window.setTimeout(run, POLL_MS);
      }
    };

    timer = window.setTimeout(run, POLL_MS);
    pollNow.current = () => void run();
    const onVisibility = () => {
      if (visible()) void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      pollNow.current = () => undefined;
    };
  }, [conversationId, state.loaded]);

  const firstId = state.messages[0]?.id;
  const loadOlder = useCallback(async () => {
    if (!firstId) return;
    setOlder({ busy: true, error: null });
    try {
      const r = await api.getMessages(conversationId, { before: firstId });
      setState((s) => {
        const ids = new Set(s.messages.map((m) => m.id));
        return { ...s, messages: [...r.messages.filter((m) => !ids.has(m.id)), ...s.messages], olderHasMore: r.hasMore };
      });
      setOlder({ busy: false, error: null });
    } catch (e) {
      setOlder({ busy: false, error: api.errorMessage(e) });
    }
  }, [conversationId, firstId]);

  const send = useCallback(
    async (body: string) => {
      const m = await api.sendMessage(conversationId, body);
      setPending((p) => [...p, m]);
      pollNow.current();
      // Sending moves our read marker too.
      void refreshUnread();
    },
    [conversationId],
  );

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const confirmedIds = new Set(state.messages.map((m) => m.id));
  const all = [...state.messages, ...pending.filter((m) => !confirmedIds.has(m.id))];
  return { ...state, all, older, loadOlder, send, retry };
}

// ---------- page ----------

function Chat({ c, reload }: { c: Conversation; reload: () => void }) {
  const { user } = useSession();
  const isAdmin = c.myRole === "admin";
  const other = c.myRole === "owner" ? c.borrower : c.owner;
  const nameOf = (uid: string) =>
    uid === c.owner.id ? `${c.owner.displayName} (lender)` : uid === c.borrower.id ? `${c.borrower.displayName} (borrower)` : "Someone";
  const t = useThread(c.id);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reported, setReported] = useState<Set<string>>(() => new Set());

  // Mark read when the newest message we hold is from the other side and the
  // tab is visible (again on becoming visible). Admins can't mark read.
  const last = t.messages.at(-1);
  const lastId = last?.id;
  const lastFromOther = !!last && last.senderId !== user.id;
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (isAdmin || !lastId || !lastFromOther) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || marked.current === lastId) return;
      marked.current = lastId;
      api.markConversationRead(c.id, lastId).then(
        () => refreshUnread(),
        () => {
          marked.current = null;
        },
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [c.id, isAdmin, lastId, lastFromOther]);

  // Scroll: stick to the bottom for new messages (if already near it), keep
  // the reader's place when older ones are prepended.
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const preserve = useRef<{ height: number; top: number } | null>(null);
  const count = t.all.length;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (preserve.current) {
      el.scrollTop = el.scrollHeight - preserve.current.height + preserve.current.top;
      preserve.current = null;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [count]);

  const loadOlder = () => {
    const el = listRef.current;
    if (el) preserve.current = { height: el.scrollHeight, top: el.scrollTop };
    void t.loadOlder();
  };

  const send = async (body: string) => {
    nearBottom.current = true;
    try {
      await t.send(body);
    } catch (e) {
      // The window closed while the chat was open: refetch so the composer
      // gives way to the read-only explanation.
      if (e instanceof api.ApiError && (e.message === "conversation_closed" || e.message === "participants_only")) reload();
      throw e;
    }
  };

  const disputedBookings = c.bookings.filter((b) => b.state === "DISPUTED" || b.state === "RESOLVED");

  return (
    <div className="mx-auto max-w-3xl">
      {isAdmin ? (
        <BackLink href={`/admin/${c.societyId}?tab=disputes`} label="All disputes" />
      ) : (
        <BackLink href="/messages" label="All messages" />
      )}

      <Panel className="mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Cover url={c.listing.coverUrl} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <Link href={`/listings/${c.listing.id}`} className="font-semibold hover:text-accent">
                {c.listing.title}
              </Link>
              {c.listing.status !== "active" ? <Badge variant="warn">{c.listing.status}</Badge> : null}
            </p>
            {isAdmin ? (
              <p className="text-sm text-fg-muted">
                {c.owner.displayName} ({c.owner.towerName}-{c.owner.flatNo}, lender) · {c.borrower.displayName} (
                {c.borrower.towerName}-{c.borrower.flatNo}, borrower)
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                <span>
                  With <span className="font-medium text-fg">{other.displayName}</span> · {other.towerName}-{other.flatNo} ·{" "}
                  {c.myRole === "owner" ? "wants to borrow" : "owner"}
                </span>
                <TrustBadge trust={other.trust} compact />
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin ? (
              disputedBookings.map((b) => (
                <Link key={b.id} href={`/admin/${c.societyId}/disputes/${b.id}`}>
                  <Button size="sm" variant="outline">
                    BV-{b.id.slice(0, 8)} <StateBadge state={b.state} />
                  </Button>
                </Link>
              ))
            ) : c.activeBookingId ? (
              <Link href={`/bookings/${c.activeBookingId}`}>
                <Button size="sm" variant="outline">
                  Active booking
                </Button>
              </Link>
            ) : (
              <Link href={`/listings/${c.listing.id}`}>
                <Button size="sm" variant="outline">
                  View listing
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Panel>

      {isAdmin ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            Read-only admin view. You can see this chat because a booking between these neighbours is disputed or was resolved.
            You can&apos;t post, mark it read or report messages here.
          </span>
        </div>
      ) : null}
      <div className="mb-3">
        <ChatNotice />
      </div>

      <Panel className="p-0">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="h-[55vh] min-h-72 overflow-y-auto px-4 py-4"
          aria-live="polite"
        >
          {t.error && !t.loaded ? (
            <LoadError error={t.error} onRetry={t.retry} />
          ) : !t.loaded ? (
            <Loading label="Loading messages…" />
          ) : (
            <>
              {t.olderHasMore ? (
                <div className="mb-3 flex flex-col items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={loadOlder} disabled={t.older.busy}>
                    {t.older.busy ? <Loader2 className="animate-spin" /> : null} Load earlier messages
                  </Button>
                  <ErrorText>{t.older.error}</ErrorText>
                </div>
              ) : null}
              {t.all.length === 0 ? (
                <p className="py-10 text-center text-sm text-fg-muted">
                  {isAdmin
                    ? "No messages in this chat."
                    : c.myRole === "borrower"
                      ? `No messages yet. Ask ${other.displayName} anything about ${c.listing.title}: condition, pickup time, what's included.`
                      : `No messages yet. Say hello to ${other.displayName}.`}
                </p>
              ) : (
                <ul className="space-y-3">
                  {t.all.map((m) => {
                    const mine = !isAdmin && m.senderId === user.id;
                    const canReport = !isAdmin && !mine;
                    return (
                      <MessageBubble
                        key={m.id}
                        m={m}
                        mine={mine}
                        name={isAdmin ? nameOf(m.senderId) : undefined}
                        footer={
                          canReport ? (
                            reported.has(m.id) ? (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <Flag className="size-3" /> Reported
                              </span>
                            ) : (
                              <button
                                className="inline-flex items-center gap-1 hover:text-red-600"
                                onClick={() => setReporting(m)}
                                aria-label="Report this message"
                              >
                                <Flag className="size-3" /> Report
                              </button>
                            )
                          ) : null
                        }
                      />
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="border-t border-line p-3">
          {isAdmin ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Lock className="size-4" /> Admins can read this chat but not post in it.
            </p>
          ) : c.canSend ? (
            <Composer onSend={send} disabled={!t.loaded} />
          ) : (
            <p className="flex items-start gap-2 text-sm text-fg-muted">
              <Lock className="mt-0.5 size-4 shrink-0" />
              <span>
                This chat is read-only now.{" "}
                {c.listing.status === "archived"
                  ? "The listing has been archived and there's been no booking activity in the last 7 days."
                  : "There's been no booking activity in the last 7 days and your membership in this society isn't approved any more."}{" "}
                You can still read everything here.
              </span>
            </p>
          )}
        </div>
      </Panel>

      {reporting ? (
        <ReportDialog
          message={reporting}
          authorName={reporting.senderId === c.owner.id ? c.owner.displayName : c.borrower.displayName}
          onClose={() => setReporting(null)}
          onReported={(mid) => {
            setReported((s) => new Set(s).add(mid));
            setReporting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Composer({ onSend, disabled }: { onSend: (body: string) => Promise<void>; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = draft.trim();
  const len = codePoints(trimmed);
  const tooLong = len > MESSAGE_MAX;
  const canSubmit = !busy && !disabled && len > 0 && !tooLong;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(trimmed);
      setDraft("");
    } catch (e) {
      // Keep the draft so nothing typed is lost.
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-1.5"
    >
      <div className="flex items-end gap-2">
        <Textarea
          ref={ref}
          rows={2}
          value={draft}
          readOnly={busy}
          aria-label="Message"
          placeholder="Write a message…"
          className="max-h-40 min-h-[44px] resize-y"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={!canSubmit}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-fg-muted">Enter to send · Shift+Enter for a new line</span>
        {len >= COUNTER_FROM ? (
          <span className={cn(tooLong ? "font-medium text-red-600" : "text-fg-muted")}>
            {len.toLocaleString("en-IN")}/{MESSAGE_MAX.toLocaleString("en-IN")}
          </span>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
