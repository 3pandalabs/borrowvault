// Co-admin nominations waiting for the signed-in user (api/ROUTES.md
// "Co-admin nominations"). Pure: no React Native imports, so node --test can load it.

type Row = { kind: string; status: string; nominatedBy: { displayName: string } | null; societyName: string };

/** Rows of GET /admin-requests/mine always have the caller as requester (= nominee). */
export function awaitingNominations<T extends Row>(list: readonly T[] | null | undefined): T[] {
  return (list ?? []).filter((r) => r.kind === "nominate_admin" && r.status === "nominated");
}

/** "<Nominator> nominated you as a co-admin of <Society>". */
export function nominationHeadline(r: Row): string {
  return `${r.nominatedBy?.displayName || "An admin of your society"} nominated you as a co-admin of ${r.societyName}`;
}

/** `data` of a co-admin nomination push → true. */
export function isNominationPush(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { type?: unknown }).type === "admin_nomination";
}
