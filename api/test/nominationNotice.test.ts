import { describe, expect, it } from "vitest";
import { nominationMail, nominationPushMessages, nominationSubject } from "../src/lib/nominationNotice.js";

const URL = "https://borrowvault.3pandalabs.com/admin-requests";
const n = { nominatorName: "Asha Rao", societyName: "Lake View <Phase 2>", url: URL };

describe("co-admin nomination email", () => {
  it("subject names the nominator and the society", () => {
    expect(nominationSubject(n)).toBe("Asha Rao nominated you as a co-admin of Lake View <Phase 2>");
    expect(nominationSubject({ ...n, nominatorName: "  " })).toBe("An admin of your society nominated you as a co-admin of Lake View <Phase 2>");
  });

  it("text part: nominator, society, what a co-admin does, next steps, 48 h rule, link", () => {
    const m = nominationMail("nominee@example.com", n);
    expect(m.to).toBe("nominee@example.com");
    expect(m.subject).toBe(nominationSubject(n));
    expect(m.text).toContain("Asha Rao has nominated you to become a co-admin of Lake View <Phase 2>");
    expect(m.text).toContain("approve residents");
    expect(m.text).toContain("upload your own ID proof");
    expect(m.text).toContain("decline");
    expect(m.text).toContain("48 hours");
    expect(m.text).toContain(URL);
  });

  it("HTML part: the link is a real button and a clickable raw link, values escaped", () => {
    const m = nominationMail("nominee@example.com", n);
    expect(m.html.match(new RegExp(`<a href="${URL}"`, "g"))?.length).toBe(2);
    expect(m.html).toContain("Review nomination");
    expect(m.html).toContain("Lake View &lt;Phase 2&gt;");
    expect(m.html).not.toContain("<Phase 2>");
    expect(m.html).toContain("48 hours");
  });
});

describe("co-admin nomination push", () => {
  it("one message per token, typed for the app's tap handler", () => {
    const msgs = nominationPushMessages(["ExponentPushToken[a]", "ExponentPushToken[b]"], { ...n, requestId: "r1" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      to: "ExponentPushToken[a]",
      title: "You've been nominated as a co-admin",
      body: "Asha Rao nominated you as a co-admin of Lake View <Phase 2>. Tap to review.",
      data: { type: "admin_nomination", requestId: "r1" },
      sound: "default",
      channelId: "default",
    });
  });
});
