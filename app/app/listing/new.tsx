import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card, Chip, ChipRow, ErrorText, Field, H2, Label, P, Screen } from "../../src/components/ui";
import { useAction } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { createListing, getCategories } from "../../src/lib/api";
import { rupeesToPaise } from "../../src/lib/format";
import { guessMime, LISTING_MAX, uploadToStorage } from "../../src/lib/storage";
import { colors, radius } from "../../src/lib/theme";
import type { CategoryPreset, ChecklistItem, ChecklistType, ListingKind } from "../../src/lib/types";

const TYPES: { key: ChecklistType; label: string }[] = [
  { key: "bool", label: "Yes/No" },
  { key: "percent", label: "%" },
  { key: "count", label: "Count" },
  { key: "choice", label: "Choice" },
  { key: "text", label: "Text" },
];
const MAX_PHOTOS = 6;

type Photo = { uri: string; mime: string; size: number | null };

export default function NewListing() {
  const params = useLocalSearchParams<{ societyId?: string; kind?: ListingKind }>();
  const router = useRouter();
  const { approved, user } = useAuth();
  const [societyId, setSocietyId] = useState(params.societyId || approved[0]?.societyId || "");
  const [kind, setKind] = useState<ListingKind>(params.kind === "skill" ? "skill" : "item");
  const [presets, setPresets] = useState<CategoryPreset[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hourly, setHourly] = useState("");
  const [daily, setDaily] = useState("");
  const [weekend, setWeekend] = useState("");
  const [deposit, setDeposit] = useState("");
  const [replacement, setReplacement] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [newSlot, setNewSlot] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [touched, setTouched] = useState(false);
  const action = useAction();

  useEffect(() => {
    getCategories().then(setPresets).catch(() => setPresets([]));
  }, []);

  function applyPreset(p: CategoryPreset) {
    setCategory(p.key);
    // Copy so lender edits never mutate the preset.
    setChecklist(p.checklistTemplate.map((c) => ({ ...c, options: c.options ? [...c.options] : undefined })));
    setSlots([...p.requiredPhotoSlots]);
  }

  async function addPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      action.setError("Allow photo access to add listing photos.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.7,
    });
    if (res.canceled) return;
    setPhotos((p) =>
      [...p, ...res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? guessMime(a.uri), size: a.fileSize ?? null }))].slice(0, MAX_PHOTOS),
    );
  }

  const isItem = kind === "item";
  const prices = {
    hourlyPaise: hourly ? rupeesToPaise(hourly) : undefined,
    dailyPaise: daily ? rupeesToPaise(daily) : undefined,
    weekendPaise: isItem && weekend ? rupeesToPaise(weekend) : undefined,
  };
  const depositPaise = isItem ? (deposit ? rupeesToPaise(deposit) : 0) : 0;
  const replacementPaise = isItem && replacement ? rupeesToPaise(replacement) : undefined;
  const errors = {
    title: title.trim().length < 3 ? "Give it a short title" : null,
    category: !category ? "Pick a category" : null,
    price:
      Object.values(prices).some((v) => v === null) ? "Prices must be in rupees, e.g. 350"
      : !Object.values(prices).some((v) => v && v > 0) ? "Set at least one price" : null,
    deposit: depositPaise === null || replacementPaise === null ? "Enter amounts in rupees" : null,
    slots: isItem && slots.length === 0 ? "Items need at least one required photo" : null,
    checklist: checklist.some((c) => !c.label.trim() || (c.type === "choice" && (c.options ?? []).filter(Boolean).length < 2))
      ? "Each checklist item needs a label; choices need 2+ options"
      : null,
    vpa: !user?.upiVpa ? "Add your UPI ID in Profile before lending" : null,
    photos: photos.some((p) => p.size && p.size > LISTING_MAX) ? "Each photo must be 8 MB or smaller" : null,
  };
  const valid = !Object.values(errors).some(Boolean) && !!societyId;

  async function submit() {
    setTouched(true);
    if (!valid) return;
    await action.run(async () => {
      const photoKeys: string[] = [];
      for (const p of photos) photoKeys.push(await uploadToStorage("listing_photo", p.uri, p.mime));
      const listing = await createListing({
        societyId,
        kind,
        category: category!,
        title: title.trim(),
        description: description.trim(),
        ...(prices.hourlyPaise ? { hourlyPaise: prices.hourlyPaise } : {}),
        ...(prices.dailyPaise ? { dailyPaise: prices.dailyPaise } : {}),
        ...(prices.weekendPaise ? { weekendPaise: prices.weekendPaise } : {}),
        depositPaise: depositPaise ?? 0,
        ...(replacementPaise ? { replacementValuePaise: replacementPaise } : {}),
        checklistTemplate: isItem
          ? checklist.map((c) => ({ ...c, label: c.label.trim(), options: c.type === "choice" ? (c.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined }))
          : [],
        requiredPhotoSlots: isItem ? slots : [],
        photoKeys,
      });
      router.replace(`/listing/${listing.id}`);
    });
  }

  const updateItem = (i: number, patch: Partial<ChecklistItem>) =>
    setChecklist((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Screen>
      <Stack.Screen options={{ title: "New listing" }} />
      {errors.vpa ? (
        <Card style={{ backgroundColor: colors.warnSoft }}>
          <P>Borrowers pay you directly by UPI, so add your UPI ID first.</P>
          <Button title="Go to Profile" variant="secondary" onPress={() => router.push("/(tabs)/profile")} />
        </Card>
      ) : null}
      {approved.length > 1 ? (
        <>
          <Label>Society</Label>
          <ChipRow>
            {approved.map((m) => (
              <Chip key={m.societyId} label={m.societyName} selected={societyId === m.societyId} onPress={() => setSocietyId(m.societyId)} />
            ))}
          </ChipRow>
        </>
      ) : null}
      <Label>What are you offering?</Label>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip label="An item to lend" selected={isItem} onPress={() => { setKind("item"); setCategory(null); }} />
        <Chip label="A skill / gig" selected={!isItem} onPress={() => { setKind("skill"); setCategory(null); }} />
      </View>
      <Label>Category</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {presets.filter((p) => p.kind === kind).map((p) => (
          <Chip key={p.key} label={p.label} selected={category === p.key} onPress={() => applyPreset(p)} />
        ))}
      </View>
      {touched && errors.category ? <ErrorText>{errors.category}</ErrorText> : null}

      <Field label="Title" value={title} onChangeText={setTitle} placeholder={isItem ? "Bosch GSB 500 drill" : "Maths tutoring (Class 8-10)"} error={touched ? errors.title : null} />
      <Field label="Description" value={description} onChangeText={setDescription} multiline />

      <Card>
        <H2>Price (₹)</H2>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="Per hour" value={hourly} onChangeText={setHourly} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Per day" value={daily} onChangeText={setDaily} keyboardType="decimal-pad" /></View>
          {isItem ? <View style={{ flex: 1 }}><Field label="Weekend" value={weekend} onChangeText={setWeekend} keyboardType="decimal-pad" /></View> : null}
        </View>
        {touched && errors.price ? <ErrorText>{errors.price}</ErrorText> : null}
        {isItem ? (
          <>
            <Field label="Deposit (₹)" value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" hint="The most you can claim if something goes wrong." />
            <Field label="Replacement value (₹, optional)" value={replacement} onChangeText={setReplacement} keyboardType="decimal-pad" />
            {touched && errors.deposit ? <ErrorText>{errors.deposit}</ErrorText> : null}
          </>
        ) : null}
      </Card>

      {isItem ? (
        <>
          <Card>
            <H2>Required handover photos</H2>
            <P muted>Both of you photograph these at handover and return, in the app camera.</P>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {slots.map((sl) => (
                <Chip key={sl} label={`${sl}  ✕`} onPress={() => setSlots((s) => s.filter((x) => x !== sl))} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput style={[st.input, { flex: 1 }]} value={newSlot} onChangeText={setNewSlot} placeholder="e.g. serial number" placeholderTextColor="#a1a1aa" />
              <Button
                title="Add"
                variant="secondary"
                disabled={!newSlot.trim() || slots.includes(newSlot.trim().toLowerCase())}
                onPress={() => {
                  setSlots((s) => [...s, newSlot.trim().toLowerCase()]);
                  setNewSlot("");
                }}
              />
            </View>
            {touched && errors.slots ? <ErrorText>{errors.slots}</ErrorText> : null}
          </Card>

          <Card>
            <H2>Checklist</H2>
            <P muted>Filled in at handover and compared at return.</P>
            {checklist.map((c, i) => (
              <View key={c.id} style={st.itemBox}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TextInput style={[st.input, { flex: 1 }]} value={c.label} onChangeText={(t) => updateItem(i, { label: t })} placeholder="e.g. Charger included" placeholderTextColor="#a1a1aa" />
                  <Pressable onPress={() => setChecklist((x) => x.filter((_, j) => j !== i))} accessibilityLabel="Remove item">
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {TYPES.map((t) => (
                    <Chip key={t.key} label={t.label} selected={c.type === t.key} onPress={() => updateItem(i, { type: t.key, options: t.key === "choice" ? c.options ?? ["none", "minor", "visible"] : undefined })} />
                  ))}
                </View>
                {c.type === "choice" ? (
                  <TextInput
                    style={st.input}
                    value={(c.options ?? []).join(", ")}
                    onChangeText={(t) => updateItem(i, { options: t.split(",").map((o) => o.trimStart()) })}
                    placeholder="Options, comma separated"
                    placeholderTextColor="#a1a1aa"
                  />
                ) : null}
              </View>
            ))}
            <Button
              title="Add checklist item"
              icon="add"
              variant="secondary"
              onPress={() => setChecklist((c) => [...c, { id: Crypto.randomUUID().slice(0, 8), label: "", type: "bool" }])}
            />
            {touched && errors.checklist ? <ErrorText>{errors.checklist}</ErrorText> : null}
          </Card>
        </>
      ) : null}

      <Card>
        <H2>Listing photos</H2>
        <P muted>From your gallery is fine here. Up to {MAX_PHOTOS}, 8 MB each.</P>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {photos.map((p) => (
            <Pressable key={p.uri} onPress={() => setPhotos((x) => x.filter((y) => y.uri !== p.uri))}>
              <Image source={{ uri: p.uri }} style={st.thumb} />
              <Text style={{ fontSize: 11, color: colors.fgMuted, textAlign: "center" }}>Tap to remove</Text>
            </Pressable>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <Pressable onPress={addPhotos} style={[st.thumb, st.addThumb]}>
              <Ionicons name="images-outline" size={26} color={colors.fgMuted} />
            </Pressable>
          ) : null}
        </View>
        {errors.photos ? <ErrorText>{errors.photos}</ErrorText> : null}
      </Card>

      <ErrorText>{action.error}</ErrorText>
      <Button title="Publish listing" onPress={submit} busy={action.busy} disabled={!!errors.vpa} />
    </Screen>
  );
}

const st = StyleSheet.create({
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.fg, backgroundColor: colors.card },
  itemBox: { gap: 6, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border },
  thumb: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  addThumb: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.border },
});
