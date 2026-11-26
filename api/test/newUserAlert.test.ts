import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEW_USER_ALERT_TO, newUserAlertTo, newUserMail, notifyNewUser } from "../src/lib/newUserAlert.js";

const u = {
  userId: "11111111-2222-3333-4444-555555555555",
  email: "priya@example.com",
  phone: "+919876543210",
  displayName: "Priya <b>&</b>\nRao",
  at: new Date("2026-11-26T10:05:30Z"),
};
const ok = { delivered: 1, failed: 0, skipped: 0 };

afterEach(() => {
  delete process.env.NEW_USER_ALERT_EMAIL;
});

describe("new user alert", () => {
  it("recipient: default org inbox, override, and 'off'", () => {
    expect(newUserAlertTo(undefined)).toBe(DEFAULT_NEW_USER_ALERT_TO);
    expect(DEFAULT_NEW_USER_ALERT_TO).toBe("3pandas@3pandalabs.com");
    expect(newUserAlertTo("  ")).toBe(DEFAULT_NEW_USER_ALERT_TO);
    expect(newUserAlertTo(" ops@example.com ")).toBe("ops@example.com");
    expect(newUserAlertTo("OFF")).toBeNull();
  });

  it("mail: exact subject, all fields in text + html, user text escaped", () => {
    const m = newUserMail("to@example.com", { ...u, societyName: "Demo Heights" });
    expect(m.to).toBe("to@example.com");
    expect(m.subject).toBe("BorrowVault New user");
    for (const part of [m.text, m.html]) {
      for (const s of ["BorrowVault", "priya@example.com", "+919876543210", "Demo Heights", "2026-11-26 10:05 UTC", u.userId]) {
        expect(part).toContain(s);
      }
    }
    expect(m.text).toContain("Name: Priya <b>&</b> Rao");
    expect(m.html).toContain("Priya &lt;b&gt;&amp;&lt;/b&gt; Rao");
    expect(m.html).not.toContain("<b>&</b>");
  });

  it("mail: optional rows left out when absent", () => {
    const m = newUserMail("to@example.com", { userId: "id", email: "a@b.co" });
    expect(m.text).not.toContain("Society");
    expect(m.text).not.toContain("Phone");
    expect(m.text).not.toContain("Name:");
  });

  it("sends one mail to the resolved recipient, without being awaited", () => {
    const send = vi.fn().mockResolvedValue(ok);
    process.env.NEW_USER_ALERT_EMAIL = "ops@example.com";
    expect(notifyNewUser(u, () => {}, { send, configured: () => true })).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0][0].to).toBe("ops@example.com");
  });

  it("sends nothing when off or the mailer isn't configured", () => {
    const send = vi.fn().mockResolvedValue(ok);
    process.env.NEW_USER_ALERT_EMAIL = "off";
    notifyNewUser(u, () => {}, { send, configured: () => true });
    delete process.env.NEW_USER_ALERT_EMAIL;
    notifyNewUser(u, () => {}, { send, configured: () => false });
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws: a rejected or throwing send only logs", async () => {
    const log = vi.fn();
    notifyNewUser(u, log, { send: vi.fn().mockRejectedValue(new Error("smtp down")), configured: () => true });
    expect(() =>
      notifyNewUser(u, log, {
        send: () => {
          throw new Error("sync boom");
        },
        configured: () => true,
      }),
    ).not.toThrow();
    notifyNewUser(u, log, { send: vi.fn().mockResolvedValue({ delivered: 0, failed: 1, skipped: 0 }), configured: () => true });
    await new Promise((r) => setTimeout(r, 0));
    const msgs = log.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes("smtp down"))).toBe(true);
    expect(msgs.some((m) => m.includes("sync boom"))).toBe(true);
    expect(msgs.some((m) => m.includes("not delivered"))).toBe(true);
  });
});
