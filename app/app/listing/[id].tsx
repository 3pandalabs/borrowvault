import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { DateTimeField } from "../../src/components/DateTimeField";
import { slotTitle } from "../../src/components/Evidence";
import { Button, Card, Chip, ErrorText, H1, H2, KV, Loading, P, Screen, TrustBadge } from "../../src/components/ui";
import { useAction, useLoader, useNow } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { bookingRequestError, createBooking, getAvailability, getListing } from "../../src/lib/api";
import { formatDateTime, formatPaise, fromIst, istParts } from "../../src/lib/format";
import { PRICING_LABEL, priceLine } from "../../src/lib/labels";
import { colors } from "../../src/lib/theme";
import type { BusyRange, Listing, PricingUnit } from "../../src/lib/types";

const HOUR = 3600_000;

function defaultStart(): Date {
  // Next full hour in IST, at least 2 h out (lender needs time to accept + get paid).
  const p = istParts(new Date(Date.now() + 2 * HOUR));
  return fromIst(p.year, p.month, p.day, p.hour + 1, 0);
}

function estimateFee(l: Listing, unit: PricingUnit, start: Date, end: Date): number | null {
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return null;
  if (unit === "hourly" && l.hourlyPaise) return Math.ceil(ms / HOUR) * l.hourlyPaise;
  if (unit === "daily" && l.dailyPaise) return Math.ceil(ms / (24 * HOUR)) * l.dailyPaise;
  if (unit === "weekend" && l.weekendPaise) return l.weekendPaise;
  return null;
}

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: l, error, loading, reload } = useLoader(() => getListing(id), [id]);
  const [busy, setBusy] = useState<BusyRange[]>([]);
  const units = useMemo(
    () => (l ? (["hourly", "daily", "weekend"] as const).filter((u) => l[`${u}Paise` as const]) : []),
    [l],
  );
  const [pickedUnit, setUnit] = useState<PricingUnit | null>(null);
  const unit: PricingUnit | null = pickedUnit ?? units[0] ?? null;
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(() => new Date(defaultStart().getTime() + 2 * HOUR));
  const action = useAction();
  const now = useNow(30_000);

  useEffect(() => {
    if (!l) return;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 24 * HOUR).toISOString();
    getAvailability(l.id, from, to).then(setBusy).catch(() => setBusy([]));
  }, [l]);

  if (!l) {
    return (
      <Screen onRefresh={reload} refreshing={loading}>
        <Stack.Screen options={{ title: "Listing" }} />
        {loading ? <Loading /> : <ErrorText>{error}</ErrorText>}
      </Screen>
    );
  }

  const isOwner = l.owner.id === user?.id;
  const photoList = l.photoUrls ?? [];
  const fee = unit ? estimateFee(l, unit, start, end) : null;
  const clash = busy.some((r) => new Date(r.startsAt) < end && new Date(r.endsAt) > start);
  const lenMs = end.getTime() - start.getTime();
  const tooLong = lenMs > 30 * 24 * HOUR ? "Bookings can be at most 30 days." : unit === "weekend" && lenMs > 72 * HOUR ? "A weekend booking can be at most 72 hours." : null;
  const valid = !!unit && end > start && start.getTime() > now && !clash && !tooLong;

  async function request() {
    const ok = await action.run(async () => {
      let b;
      try {
        b = await createBooking({ listingId: l!.id, startsAt: start.toISOString(), endsAt: end.toISOString(), pricing: unit! });
      } catch (err) {
        // 403 = unpaid dispute award or trust < 2.0: explain instead of "not allowed".
        throw new Error(bookingRequestError(err));
      }
      router.replace(`/booking/${b.id}`);
    });
    if (!ok) void getAvailability(l!.id, new Date().toISOString(), new Date(Date.now() + 30 * 24 * HOUR).toISOString()).then(setBusy).catch(() => {});
  }

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: l.kind === "item" ? "Item" : "Skill" }} />
      {photoList.length ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }}>
          {photoList.map((u) => (
            <Image key={u} source={{ uri: u }} style={{ width: 360, height: 240, backgroundColor: colors.bgSubtle }} resizeMode="cover" />
          ))}
        </ScrollView>
      ) : null}
      <H1>{l.title}</H1>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.accent }}>{priceLine(l)}</Text>
      {l.status !== "active" ? <Chip label={`This listing is ${l.status}`} tone="warn" /> : null}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ fontWeight: "700", color: colors.fg }}>{isOwner ? "You" : l.owner.displayName}</Text>
            <P muted>
              {l.owner.towerName}-{l.owner.flatNo}
            </P>
          </View>
          <TrustBadge trust={l.owner.trust} />
        </View>
      </Card>
      {l.description ? <P>{l.description}</P> : null}
      <Card>
        {l.depositPaise > 0 ? <KV k="Deposit" v={formatPaise(l.depositPaise)} /> : null}
        {l.replacementValuePaise ? <KV k="Replacement value" v={formatPaise(l.replacementValuePaise)} /> : null}
        <KV k="Category" v={l.category} />
      </Card>
      {l.kind === "item" && (l.requiredPhotoSlots.length || l.checklistTemplate.length) ? (
        <Card>
          <H2>Checked at handover & return</H2>
          <P muted>Photos: {l.requiredPhotoSlots.map(slotTitle).join(", ")}</P>
          {l.checklistTemplate.map((c) => (
            <P key={c.id}>• {c.label}</P>
          ))}
        </Card>
      ) : null}

      {!isOwner && l.status === "active" ? (
        <Card>
          <H2>Request to book</H2>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {units.map((u) => (
              <Chip key={u} label={`${PRICING_LABEL[u]} · ${formatPaise(l[`${u}Paise` as const])}`} selected={unit === u} onPress={() => setUnit(u)} />
            ))}
          </View>
          <DateTimeField
            label="From"
            value={start}
            minimumDate={new Date()}
            onChange={(d) => {
              const len = end.getTime() - start.getTime();
              setStart(d);
              setEnd(new Date(d.getTime() + Math.max(len, HOUR)));
            }}
          />
          <DateTimeField label="Until" value={end} minimumDate={start} onChange={setEnd} />
          {busy.length ? (
            <View>
              <P muted>Already booked:</P>
              {busy.slice(0, 5).map((r) => (
                <P key={r.startsAt} muted>
                  • {formatDateTime(r.startsAt)} → {formatDateTime(r.endsAt)}
                </P>
              ))}
            </View>
          ) : null}
          {clash ? <ErrorText>Those times overlap an existing booking.</ErrorText> : null}
          {end <= start ? <ErrorText>End must be after start.</ErrorText> : null}
          {tooLong ? <ErrorText>{tooLong}</ErrorText> : null}
          {fee !== null ? <KV k="Estimated fee" v={formatPaise(fee)} /> : null}
          {l.depositPaise > 0 ? <KV k="Deposit" v={formatPaise(l.depositPaise)} /> : null}
          <P muted>You pay the lender directly by UPI after they accept. The fee shown is what the server will charge.</P>
          <ErrorText>{action.error}</ErrorText>
          <Button title="Send request" onPress={request} busy={action.busy} disabled={!valid} />
        </Card>
      ) : null}
    </Screen>
  );
}
