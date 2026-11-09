import { describe, expect, it } from "vitest";
import { classifyInbound, extractReturnDate } from "./classify";
import { composeEmail } from "./compose";
import { espFromMx } from "./esp";
import { htmlToText, listVariables, render } from "./render";
import { spamCheck } from "./spam-check";

describe("render", () => {
  const vars = { first_name: "Matt", Company: "Acme & Co", empty: "" };

  it("substitutes variables case-insensitively with fallbacks", () => {
    expect(render("Hi {{First Name}} at {{company}}, {{empty:friend}} {{missing:there}}", vars, { seed: "x" }))
      .toBe("Hi Matt at Acme & Co, friend there");
  });

  it("escapes variable values in HTML mode", () => {
    expect(render("<p>{{company}}</p>", vars, { seed: "x", html: true })).toBe("<p>Acme &amp; Co</p>");
  });

  it("is deterministic per seed and covers every option", () => {
    const t = "{{Hi|Hello|Hey}} {{first_name}}";
    expect(render(t, vars, { seed: "c1:s1" })).toBe(render(t, vars, { seed: "c1:s1" }));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => render(t, vars, { seed: `c${i}` })));
    expect(seen).toEqual(new Set(["Hi Matt", "Hello Matt", "Hey Matt"]));
  });

  it("supports nested spintax and variables inside options", () => {
    const out = render("{{Hi {{first_name}}|{{Hello|Hey}} there}}", vars, { seed: "n" });
    expect(["Hi Matt", "Hello there", "Hey there"]).toContain(out);
  });

  it("never parses syntax inside variable values", () => {
    expect(render("{{x}}", { x: "{{a|b}}" }, { seed: "s" })).toBe("{{a|b}}");
  });

  it("lists variables but not spin options", () => {
    expect(listVariables("{{Hi|Hey}} {{first_name}} {{Company:you}}").sort()).toEqual(["company", "first_name"]);
  });

  it("converts html to text", () => {
    expect(htmlToText('<p>Hi&nbsp;there</p><p>See <a href="https://x.io">site</a></p>')).toBe("Hi there\nSee site (https://x.io)");
  });
});

describe("spamCheck", () => {
  it("scores a clean short email as good", () => {
    const r = spamCheck("quick question", "<p>Hi Matt, saw your team is hiring SDRs. Are you open to a short chat next week about how others ramp new reps faster without extra tools?</p>");
    expect(r.rating).toBe("good");
  });

  it("flags spammy content", () => {
    const r = spamCheck("ACT NOW!!! Limited time FREE GIFT", '<p>Click here <a href="https://a">a</a> <a href="https://b">b</a> <a href="https://c">c</a> to get 50% off! Guarantee! Winner!</p><img src="x">');
    expect(r.rating).toBe("poor");
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["spam_words", "links", "images", "subject_punct", "caps"]));
  });
});

describe("compose", () => {
  it("adds opt-out link and one-click unsubscribe headers, skips tracking in plain text", () => {
    const e = composeEmail({
      from: { name: "Mark", address: "mark@acme.io" },
      to: "matt@x.com",
      subject: "hello",
      bodyHtml: '<p>Hi <a href="https://acme.io">acme</a></p>',
      plainText: true,
      optOut: { url: "https://t.acme.io/u/abc", text: "Not interested? Opt out" },
      openPixelUrl: "https://t.acme.io/o/1",
      clickRewrite: (u) => `https://t.acme.io/c?u=${u}`,
    });
    expect(e.html).toBe("");
    expect(e.text).toContain("https://t.acme.io/u/abc");
    expect(e.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(e.messageId).toMatch(/^<.+@acme\.io>$/);
  });

  it("threads follow-ups with Re: subject and tracks clicks except opt-out", () => {
    const e = composeEmail({
      from: { name: "Mark", address: "mark@acme.io" },
      to: "matt@x.com",
      subject: "hello",
      bodyHtml: '<a href="https://acme.io">acme</a>',
      plainText: false,
      optOut: { url: "https://t.acme.io/u/abc", text: "Opt out" },
      clickRewrite: (u) => `https://t.acme.io/c?u=${encodeURIComponent(u)}`,
      thread: { inReplyTo: "<a@acme.io>", references: ["<a@acme.io>"] },
    });
    expect(e.subject).toBe("Re: hello");
    expect(e.html).toContain("https://t.acme.io/c?u=https%3A%2F%2Facme.io");
    expect(e.html).toContain('href="https://t.acme.io/u/abc"');
  });
});

describe("classifyInbound", () => {
  const base = { from: "matt@x.com", subject: "Re: hello", text: "", headers: {} };

  it("detects hard bounces and the failed recipient", () => {
    const c = classifyInbound({ ...base, from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", text: "Final-Recipient: rfc822; bob@nowhere.com\nStatus: 5.1.1 The email account does not exist" });
    expect(c).toMatchObject({ kind: "bounce", bounceType: "hard", bouncedRecipient: "bob@nowhere.com" });
  });

  it("detects out of office with a return date", () => {
    const c = classifyInbound({ ...base, subject: "Automatic reply: hello", text: "I am out of the office until 14 November 2026.", receivedAt: new Date("2026-11-03T10:00:00Z") });
    expect(c.kind).toBe("out_of_office");
    expect(c.returnDate?.toISOString().slice(0, 10)).toBe("2026-11-14");
  });

  it("does not treat a human reply mentioning being back as OOO", () => {
    expect(classifyInbound({ ...base, text: "Sounds good, I'm back on Monday - let's talk then." }).kind).toBe("reply");
  });

  it("detects unsubscribe requests", () => {
    expect(classifyInbound({ ...base, text: "Please remove me from your list.\n\nOn Mon, Mark wrote:\n> hi" }).kind).toBe("unsubscribe");
    expect(classifyInbound({ ...base, text: "Stop" }).kind).toBe("unsubscribe");
  });

  it("detects generic auto replies via headers", () => {
    expect(classifyInbound({ ...base, headers: { "Auto-Submitted": "auto-replied" }, text: "Thanks, we got your message." }).kind).toBe("auto_reply");
  });

  it("parses common return date formats", () => {
    const now = new Date("2026-11-03T00:00:00Z");
    expect(extractReturnDate("Back on November 20th", now)?.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(extractReturnDate("returning 2026-12-01", now)?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(extractReturnDate("away until 5 Jan", now)?.toISOString().slice(0, 10)).toBe("2027-01-05");
  });
});

describe("espFromMx", () => {
  it("maps MX hosts to providers", () => {
    expect(espFromMx(["aspmx.l.google.com"])).toBe("google");
    expect(espFromMx(["acme-io.mail.protection.outlook.com"])).toBe("microsoft");
    expect(espFromMx(["mx.zoho.com"])).toBe("other");
    expect(espFromMx([])).toBe("unknown");
  });
});
