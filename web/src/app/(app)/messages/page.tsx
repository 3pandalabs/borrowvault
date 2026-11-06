"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { Cover } from "@/components/chat";
import { EmptyState, LoadError, Loading, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listConversations } from "@/lib/api";
import { formatIST } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useUnread } from "@/lib/unread";
import { cn } from "@/lib/utils";

export default function MessagesPage() {
  const { user } = useSession();
  const unread = useUnread();
  // Refetch when the unread total moves (a new message arrived somewhere).
  const list = useAsync(listConversations, `conversations:${unread?.total ?? 0}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Messages" subtitle="Chats with neighbours about listings and bookings." />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : !list.data.length ? (
        <EmptyState
          icon={<MessageCircle />}
          title="No messages yet"
          body="Ask a lender a question from any listing before you book. Chats about your bookings show up here too."
          action={
            <Link href="/listings">
              <Button size="sm">Browse listings</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {list.data.map((c) => {
            // The shared store is fresher than the list (e.g. right after reading a chat).
            const count = unread ? (unread.byConversation[c.id] ?? 0) : c.unreadCount;
            const preview = c.lastMessage
              ? `${c.lastMessage.senderId === user.id ? "You: " : ""}${c.lastMessage.body}`
              : c.myRole === "borrower"
                ? "No messages yet"
                : "";
            return (
              <li key={c.id}>
                <Link href={`/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                  <Cover url={c.listing.coverUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("truncate", count ? "font-semibold" : "font-medium")}>{c.other.displayName}</span>
                      <span className="truncate text-sm text-fg-muted">· {c.listing.title}</span>
                      {c.activeBookingId ? <Badge variant="info">Active booking</Badge> : null}
                    </span>
                    <span className={cn("block truncate text-sm", count ? "text-fg" : "text-fg-muted")}>{preview}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-fg-muted">{c.lastMessageAt ? formatIST(c.lastMessageAt) : ""}</span>
                    {count ? (
                      <span
                        className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg"
                        aria-label={`${count} unread`}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
