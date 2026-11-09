import type { Step, Variant } from "./api";

// The editor shows "blocks": one email plus the wait before it. They map onto [delay, email, delay, email…] steps.
export interface Block { id?: string; delayId?: string; waitDays: number; name: string; variants: Variant[] }

export function toBlocks(steps: Step[]): Block[] {
  const blocks: Block[] = [];
  let wait = 0;
  let delayId: string | undefined;
  for (const s of steps) {
    if (s.type === "delay") { wait += s.delayDays; delayId = s.id; continue; }
    blocks.push({ id: s.id, delayId, waitDays: wait, name: s.name, variants: s.variants.map((v) => ({ ...v })) });
    wait = 0;
    delayId = undefined;
  }
  return blocks;
}

// A delay step is only written when there was one already or the wait is above zero, so step positions
// (which launched contacts point at) don't shift just from opening and saving a sequence.
export function toSteps(blocks: Block[]): Step[] {
  return blocks.flatMap((b) => [
    ...(b.delayId || b.waitDays > 0 ? [{ id: b.delayId, type: "delay" as const, name: "", delayDays: b.waitDays, variants: [] }] : []),
    { id: b.id, type: "email" as const, name: b.name, delayDays: 0, variants: b.variants },
  ]);
}
