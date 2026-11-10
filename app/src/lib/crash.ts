// Crash reporting (Sentry). Off unless EXPO_PUBLIC_SENTRY_DSN is set at build
// time, so builds without it behave exactly as before.
//
// Privacy: no default PII (no IP, no email), no breadcrumbs from network
// bodies, and the user is identified only by their opaque id. The privacy
// policy (web/src/app/privacy, section 6) lists Sentry as a processor.
import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const crashReportingEnabled = !!dsn;

export function initCrashReporting() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    environment: __DEV__ ? "development" : (Updates.channel || "unknown"),
    // OTA updates change the JS without changing the app version, so tag
    // each crash with the update it came from.
    dist: Updates.updateId ?? "embedded",
    tracesSampleRate: 0,
    beforeBreadcrumb(crumb) {
      // Request/response bodies can hold chat text or phone numbers.
      if (crumb.category === "xhr" || crumb.category === "fetch") {
        const { url, method, status_code } = (crumb.data ?? {}) as Record<string, unknown>;
        crumb.data = { url: typeof url === "string" ? url.split("?")[0] : url, method, status_code };
      }
      return crumb;
    },
  });
}

export function setCrashUser(userId: string | null) {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

// Sentry.wrap only when enabled; otherwise return the component unchanged.
export function wrapRoot(Component: React.ComponentType<Record<string, unknown>>): React.ComponentType<Record<string, unknown>> {
  return dsn ? Sentry.wrap(Component) : Component;
}
