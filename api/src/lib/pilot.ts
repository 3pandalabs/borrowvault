import { DomainError, forbidden, invalid } from "./errors.js";

// Pilot societies (api/ROUTES.md "Pilot societies"). A society approved from a
// self-serve new_society request starts as a pilot and stays one until a
// platform admin marks it verified. Pure rules here; the routes do the lookups.

export type SocietyTier = "pilot" | "verified";

/** Approved memberships allowed in a pilot society, admins included. */
export const PILOT_MAX_MEMBERS = 50;
/** Cap on a listing's depositPaise and replacementValuePaise in a pilot (₹5,000). */
export const PILOT_MAX_VALUE_PAISE = 500_000;

export const isPilot = (tier: string | null | undefined): boolean => tier === "pilot";

/** True when a pilot society has no room for another approved member. */
export function pilotFull(tier: string, approvedCount: number): boolean {
  return isPilot(tier) && approvedCount >= PILOT_MAX_MEMBERS;
}

/** 409 society_full when approving one more member would pass the pilot cap. */
export function assertRoomForMember(tier: string, approvedCount: number): void {
  if (pilotFull(tier, approvedCount)) throw new DomainError("CONFLICT", "society_full");
}

/** 400 pilot_value_cap when a pilot listing's deposit or replacement value is over ₹5,000. */
export function assertPilotListingValues(
  tier: string,
  l: { depositPaise: number; replacementValuePaise?: number | null },
): void {
  if (!isPilot(tier)) return;
  if (l.depositPaise > PILOT_MAX_VALUE_PAISE || (l.replacementValuePaise ?? 0) > PILOT_MAX_VALUE_PAISE) {
    throw invalid("pilot_value_cap");
  }
}

/**
 * Who may rule a dispute, on top of the arbiter rule (not a party, not in a
 * party's unit), which the caller still enforces for everyone. In a pilot only
 * platform admins rule; a society admin gets 403 pilot_platform_rules.
 */
export function assertMayRule(tier: string, callerIsPlatformAdmin: boolean): void {
  if (isPilot(tier) && !callerIsPlatformAdmin) throw forbidden("pilot_platform_rules");
}
