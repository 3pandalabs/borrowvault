import { Linking } from "react-native";
import type { BookingDetail, Inspection, InspectionPhase } from "./types";

export function myInspection(b: BookingDetail, phase: InspectionPhase): Inspection | undefined {
  return b.inspections.find((i) => i.phase === phase && i.party === b.myRole);
}

export function otherInspection(b: BookingDetail, phase: InspectionPhase): Inspection | undefined {
  return b.inspections.find((i) => i.phase === phase && i.party !== b.myRole);
}

export function counterParty(b: BookingDetail) {
  return b.myRole === "lender" ? b.borrower : b.lender;
}

export const PRE_ACTIVE = new Set(["REQUESTED", "ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING"]);

/**
 * Hand a `upi://pay?...` intent to whichever UPI app the user has. We never
 * build or alter the link: the API owns amount, payee and note.
 */
export async function openUpi(url: string): Promise<string | null> {
  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return "No UPI app found. Install Google Pay, PhonePe, Paytm or your bank's UPI app, then try again.";
  }
}

/** Pulls the payee VPA out of a UPI intent for display ("pay priya@okicici"). */
export function upiPayee(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /[?&]pa=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Location flag for an inspection or media item (server-computed). */
export function fenceFlag(x: { withinGeofence: boolean; noLocation: boolean }): { label: string; ok: boolean } {
  if (x.noLocation) return { label: "📍 No location (no GPS fix)", ok: false };
  return x.withinGeofence ? { label: "📍 Inside society ✓", ok: true } : { label: "📍 Outside society ⚠", ok: false };
}
