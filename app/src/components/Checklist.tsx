import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { answerDiffers, answerText, isAnswered } from "../lib/checklist";
import { colors, radius } from "../lib/theme";
import type { ChecklistAnswer, ChecklistItem } from "../lib/types";
import { Chip } from "./ui";

/** Editable checklist rendering every ChecklistItem type. */
export function ChecklistForm({
  items,
  answers,
  onChange,
}: {
  items: ChecklistItem[];
  answers: Record<string, ChecklistAnswer>;
  onChange: (next: Record<string, ChecklistAnswer>) => void;
}) {
  const set = (id: string, patch: ChecklistAnswer) => onChange({ ...answers, [id]: { ...answers[id], ...patch } });

  return (
    <View style={{ gap: 14 }}>
      {items.map((item) => {
        const a = answers[item.id];
        const done = isAnswered(item, a);
        return (
          <View key={item.id} style={s.row}>
            <View style={s.labelRow}>
              <Ionicons
                name={done ? "checkmark-circle" : "ellipse-outline"}
                size={18}
                color={done ? colors.accent : colors.fgMuted}
              />
              <Text style={s.label}>{item.label}</Text>
            </View>
            {item.type === "bool" ? (
              <View style={s.options}>
                <Chip label="Yes" selected={a?.ok === true} onPress={() => set(item.id, { ok: true })} />
                <Chip label="No" selected={a?.ok === false} onPress={() => set(item.id, { ok: false })} />
              </View>
            ) : item.type === "choice" ? (
              <View style={[s.options, { flexWrap: "wrap" }]}>
                {(item.options ?? []).map((o) => (
                  <Chip key={o} label={o} selected={a?.value === o} onPress={() => set(item.id, { value: o })} />
                ))}
              </View>
            ) : item.type === "percent" || item.type === "count" ? (
              <NumberInput
                value={typeof a?.value === "number" ? a.value : undefined}
                max={item.type === "percent" ? 100 : undefined}
                suffix={item.type === "percent" ? "%" : undefined}
                onChange={(v) => set(item.id, { value: v })}
              />
            ) : (
              <TextInput
                style={s.input}
                value={typeof a?.value === "string" ? a.value : ""}
                onChangeText={(t) => set(item.id, { value: t })}
                placeholder="Type here"
                placeholderTextColor="#a1a1aa"
                multiline
              />
            )}
            {item.type !== "text" ? (
              <TextInput
                style={[s.input, s.note]}
                value={a?.note ?? ""}
                onChangeText={(t) => set(item.id, { note: t || undefined })}
                placeholder="Note (optional)"
                placeholderTextColor="#a1a1aa"
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function NumberInput({
  value,
  onChange,
  max,
  suffix,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  max?: number;
  suffix?: string;
}) {
  const clamp = (n: number) => Math.max(0, max !== undefined ? Math.min(max, n) : n);
  return (
    <View style={s.stepper}>
      <Pressable style={s.stepBtn} onPress={() => onChange(clamp((value ?? 0) - 1))} accessibilityLabel="Decrease">
        <Ionicons name="remove" size={18} color={colors.fg} />
      </Pressable>
      <TextInput
        style={[s.input, s.num]}
        keyboardType="number-pad"
        value={value === undefined ? "" : String(value)}
        onChangeText={(t) => {
          const d = t.replace(/\D/g, "");
          onChange(d === "" ? undefined : clamp(parseInt(d, 10)));
        }}
        placeholder="—"
        placeholderTextColor="#a1a1aa"
      />
      {suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
      <Pressable style={s.stepBtn} onPress={() => onChange(clamp((value ?? 0) + 1))} accessibilityLabel="Increase">
        <Ionicons name="add" size={18} color={colors.fg} />
      </Pressable>
    </View>
  );
}

/** Read-only answers (counter-party ack). */
export function ChecklistView({ items, answers }: { items: ChecklistItem[]; answers: Record<string, ChecklistAnswer> }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((item) => (
        <View key={item.id}>
          <View style={s.viewRow}>
            <Text style={s.viewLabel}>{item.label}</Text>
            <Text style={s.viewVal}>{answerText(item, answers[item.id])}</Text>
          </View>
          {answers[item.id]?.note ? <Text style={s.viewNote}>“{answers[item.id]?.note}”</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Handover vs return with diffs highlighted (6.3). */
export function ChecklistDiff({
  items,
  before,
  after,
}: {
  items: ChecklistItem[];
  before: Record<string, ChecklistAnswer>;
  after: Record<string, ChecklistAnswer>;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View style={s.diffRow}>
        <Text style={[s.diffCell, s.diffHead, { flex: 1.4 }]}>Item</Text>
        <Text style={[s.diffCell, s.diffHead]}>Handover</Text>
        <Text style={[s.diffCell, s.diffHead]}>Return</Text>
      </View>
      {items.map((item) => {
        const diff = answerDiffers(item, before[item.id], after[item.id]);
        return (
          <View key={item.id} style={[s.diffRow, diff && { backgroundColor: colors.warnSoft }]}>
            <Text style={[s.diffCell, { flex: 1.4 }]}>{item.label}</Text>
            <Text style={s.diffCell}>{answerText(item, before[item.id])}</Text>
            <Text style={[s.diffCell, diff && { color: colors.warn, fontWeight: "700" }]}>
              {answerText(item, after[item.id])}
              {diff ? " ⚠" : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 15, fontWeight: "600", color: colors.fg, flex: 1 },
  options: { flexDirection: "row", gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.fg,
    backgroundColor: colors.card,
  },
  note: { fontSize: 13, paddingVertical: 6 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  num: { width: 80, textAlign: "center" },
  suffix: { fontSize: 15, color: colors.fgMuted },
  viewRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  viewLabel: { fontSize: 14, color: colors.fgMuted, flex: 1 },
  viewVal: { fontSize: 14, fontWeight: "700", color: colors.fg },
  viewNote: { fontSize: 13, color: colors.fgMuted, fontStyle: "italic" },
  diffRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
  diffCell: { flex: 1, fontSize: 13, color: colors.fg },
  diffHead: { fontWeight: "700", color: colors.fgMuted },
});
