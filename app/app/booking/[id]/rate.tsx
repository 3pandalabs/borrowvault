import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, H2, P, Screen } from "../../../src/components/ui";
import { useAction } from "../../../src/hooks/useAsync";
import { rateBooking } from "../../../src/lib/api";

export default function RateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [punctual, setPunctual] = useState<boolean | undefined>();
  const [careful, setCareful] = useState<boolean | undefined>();
  const [asDescribed, setAsDescribed] = useState<boolean | undefined>();
  const [comment, setComment] = useState("");
  const action = useAction();

  async function submit() {
    const ok = await action.run(() =>
      rateBooking(id, { stars, punctual, careful, asDescribed, comment: comment.trim() || undefined }),
    );
    if (ok) router.back();
  }

  const toggle = (label: string, v: boolean | undefined, set: (x: boolean | undefined) => void) => (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <P style={{ flex: 1 }}>{label}</P>
      <Chip label="Yes" selected={v === true} onPress={() => set(v === true ? undefined : true)} />
      <Chip label="No" selected={v === false} onPress={() => set(v === false ? undefined : false)} />
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: "Rate" }} />
      <Card>
        <H2>How did it go?</H2>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 8 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setStars(n)} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}>
              <Ionicons name={n <= stars ? "star" : "star-outline"} size={36} color="#ca8a04" />
            </Pressable>
          ))}
        </View>
        {toggle("On time", punctual, setPunctual)}
        {toggle("Careful with things", careful, setCareful)}
        {toggle("As described", asDescribed, setAsDescribed)}
        <Field label="Comment (optional)" value={comment} onChangeText={setComment} multiline maxLength={500} />
      </Card>
      <ErrorText>{action.error}</ErrorText>
      <Button title="Submit rating" onPress={submit} busy={action.busy} disabled={stars === 0} />
    </Screen>
  );
}
