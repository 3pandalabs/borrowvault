import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ErrorText, Loading, P } from "../../src/components/ui";
import { useAuth } from "../../src/hooks/useAuth";
import { useIsScreenFocused, usePolling } from "../../src/hooks/usePolling";
import { useUnread } from "../../src/hooks/useUnread";
import { clearActiveConversation, setActiveConversation } from "../../src/lib/activeChat";
import { ApiError, chatError, getConversation, listMessages, markRead, reportMessage, sendMessage } from "../../src/lib/api";
import {
  appendNewer,
  codePointLength,
  COUNTER_FROM,
  hasIncoming,
  MESSAGE_MAX,
  messageProblem,
  prependOlder,
  REPORT_MAX,
  REPORT_MIN,
  reportReasonOk,
  visibleMessages,
} from "../../src/lib/chat";
import { formatWhen } from "../../src/lib/format";
import { colors, radius } from "../../src/lib/theme";
import type { Conversation, Message } from "../../src/lib/types";

const POLL_MS = 5_000;
const PAGE = 50;
/** Safety cap on back-to-back `after=` fetches in one poll when hasMore keeps coming back true. */
const MAX_CATCH_UP_PAGES = 20;

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { refresh: refreshUnread } = useUnread();
  const myId = user?.id;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const focused = useIsScreenFocused();

  const [conv, setConv] = useState<Conversation | null>(null);
  const [confirmed, setConfirmed] = useState<Message[]>([]);
  /** Messages I sent that no poll has returned yet (shown after the confirmed ones). */
  const [sent, setSent] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);

  // The ref is the source of truth for the poll cursor; state mirrors it for rendering.
  const confirmedRef = useRef<Message[]>([]);
  const convRef = useRef<Conversation | null>(null);
  const loadedRef = useRef(false);
  const pollingRef = useRef(false);
  const pollAgainRef = useRef(false);
  const focusedRef = useRef(false);
  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  const commit = useCallback((next: Message[]) => {
    confirmedRef.current = next;
    setConfirmed(next);
    const ids = new Set(next.map((m) => m.id));
    setSent((cur) => (cur.some((m) => ids.has(m.id)) ? cur.filter((m) => !ids.has(m.id)) : cur));
  }, []);

  const applyConv = useCallback((c: Conversation) => {
    convRef.current = c;
    setConv(c);
  }, []);

  const markSeen = useCallback(
    async (upTo: string | undefined) => {
      const c = convRef.current;
      if (!c || c.myRole === "admin" || !upTo || !focusedRef.current) return;
      try {
        await markRead(c.id, upTo);
        await refreshUnread();
      } catch {
        // not worth bothering the user; the next arrival retries
      }
    },
    [refreshUnread],
  );

  const load = useCallback(async () => {
    try {
      const [c, page] = await Promise.all([getConversation(id), listMessages(id, { limit: PAGE })]);
      applyConv(c);
      commit(page.messages);
      setHasOlder(page.hasMore);
      setLoadError(null);
      loadedRef.current = true;
      if (c.unreadCount > 0) void markSeen(page.messages.at(-1)?.id);
    } catch (err) {
      setLoadError(chatError(err));
    }
  }, [id, applyConv, commit, markSeen]);

  const refreshConv = useCallback(async () => {
    try {
      applyConv(await getConversation(id));
    } catch {
      // keep what we have; polling surfaces lasting failures
    }
  }, [id, applyConv]);

  /** Fetch everything newer than the last confirmed message. Never uses a just-sent id as the cursor. */
  const pollNewer = useCallback(async () => {
    if (!loadedRef.current) return;
    if (pollingRef.current) {
      pollAgainRef.current = true;
      return;
    }
    pollingRef.current = true;
    try {
      do {
        pollAgainRef.current = false;
        let incoming = false;
        for (let i = 0; i < MAX_CATCH_UP_PAGES; i++) {
          const cursor = confirmedRef.current.at(-1)?.id;
          if (!cursor) {
            const page = await listMessages(id, { limit: PAGE });
            if (confirmedRef.current.length === 0) {
              commit(page.messages);
              setHasOlder(page.hasMore);
              incoming = hasIncoming(page.messages, myId);
            }
            break;
          }
          const page = await listMessages(id, { after: cursor, limit: 100 });
          commit(appendNewer(confirmedRef.current, page.messages));
          if (hasIncoming(page.messages, myId)) incoming = true;
          if (!page.hasMore || page.messages.length === 0) break;
        }
        if (incoming) void markSeen(confirmedRef.current.at(-1)?.id);
      } while (pollAgainRef.current);
      setLoadError(null);
    } catch (err) {
      // Transient failures wait for the next tick; losing access (404) is worth saying.
      if (err instanceof ApiError && err.status === 404) setLoadError(chatError(err));
    } finally {
      pollingRef.current = false;
    }
  }, [id, myId, commit, markSeen]);

  // First focus loads; every later focus catches up (and re-reads canSend).
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (!loadedRef.current) {
        void load();
      } else {
        void refreshConv();
        void pollNewer();
      }
    }, [load, refreshConv, pollNewer]),
  );

  usePolling(pollNewer, POLL_MS, focused);

  // While this chat is on screen, its push notifications aren't shown (lib/push.ts).
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setActiveConversation(id);
      return () => clearActiveConversation(id);
    }, [id]),
  );

  async function loadOlder() {
    const first = confirmedRef.current[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listMessages(id, { before: first.id, limit: PAGE });
      commit(prependOlder(confirmedRef.current, page.messages));
      setHasOlder(page.hasMore);
    } catch (err) {
      setLoadError(chatError(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send() {
    if (sending || messageProblem(draft)) return;
    const body = draft.trim();
    setSending(true);
    setSendError(null);
    try {
      const m = await sendMessage(id, body);
      setSent((cur) => [...cur, m]);
      setDraft("");
      void pollNewer();
    } catch (err) {
      // Keep the draft so nothing typed is lost.
      setSendError(chatError(err));
      if (err instanceof ApiError && err.error === "conversation_closed") void refreshConv();
    } finally {
      setSending(false);
    }
  }

  const visible = useMemo(() => visibleMessages(confirmed, sent), [confirmed, sent]);
  // Inverted list: newest first in the data, rendered at the bottom.
  const inverted = useMemo(() => visible.slice().reverse(), [visible]);

  if (!conv) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 }}>
        <Stack.Screen options={{ title: "Chat" }} />
        {loadError ? (
          <>
            <ErrorText>{loadError}</ErrorText>
            <Button title="Try again" variant="secondary" onPress={() => void load()} />
          </>
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  const isAdmin = conv.myRole === "admin";
  const other = conv.myRole === "owner" ? conv.borrower : conv.owner;
  const title = isAdmin ? `${conv.owner.displayName} ↔ ${conv.borrower.displayName}` : other.displayName;
  const openContext = () =>
    router.push(conv.activeBookingId ? `/booking/${conv.activeBookingId}` : `/listing/${conv.listing.id}`);

  const n = codePointLength(draft.trim());
  const problem = messageProblem(draft);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <Pressable
              onPress={openContext}
              accessibilityRole="button"
              accessibilityLabel={`${title}, about ${conv.listing.title}. Open ${conv.activeBookingId ? "the active booking" : "the listing"}`}
              style={{ maxWidth: 260 }}
            >
              <Text style={s.headerName} numberOfLines={1}>
                {title}
              </Text>
              <Text style={s.headerSub} numberOfLines={1}>
                {conv.activeBookingId ? "Active booking · " : ""}
                {conv.listing.title} ›
              </Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1 }}>
        <View style={s.notice}>
          <Ionicons name="information-circle-outline" size={16} color={colors.fgMuted} />
          <Text style={s.noticeText}>
            Messages can&apos;t be edited or deleted. If there&apos;s a dispute, your society admin can read this chat.
          </Text>
        </View>
        {loadError ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <ErrorText>{loadError}</ErrorText>
          </View>
        ) : null}

        {visible.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <Text style={s.emptyTitle}>No messages yet</Text>
            <P muted style={{ textAlign: "center" }}>
              {conv.myRole === "borrower"
                ? `Ask ${conv.owner.displayName} anything about "${conv.listing.title}".`
                : "Say hello."}
            </P>
          </View>
        ) : (
          <FlatList
            inverted
            data={inverted}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 12, gap: 6 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            renderItem={({ item }) => {
              const mine = item.senderId === myId;
              const fromOwner = item.senderId === conv.owner.id;
              const canReport = !isAdmin && !mine;
              return (
                <Bubble
                  m={item}
                  mine={isAdmin ? fromOwner : mine}
                  label={isAdmin ? (fromOwner ? conv.owner.displayName : conv.borrower.displayName) : null}
                  onLongPress={canReport ? () => setReportTarget(item) : undefined}
                />
              );
            }}
            ListFooterComponent={
              hasOlder ? (
                <View style={{ paddingVertical: 8 }}>
                  <Button title="Load earlier messages" variant="ghost" busy={loadingOlder} onPress={() => void loadOlder()} />
                </View>
              ) : (
                <Text style={s.start}>Start of the conversation about {conv.listing.title}</Text>
              )
            }
          />
        )}

        <View style={[s.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {conv.canSend && !isAdmin ? (
            <>
              <ErrorText>{sendError}</ErrorText>
              <View style={s.composer}>
                <TextInput
                  value={draft}
                  onChangeText={(t) => {
                    setDraft(t);
                    if (sendError) setSendError(null);
                  }}
                  placeholder="Message"
                  placeholderTextColor="#a1a1aa"
                  multiline
                  editable={!sending}
                  style={s.input}
                  accessibilityLabel="Message"
                />
                <Pressable
                  onPress={() => void send()}
                  disabled={sending || !!problem}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: sending || !!problem }}
                  style={[s.sendBtn, (sending || problem) && { opacity: 0.45 }]}
                >
                  {sending ? <ActivityIndicator color={colors.accentFg} /> : <Ionicons name="send" size={18} color={colors.accentFg} />}
                </Pressable>
              </View>
              {n >= COUNTER_FROM ? (
                <Text style={[s.counter, n > MESSAGE_MAX && { color: colors.danger }]}>
                  {n} / {MESSAGE_MAX}
                </Text>
              ) : null}
            </>
          ) : (
            <View style={s.readOnly}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.fgMuted} />
              <Text style={s.readOnlyText}>
                {isAdmin
                  ? "You're reading this chat as a society admin because a booking is in dispute. Admins can't send messages here."
                  : "This chat is read-only. New messages need a booking from the last 7 days, or an open listing in a society you're a member of."}
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <ReportModal message={reportTarget} onClose={() => setReportTarget(null)} />
    </View>
  );
}

