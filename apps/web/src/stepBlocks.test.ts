import { describe, expect, it } from "vitest";
import type { Step } from "./api";
import { toBlocks, toSteps } from "./stepBlocks";

const email = (id: string, name = id): Step => ({ id, type: "email", name, delayDays: 0, variants: [{ id: `${id}-v`, label: "A", subject: "s", bodyHtml: "<p>b</p>", weight: 1 }] });
const delay = (id: string, days: number): Step => ({ id, type: "delay", name: "", delayDays: days, variants: [] });
const shape = (steps: Step[]) => steps.map((s) => `${s.type}:${s.id ?? "new"}:${s.delayDays}`);

describe("step blocks", () => {
  it("round-trips an existing sequence without adding or moving steps", () => {
    const steps = [email("e1"), delay("d1", 3), email("e2"), delay("d2", 2), email("e3")];
    expect(shape(toSteps(toBlocks(steps)))).toEqual(shape(steps));
  });

  it("keeps a leading zero-day delay and adjacent emails exactly as they were", () => {
    expect(shape(toSteps(toBlocks([delay("d0", 0), email("e1")])))).toEqual(["delay:d0:0", "email:e1:0"]);
    expect(shape(toSteps(toBlocks([email("e1"), email("e2")])))).toEqual(["email:e1:0", "email:e2:0"]);
  });

  it("adds a delay step for a new email with a wait, and none for a first email with no wait", () => {
    const blocks = toBlocks([email("e1")]);
    blocks.push({ waitDays: 2, name: "Follow-up", variants: [{ label: "A", subject: "", bodyHtml: "", weight: 1 }] });
    expect(shape(toSteps(blocks))).toEqual(["email:e1:0", "delay:new:2", "email:new:0"]);
  });

  it("sums consecutive delays into one wait", () => {
    expect(toBlocks([email("e1"), delay("d1", 1), delay("d2", 2), email("e2")])[1]?.waitDays).toBe(3);
  });
});
