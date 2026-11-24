import type { Step, ThreadMode, Variant } from "./api";

const DAY = 1440;

// The editor shows "blocks": one email plus the wait before it. They map onto [delay, email, delay, email…] steps.
// The wait is kept in minutes; a delay step stores it as whole days when it can, otherwise as minutes.
export interface Block { id?: string; delayId?: string; waitMinutes: number; name: string; threadMode?: ThreadMode | null; variants: Variant[]; sent?: number; waiting?: number }

export function toBlocks(steps: Step[]): Block[] {
  const blocks: Block[] = [];
  let wait = 0;
  let delayId: string | undefined;
  for (const s of steps) {
    if (s.type === "delay") { wait += s.delayDays * DAY + (s.delayMinutes ?? 0); delayId = s.id; continue; }
    blocks.push({ id: s.id, delayId, waitMinutes: wait, name: s.name, threadMode: s.threadMode ?? null, variants: s.variants.map((v) => ({ ...v })), sent: s.sent, waiting: s.waiting });
    wait = 0;
    delayId = undefined;
  }
  return blocks;
}

// A delay step is only written when there was one already or the wait is above zero, so step positions
// (which launched contacts point at) don't shift just from opening and saving a sequence.
export function toSteps(blocks: Block[]): Step[] {
  return blocks.flatMap((b) => {
    const whole = b.waitMinutes % DAY === 0;
    return [
      ...(b.delayId || b.waitMinutes > 0
        ? [{ id: b.delayId, type: "delay" as const, name: "", delayDays: whole ? b.waitMinutes / DAY : 0, delayMinutes: whole ? 0 : b.waitMinutes, variants: [] }]
        : []),
      { id: b.id, type: "email" as const, name: b.name, delayDays: 0, delayMinutes: 0, threadMode: b.threadMode ?? null, variants: b.variants },
    ];
  });
}
