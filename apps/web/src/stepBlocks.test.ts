import { describe, expect, it } from "vitest";
import type { Step } from "./api";
import { toBlocks, toSteps } from "./stepBlocks";

const email = (id: string, name = id): Step => ({ id, type: "email", name, delayDays: 0, delayMinutes: 0, variants: [{ id: `${id}-v`, label: "A", subject: "s", bodyHtml: "<p>b</p>", weight: 1 }] });
const delay = (id: string, days: number, minutes = 0): Step => ({ id, type: "delay", name: "", delayDays: days, delayMinutes: minutes, variants: [] });
const shape = (steps: Step[]) => steps.map((s) => `${s.type}:${s.id ?? "new"}:${s.delayDays}:${s.delayMinutes}`);

describe("step blocks", () => {
  it("round-trips an existing sequence without adding or moving steps", () => {
    const steps = [email("e1"), delay("d1", 3), email("e2"), delay("d2", 2), email("e3")];
    expect(shape(toSteps(toBlocks(steps)))).toEqual(shape(steps));
  });

  it("keeps a leading zero-day delay and adjacent emails exactly as they were", () => {
    expect(shape(toSteps(toBlocks([delay("d0", 0), email("e1")])))).toEqual(["delay:d0:0:0", "email:e1:0:0"]);
    expect(shape(toSteps(toBlocks([email("e1"), email("e2")])))).toEqual(["email:e1:0:0", "email:e2:0:0"]);
  });

  it("adds a delay step for a new email with a wait, and none for a first email with no wait", () => {
    const blocks = toBlocks([email("e1")]);
    blocks.push({ waitMinutes: 2 * 1440, name: "Follow-up", variants: [{ label: "A", subject: "", bodyHtml: "", weight: 1 }] });
    expect(shape(toSteps(blocks))).toEqual(["email:e1:0:0", "delay:new:2:0", "email:new:0:0"]);
  });

  it("sums consecutive delays into one wait", () => {
    expect(toBlocks([email("e1"), delay("d1", 1), delay("d2", 2), email("e2")])[1]?.waitMinutes).toBe(3 * 1440);
  });

  it("stores a wait before the first email in minutes, and whole days as days", () => {
    const first = toBlocks([email("e1")]);
    first[0] = { ...first[0]!, waitMinutes: 10 };
    expect(shape(toSteps(first))).toEqual(["delay:new:0:10", "email:e1:0:0"]);
    first[0] = { ...first[0]!, waitMinutes: 2 * 1440 };
    expect(shape(toSteps(first))).toEqual(["delay:new:2:0", "email:e1:0:0"]);
  });

  it("reads minutes and days back as one wait", () => {
    expect(toBlocks([delay("d0", 1, 90), email("e1")])[0]?.waitMinutes).toBe(1440 + 90);
  });
});
