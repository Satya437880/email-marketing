import { describe, expect, it } from "vitest";
import { unlinkContactDetails } from "./plain-details";

const strip = (s: string) => s.replaceAll("‌", "").replace(/<a style="[^"]*">|<\/a>/g, "");

describe("unlinkContactDetails", () => {
  const sig = "<div>487 Grantham Ave, St. Catharines, Ontario L2M 6W1, CA</div><div>Call us: +1 (647) 671-4516</div>";

  it("breaks up the address and phone without changing what is read", () => {
    const out = unlinkContactDetails(sig);
    expect(strip(out)).toBe(sig);
    expect(out).not.toContain("487");
    expect(out).not.toContain("Grantham Ave");
    expect(out).not.toContain("L2M 6W1");
    expect(out).not.toMatch(/\d\d/);
  });

  it("wraps them in a link tag with no destination, only once", () => {
    const out = unlinkContactDetails(sig);
    expect(out.match(/<a style="color:inherit;text-decoration:none;cursor:text">/g)).toHaveLength(2);
    expect(out).not.toContain("href");
    expect(unlinkContactDetails(out)).toBe(out);
  });

  it("leaves links, email addresses, web addresses and tags alone", () => {
    const html = '<p style="font-size:10px"><a href="tel:+16476714516">+1 647 671 4516</a> sales@acme2024.com www.acme.com</p>';
    expect(unlinkContactDetails(html)).toBe(html);
  });
});
