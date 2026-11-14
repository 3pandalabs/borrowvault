// Residents waiting for a society admin's approval (api/ROUTES.md "Join request
// notice"). Pure: no React Native imports, so node --test can load it.

type MembershipLike = { societyId: string; role: string; status: string };

/** Society ids where the user is an approved admin, i.e. can review join requests. */
export function adminSocietyIds(memberships: readonly MembershipLike[] | null | undefined): string[] {
  return [...new Set((memberships ?? []).filter((m) => m.role === "society_admin" && m.status === "approved").map((m) => m.societyId))];
}

/** Sum of the per-society pending counts. */
export function pendingTotal(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((a, n) => a + (n > 0 ? n : 0), 0);
}

/** "1 resident waiting for approval" / "3 residents waiting for approval". */
export function joinRequestsHeadline(n: number): string {
  return `${n} resident${n === 1 ? "" : "s"} waiting for approval`;
}

/** `data` of a join request push → true. */
export function isJoinRequestPush(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { type?: unknown }).type === "join_request";
}

/** "A-101", or whichever part exists. */
export function flatLabel(m: { towerName: string | null; flatNo: string | null }): string {
  return [m.towerName, m.flatNo].filter((x) => x && x.trim()).join("-");
}
