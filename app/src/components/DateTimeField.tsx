import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { formatDateTime, fromIst, istParts } from "../lib/format";
import { colors, radius } from "../lib/theme";
import { Label } from "./ui";

/**
 * Picks an IST wall-clock date + time. The native picker works in the device
 * zone, so we read back its local Y/M/D h:m and rebuild the instant in
 * Asia/Kolkata explicitly: a phone set to another zone still books IST times.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate?: Date;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const p = istParts(value);
  // A device-local Date that *displays* the IST wall-clock values in the picker.
  const pickerValue = new Date(p.year, p.month, p.day, p.hour, p.minute);

  function handle(e: DateTimePickerEvent, d?: Date) {
    const m = mode;
    if (Platform.OS === "android") setMode(null);
    if (e.type !== "set" || !d) return;
    const next =
      m === "date"
        ? fromIst(d.getFullYear(), d.getMonth(), d.getDate(), p.hour, p.minute)
        : fromIst(p.year, p.month, p.day, d.getHours(), d.getMinutes());
    onChange(next);
  }

  return (
    <View style={{ marginBottom: 12 }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={s.box} onPress={() => setMode("date")}>
          <Text style={s.text}>{formatDateTime(value.toISOString()).split(",")[0]}</Text>
        </Pressable>
        <Pressable style={s.box} onPress={() => setMode("time")}>
          <Text style={s.text}>{formatDateTime(value.toISOString()).split(", ")[1]}</Text>
        </Pressable>
      </View>
      {mode ? (
        <DateTimePicker
          value={pickerValue}
          mode={mode}
          minuteInterval={15}
          minimumDate={mode === "date" ? minimumDate : undefined}
          onChange={handle}
        />
      ) : null}
      {Platform.OS === "ios" && mode ? (
        <Pressable onPress={() => setMode(null)}>
          <Text style={{ color: colors.accent, fontWeight: "700", padding: 8 }}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    backgroundColor: colors.card,
  },
  text: { fontSize: 15, color: colors.fg, fontWeight: "600" },
});
