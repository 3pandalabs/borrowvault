// Flows that need document uploads or admin consoles live on the web app.
// Keep this free of React Native imports so `npm test` can load it.

/** The BorrowVault web app (no trailing slash). */
export const WEB_URL = "https://borrowvault.3pandalabs.com";

/** Self-serve "register my society" (a `new_society` admin request). */
export const registerSocietyUrl = () => `${WEB_URL}/societies/register`;

/** "Make me an admin of a society I live in" (a `join_admin` admin request). */
/** My admin requests, including co-admin nominations to accept (ID upload) or decline. */
export const myAdminRequestsUrl = () => `${WEB_URL}/admin-requests`;

/** Society admin console; the Admins tab is where co-admins are nominated. */
export const societyAdminsUrl = (societyId: string) =>
  `${WEB_URL}/admin/${encodeURIComponent(societyId)}?tab=admins`;

export const adminRequestUrl = (societyId: string) =>
  `${WEB_URL}/admin-requests/new?societyId=${encodeURIComponent(societyId)}`;