function Bubble({
  m,
  mine,
  label,
  onLongPress,
}: {
  m: Message;
  mine: boolean;
  label: string | null;
  onLongPress?: () => void;
}) {
  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        disabled={!onLongPress}
        accessibilityHint={onLongPress ? "Long press to report this message" : undefined}
        style={[s.bubble, mine ? s.mine : s.theirs]}
      >
        {label ? <Text style={[s.sender, mine && { color: colors.accentFg }]}>{label}</Text> : null}
        {/* Plain text only; newlines are kept. Own messages are selectable (others' long-press opens Report). */}
        <Text selectable={!onLongPress} style={[s.body, mine && { color: colors.accentFg }]}>
          {m.body}
        </Text>
        <Text style={[s.time, mine && { color: "rgba(255,255,255,0.75)" }]}>{formatWhen(m.createdAt)}</Text>
      </Pressable>
    </View>
  );
}

function ReportModal({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = codePointLength(reason.trim());

  function close() {
    setReason("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (!message || !reportReasonOk(reason)) return;
    setBusy(true);
    setError(null);
    try {
      await reportMessage(message.id, reason.trim());
      close();
      Alert.alert("Reported", "Thanks. Your society admin has been told and will review it. The message stays in the chat.");
    } catch (err) {
      setError(chatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <Text style={s.emptyTitle}>Report this message</Text>
          {message ? (
            <Text style={s.quote} numberOfLines={4}>
              {message.body}
            </Text>
          ) : null}
          <P muted>Your society admin will see the message, a few messages around it, and your reason.</P>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="What's wrong with it?"
            placeholderTextColor="#a1a1aa"
            multiline
            style={[s.input, { minHeight: 80, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border }]}
          />
          <Text style={[s.counter, (n > REPORT_MAX || (n > 0 && n < REPORT_MIN)) && { color: colors.danger }]}>
            {n < REPORT_MIN ? `At least ${REPORT_MIN} characters` : `${n} / ${REPORT_MAX}`}
          </Text>
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} disabled={busy} onPress={close} />
            <Button title="Report" variant="danger" style={{ flex: 1 }} busy={busy} disabled={!reportReasonOk(reason)} onPress={() => void submit()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  headerName: { fontSize: 16, fontWeight: "700", color: colors.fg },
  headerSub: { fontSize: 12, color: colors.accent },
  notice: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.bgSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  noticeText: { flex: 1, fontSize: 12, color: colors.fgMuted },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.fg, textAlign: "center" },
  start: { textAlign: "center", fontSize: 12, color: colors.fgMuted, paddingVertical: 12 },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  theirs: {
    backgroundColor: colors.card,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sender: { fontSize: 12, fontWeight: "700", color: colors.fgMuted },
  body: { fontSize: 15, lineHeight: 21, color: colors.fg },
  time: { fontSize: 11, color: colors.fgMuted, alignSelf: "flex-end" },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 6,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.bgSubtle,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { fontSize: 12, color: colors.fgMuted, textAlign: "right" },
  readOnly: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 8 },
  readOnlyText: { flex: 1, fontSize: 13, color: colors.fgMuted },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 16 },
  modalCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10 },
  quote: {
    fontSize: 14,
    color: colors.fg,
    backgroundColor: colors.bgSubtle,
    padding: 10,
    borderRadius: radius.sm,
  },
});
