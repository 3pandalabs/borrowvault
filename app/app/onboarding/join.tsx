import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, H2, Label, Loading, P, Screen } from "../../src/components/ui";
import { useAction } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { friendlyError, getTowers, joinSociety } from "../../src/lib/api";
import { guessMime, PROOF_MAX, PROOF_MIMES, uploadToStorage } from "../../src/lib/storage";
import { colors } from "../../src/lib/theme";
import type { Occupancy, Tower } from "../../src/lib/types";

type Proof = { uri: string; mime: string; name: string; size: number | null };

const OCCUPANCY: { key: Occupancy; label: string }[] = [
  { key: "owner", label: "Owner" },
  { key: "tenant", label: "Tenant" },
  { key: "family", label: "Family member" },
];

export default function Join() {
  const { societyId, name } = useLocalSearchParams<{ societyId: string; name: string }>();
  const router = useRouter();
  const { refresh } = useAuth();
  const [towers, setTowers] = useState<Tower[] | null>(null);
  const [towerId, setTowerId] = useState<string | null>(null);
  const [flatNo, setFlatNo] = useState("");
  const [occupancy, setOccupancy] = useState<Occupancy>("owner");
  const [inviteCode, setInviteCode] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const action = useAction();

  useEffect(() => {
    getTowers(societyId)
      .then(setTowers)
      .catch((e) => setLoadError(friendlyError(e)));
  }, [societyId]);

  async function pickDocument() {
    const res = await DocumentPicker.getDocumentAsync({ type: [...PROOF_MIMES], copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setProof({ uri: a.uri, mime: a.mimeType ?? guessMime(a.name), name: a.name, size: a.size ?? null });
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      action.setError("Camera permission is needed to photograph your proof. You can upload a file instead.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setProof({ uri: a.uri, mime: a.mimeType ?? "image/jpeg", name: "Proof photo", size: a.fileSize ?? null });
  }

  const flatOk = /^[A-Za-z0-9-/ ]{1,12}$/.test(flatNo.trim());
  const inviteOk = inviteCode.trim() === "" || /^[A-Za-z0-9]{8}$/.test(inviteCode.trim());
  const canSubmit = !!towerId && flatOk && inviteOk && (!!proof || inviteCode.trim().length === 8);

  async function submit() {
    const ok = await action.run(async () => {
      let proofKey: string | undefined;
      if (proof) {
        if (proof.size && proof.size > PROOF_MAX) throw new Error("Proof must be 10 MB or smaller.");
        proofKey = await uploadToStorage("proof", proof.uri, proof.mime);
      }
      await joinSociety(societyId, {
        towerId: towerId!,
        flatNo: flatNo.trim().toUpperCase(),
        occupancy,
        inviteCode: inviteCode.trim() ? inviteCode.trim().toUpperCase() : undefined,
        proofKey,
      });
      await refresh();
    });
    if (ok) router.replace("/onboarding/pending");
  }

  return (
    <Screen>
      <H2>{name}</H2>
      {loadError ? <ErrorText>{loadError}</ErrorText> : null}
      {!towers && !loadError ? <Loading /> : null}
      {towers ? (
        <>
          <Label>Tower / block</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {towers.map((t) => (
              <Chip key={t.id} label={t.name} selected={towerId === t.id} onPress={() => setTowerId(t.id)} />
            ))}
          </View>
        </>
      ) : null}
      <Field label="Flat number" value={flatNo} onChangeText={setFlatNo} placeholder="e.g. 1204" autoCapitalize="characters" />
      <Label>You are the</Label>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {OCCUPANCY.map((o) => (
          <Chip key={o.key} label={o.label} selected={occupancy === o.key} onPress={() => setOccupancy(o.key)} />
        ))}
      </View>
      <Field
        label="Invite code (optional)"
        value={inviteCode}
        onChangeText={setInviteCode}
        autoCapitalize="characters"
        maxLength={8}
        hint="8 characters, from your society admin. Speeds up approval."
        error={inviteOk ? null : "Invite codes are 8 letters/numbers"}
      />
      <Card>
        <H2>Address proof</H2>
        <P muted>
          A maintenance bill, rent agreement, or society ID card showing your flat. Only your society admin sees it. PDF,
          JPG or PNG, up to 10 MB.
        </P>
        {proof ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {proof.mime.startsWith("image/") ? (
              <Image source={{ uri: proof.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
            ) : (
              <Ionicons name="document-text" size={40} color={colors.accent} />
            )}
            <Text style={{ flex: 1, color: colors.fg }} numberOfLines={1}>
              {proof.name}
            </Text>
            <Button title="Remove" variant="ghost" onPress={() => setProof(null)} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Upload file" icon="document-attach" variant="secondary" onPress={pickDocument} style={{ flex: 1 }} />
            <Button title="Take photo" icon="camera" variant="secondary" onPress={takePhoto} style={{ flex: 1 }} />
          </View>
        )}
      </Card>
      <ErrorText>{action.error}</ErrorText>
      <Button title="Send for verification" onPress={submit} busy={action.busy} disabled={!canSubmit} />
      {!proof && inviteCode.trim().length !== 8 ? <P muted>Add a proof or an invite code to continue.</P> : null}
    </Screen>
  );
}
