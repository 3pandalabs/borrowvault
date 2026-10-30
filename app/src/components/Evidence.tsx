// Camera-only evidence capture (blueprint §1.2, wireframes 6.1/6.2).
// There is deliberately no gallery picker anywhere in this file.
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { insideFence } from "../lib/geo";
import { useLocationFix } from "../lib/location";
import { bySlot, enqueueCapture, retryItem, useUploadQueue, type QueueItem } from "../lib/uploadQueue";
import { colors, radius } from "../lib/theme";
import type { MediaMime, MediaPhase, SocietyGeofence } from "../lib/types";
import { useNow } from "../hooks/useAsync";
import { Button, Chip } from "./ui";

export const VIDEO_SLOT = "video";
const VIDEO_MAX_S = 15;

export function slotTitle(slot: string): string {
  if (slot === VIDEO_SLOT) return "15-sec video";
  return slot.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * State for one booking+phase capture session: live location, the persisted
 * upload queue, and which slots are still being hashed locally.
 */
export function useEvidence(bookingId: string | undefined, phase: MediaPhase) {
  const loc = useLocationFix();
  const queue = useUploadQueue(bookingId, phase);
  const slots = bySlot(queue);
  const [hashing, setHashing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function capture(slot: string, uri: string, mime: MediaMime, capturedAt: Date, fixPromise: Promise<Awaited<ReturnType<typeof loc.shutterFix>>>) {
    if (!bookingId) return;
    setHashing((h) => ({ ...h, [slot]: true }));
    setError(null);
    try {
      const geo = await fixPromise;
      await enqueueCapture({ bookingId, phase, slot, mime, sourceUri: uri, geo });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that capture. Please retake.");
    } finally {
      setHashing((h) => ({ ...h, [slot]: false }));
    }
  }

  const verified = (slot: string) => slots[slot]?.status === "verified";
  const mediaIdsFor = (wanted: string[]) =>
    wanted.map((s) => slots[s]).filter((i): i is QueueItem => !!i && i.status === "verified" && !!i.mediaId).map((i) => i.mediaId!);

  return { loc, queue, slots, hashing, capture, verified, mediaIdsFor, error };
}

export type Evidence = ReturnType<typeof useEvidence>;

/** 📍 chip: inside/outside the society fence, with GPS accuracy. */
export function GeofenceChip({ ev, fence, societyName }: { ev: Evidence; fence?: SocietyGeofence | null; societyName?: string }) {
  const { permission, latest } = ev.loc;
  const now = useNow(5000);
  if (permission === "denied") {
    return (
      <Pressable onPress={() => void ev.loc.request()}>
        <Chip label="📍 Location off: photos will be flagged. Tap to allow" tone="bad" />
      </Pressable>
    );
  }
  if (!latest) return <Chip label="📍 Getting location fix…" tone="info" />;
  const acc = Math.round(latest.coords.accuracy ?? 0);
  const stale = now - latest.timestamp > 30_000;
  if (!fence) {
    return <Chip label={`📍 Location ±${acc} m${stale ? " (old fix)" : ""} · fence checked by server`} tone={acc <= 50 ? "good" : "warn"} />;
  }
  const inside = insideFence(fence, latest.coords.latitude, latest.coords.longitude, acc);
  return (
    <Chip
      label={`📍 ${inside ? "Inside" : "Outside"} ${societyName ?? "society"} ${inside ? "✓" : "⚠"} (±${acc} m)${stale ? " · old fix" : ""}`}
      tone={inside ? "good" : "warn"}
    />
  );
}

const STATUS_COPY: Record<QueueItem["status"], string> = {
  queued: "Waiting to upload",
  uploading: "Uploading…",
  finalizing: "Verifying…",
  verified: "Verified ✓",
  rejected: "Failed",
};

export function SlotTile({
  slot,
  item,
  hashing,
  required,
  onPress,
}: {
  slot: string;
  item?: QueueItem;
  hashing?: boolean;
  required?: boolean;
  onPress: () => void;
}) {
  const status = hashing ? "Hashing…" : item ? STATUS_COPY[item.status] : required ? "Needed" : "Optional";
  const tone =
    item?.status === "verified" ? colors.accent : item?.status === "rejected" ? colors.danger : item ? colors.warn : colors.fgMuted;
  const retrying = item && item.status === "queued" && item.attempts > 0;
  return (
    <View style={s.tileWrap}>
      <Pressable
        onPress={onPress}
        style={[s.tile, !item && s.tileEmpty, item?.status === "verified" && { borderColor: colors.accent }]}
        accessibilityLabel={`${slotTitle(slot)}: ${status}. Tap to ${item ? "retake" : "capture"}.`}
      >
        {item && item.mime.startsWith("image/") ? (
          <Image source={{ uri: item.localUri }} style={StyleSheet.absoluteFill} />
        ) : item ? (
          <Ionicons name="videocam" size={28} color={colors.fgMuted} />
        ) : (
          <Ionicons name={slot === VIDEO_SLOT ? "videocam-outline" : "camera-outline"} size={26} color={colors.fgMuted} />
        )}
        {hashing || item?.status === "uploading" || item?.status === "finalizing" ? (
          <View style={s.tileOverlay}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
        {item?.status === "verified" ? (
          <View style={s.tick}>
            <Ionicons name="checkmark" size={14} color="#fff" />
          </View>
        ) : null}
      </Pressable>
      <Text style={s.tileLabel} numberOfLines={1}>
        {slotTitle(slot)}
      </Text>
      <Text style={[s.tileStatus, { color: tone }]} numberOfLines={1}>
        {retrying ? `Retrying (${item.attempts})` : status}
      </Text>
      {item && (item.status === "rejected" || retrying) ? (
        <Pressable onPress={() => retryItem(item.localId)}>
          <Text style={s.retry}>Retry now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Grid of slots + the guided camera. */
export function SlotGrid({
  ev,
  slots,
  allowVideo,
  title = "PHOTOS (in-app camera only)",
}: {
  ev: Evidence;
  slots: string[];
  allowVideo?: boolean;
  title?: string;
}) {
  const [camera, setCamera] = useState<{ order: string[]; index: number; video: boolean } | null>(null);
  const done = slots.filter((x) => ev.verified(x)).length;

  function openAt(slot: string) {
    // Guided: start at the tapped slot, then walk the remaining missing slots in order.
    const missing = slots.filter((x) => x !== slot && !ev.slots[x]);
    setCamera({ order: [slot, ...missing], index: 0, video: false });
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.sectionTitle}>
          {done} / {slots.length}
        </Text>
      </View>
      <View style={s.grid}>
        {slots.map((slot) => (
          <SlotTile
            key={slot}
            slot={slot}
            item={ev.slots[slot]}
            hashing={ev.hashing[slot]}
            required
            onPress={() => openAt(slot)}
          />
        ))}
        {allowVideo ? (
          <SlotTile
            slot={VIDEO_SLOT}
            item={ev.slots[VIDEO_SLOT]}
            hashing={ev.hashing[VIDEO_SLOT]}
            onPress={() => setCamera({ order: [VIDEO_SLOT], index: 0, video: true })}
          />
        ) : null}
      </View>
      {slots.some((x) => !ev.slots[x]) ? (
        <Button
          title={done === 0 && !Object.keys(ev.slots).length ? "Start guided capture" : "Capture remaining photos"}
          icon="camera"
          variant="secondary"
          onPress={() => {
            const missing = slots.filter((x) => !ev.slots[x]);
            if (missing.length) setCamera({ order: missing, index: 0, video: false });
          }}
        />
      ) : null}
      {ev.error ? <Text style={{ color: colors.danger }}>{ev.error}</Text> : null}
      {camera ? (
        <CaptureCamera
          slot={camera.order[camera.index]}
          step={camera.index + 1}
          total={camera.order.length}
          video={camera.video}
          ev={ev}
          onCaptured={() => {
            if (camera.index + 1 < camera.order.length) setCamera({ ...camera, index: camera.index + 1 });
            else setCamera(null);
          }}
          onClose={() => setCamera(null)}
        />
      ) : null}
    </View>
  );
}

/** Full-screen in-app camera. Photo: one shutter per slot. Video: ≤15 s, muted. */
export function CaptureCamera({
  slot,
  step,
  total,
  video,
  ev,
  onCaptured,
  onClose,
}: {
  slot: string;
  step: number;
  total: number;
  video: boolean;
  ev: Evidence;
  onCaptured: () => void;
  onClose: () => void;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) void requestPerm();
  }, [perm, requestPerm]);

  useEffect(() => {
    if (recordingSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recordingSince]);

  async function shoot() {
    if (!ref.current || busy) return;
    setBusy(true);
    const capturedAt = new Date();
    const fix = ev.loc.shutterFix(capturedAt); // in parallel with the shutter
    try {
      const pic = await ref.current.takePictureAsync({ quality: 0.8, exif: false, skipProcessing: false });
      void ev.capture(slot, pic.uri, "image/jpeg", capturedAt, fix);
      onCaptured();
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (!ref.current) return;
    if (recordingSince !== null) {
      ref.current.stopRecording();
      return;
    }
    const capturedAt = new Date();
    const fix = ev.loc.shutterFix(capturedAt);
    setRecordingSince(Date.now());
    try {
      const res = await ref.current.recordAsync({ maxDuration: VIDEO_MAX_S });
      if (res?.uri) {
        // Android records MP4; iOS records a QuickTime (.mov) container. Label by what was actually written.
        void ev.capture(slot, res.uri, videoMime(res.uri), capturedAt, fix);
        onCaptured();
      }
    } finally {
      setRecordingSince(null);
    }
  }

  const elapsed = recordingSince !== null ? Math.max(0, Math.min(VIDEO_MAX_S, Math.floor((now - recordingSince) / 1000))) : 0;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {!perm?.granted ? (
          <SafeAreaView style={s.permBox}>
            <Text style={s.permText}>
              BorrowVault needs the camera to take handover and return photos. Photos can only be taken in the app, not
              picked from your gallery, so both neighbours can trust them.
            </Text>
            <Button title="Allow camera" onPress={() => void requestPerm()} />
            <Button title="Cancel" variant="ghost" onPress={onClose} />
          </SafeAreaView>
        ) : (
          <>
            <CameraView
              ref={ref}
              style={StyleSheet.absoluteFill}
              facing="back"
              mode={video ? "video" : "picture"}
              mute
              onCameraReady={() => setReady(true)}
            />
            <SafeAreaView style={s.camTop} edges={["top"]}>
              <Pressable onPress={onClose} style={s.camClose} accessibilityLabel="Close camera" disabled={recordingSince !== null}>
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={s.camStep}>{video ? "Optional video" : `Photo ${step} of ${total}`}</Text>
                <Text style={s.camSlot}>{slotTitle(slot)}</Text>
              </View>
            </SafeAreaView>
            <SafeAreaView style={s.camBottom} edges={["bottom"]}>
              <GeofenceChip ev={ev} />
              {video ? (
                <Text style={s.camHint}>
                  {recordingSince !== null ? `Recording ${elapsed}s / ${VIDEO_MAX_S}s` : `Walk around the item, up to ${VIDEO_MAX_S} seconds`}
                </Text>
              ) : (
                <Text style={s.camHint}>Fill the frame with the {slotTitle(slot).toLowerCase()}</Text>
              )}
              <Pressable
                onPress={video ? toggleRecord : shoot}
                disabled={!ready || busy}
                style={[s.shutter, video && recordingSince !== null && { backgroundColor: colors.danger }, (!ready || busy) && { opacity: 0.4 }]}
                accessibilityLabel={video ? (recordingSince !== null ? "Stop recording" : "Start recording") : "Take photo"}
              >
                {video ? (
                  <Ionicons name={recordingSince !== null ? "stop" : "videocam"} size={30} color={recordingSince !== null ? "#fff" : colors.danger} />
                ) : null}
              </Pressable>
            </SafeAreaView>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sectionTitle: { fontSize: 12, fontWeight: "800", color: colors.fgMuted, letterSpacing: 0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tileWrap: { width: "30%", minWidth: 96 },
  tile: {
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tileEmpty: { borderStyle: "dashed" },
  tileOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  tick: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { fontSize: 13, fontWeight: "700", color: colors.fg, marginTop: 4 },
  tileStatus: { fontSize: 11, fontWeight: "600" },
  retry: { fontSize: 12, fontWeight: "700", color: colors.accent, marginTop: 2 },
  permBox: { flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: colors.bg },
  permText: { fontSize: 15, color: colors.fg, lineHeight: 22 },
  camTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", padding: 12, gap: 12, backgroundColor: "rgba(0,0,0,0.35)" },
  camClose: { padding: 4 },
  camStep: { color: "#e4e4e7", fontSize: 13 },
  camSlot: { color: "#fff", fontSize: 20, fontWeight: "800" },
  camBottom: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", gap: 10, paddingBottom: 24, paddingTop: 12, backgroundColor: "rgba(0,0,0,0.35)" },
  camHint: { color: "#fff", fontSize: 14 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#fff",
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});

function videoMime(uri: string): MediaMime {
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "mov" || ext === "qt") return "video/quicktime";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  return Platform.OS === "ios" ? "video/quicktime" : "video/mp4";
}
