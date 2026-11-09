import { addContactsToSequence, contactVariables, launchSequence, LaunchError, connectionFor, renderSignature, setSequenceStatus } from "@outreach/core";
import {
  contacts, db, DEFAULT_SEQUENCE_SETTINGS, labels, mailboxes, products, senderProfileMailboxes, senderProfiles, sequenceContacts, sequences, sequenceSenders, sequenceSteps, stepVariants,
  type SequenceSettings,
} from "@outreach/db";
import { composeEmail, render, sendSmtp, spamCheck } from "@outreach/mail";
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wsId } from "../auth";
import { body, HttpError, idParams, notFound, params, query } from "../http";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const settingsSchema = z.object({
  schedule: z.object({
    timezone: z.string(), days: z.array(z.number().int().min(0).max(6)).min(1), start: hhmm, end: hhmm,
    hours: z.record(z.string().regex(/^[0-6]$/), z.object({ start: hhmm, end: hhmm })).optional(),
  }),
  language: z.string().max(40),
  productId: z.string().uuid().nullable(),
  inSequencePriority: z.enum(["new_first", "followups_first"]),
  stopOnCompanyReply: z.boolean(),
  sequentialWithinCompany: z.boolean(),
  companyLimit: z.number().int().min(1).max(1000).nullable(),
  oooAutoResume: z.boolean(),
  oooBufferDays: z.number().int().min(0).max(30),
  plainText: z.boolean(),
  espMatching: z.boolean(),
  optOut: z.object({ enabled: z.boolean(), text: z.string().trim().max(200) }),
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  cc: z.array(z.string().email()).max(5),
  bcc: z.array(z.string().email()).max(5),
  pauseOnClick: z.boolean(),
  pauseOnOpen: z.boolean(),
  bounceShield: z.boolean(),
  trackOpportunities: z.boolean(),
}).partial();

const stepsSchema = z.object({
  steps: z.array(z.object({
    id: z.string().uuid().optional(),
    type: z.enum(["delay", "email"]),
    name: z.string().max(100).default(""),
    delayDays: z.number().int().min(0).max(365).default(0),
    variants: z.array(z.object({
      id: z.string().uuid().optional(),
      label: z.string().max(5),
      subject: z.string().max(500).default(""),
      bodyHtml: z.string().max(100000).default(""),
      weight: z.number().int().min(0).max(100).default(1),
    })).max(5).default([]),
  })).max(50),
});

const OPEN = ["queued", "active", "sending", "ooo"] as const;

async function owned(workspaceId: string, id: string) {
  const s = await db.query.sequences.findFirst({ where: and(eq(sequences.id, id), eq(sequences.workspaceId, workspaceId)) });
  if (!s) notFound("Sequence");
  return s;
}

async function loadSteps(sequenceId: string) {
  const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId)).orderBy(asc(sequenceSteps.position));
  const variants = steps.length ? await db.select().from(stepVariants).where(inArray(stepVariants.stepId, steps.map((s) => s.id))).orderBy(asc(stepVariants.label)) : [];
  const counts = steps.length ? await db.execute<{ step_id: string; sent: number }>(sql`
    select step_id, count(*)::int as sent from events where sequence_id = ${sequenceId} and type = 'sent' group by step_id
  `) as unknown as { step_id: string; sent: number }[] : [];
  const waiting = await db.execute<{ next_step: number; n: number }>(sql`
    select next_step, count(*)::int as n from sequence_contacts where sequence_id = ${sequenceId} and state in ('queued', 'active', 'sending', 'ooo') group by next_step
  `) as unknown as { next_step: number; n: number }[];
  return steps.map((s, i) => ({
    ...s,
    variants: variants.filter((v) => v.stepId === s.id),
    sent: counts.find((c) => c.step_id === s.id)?.sent ?? 0,
    waiting: waiting.find((w) => w.next_step === i)?.n ?? 0,
  }));
}

export async function sequenceRoutes(app: FastifyInstance) {
  app.get("/v1/workspaces/:ws/sequences", async (req) => {
    const q = query(req, z.object({ q: z.string().optional(), status: z.string().optional() }));
    const workspaceId = wsId(req);
    const rows = await db.select().from(sequences)
      .where(and(eq(sequences.workspaceId, workspaceId), q.q ? ilike(sequences.name, `%${q.q}%`) : undefined, q.status ? eq(sequences.status, q.status as "active") : undefined))
      .orderBy(desc(sequences.createdAt));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const stats = await db.execute<{ sequence_id: string; contacts: number; done: number; contacted: number }>(sql`
      select sequence_id, count(*)::int as contacts,
             count(*) filter (where state not in ('queued', 'active', 'sending', 'ooo'))::int as done,
             count(*) filter (where current_step >= 0)::int as contacted
      from sequence_contacts where sequence_id in ${ids} group by sequence_id
    `) as unknown as { sequence_id: string; contacts: number; done: number; contacted: number }[];
    type Ev = { sequence_id: string; sent: number; replied: number; positive: number; bounced: number; opted_out: number; opened: number; clicked: number };
    const ev = await db.execute<Ev>(sql`
      select s.id as sequence_id,
        count(*) filter (where e.type = 'sent')::int as sent,
        count(distinct e.contact_id) filter (where e.type = 'replied' and coalesce(e.meta->>'kind', 'reply') = 'reply')::int as replied,
        count(distinct e.contact_id) filter (where e.type = 'bounced')::int as bounced,
        count(distinct e.contact_id) filter (where e.type = 'opted_out')::int as opted_out,
        count(distinct e.contact_id) filter (where e.type = 'opened')::int as opened,
        count(distinct e.contact_id) filter (where e.type = 'clicked')::int as clicked,
        (select count(*)::int from threads t join labels l on l.id = t.label_id where t.sequence_id = s.id and l.counts_as in ('positive', 'meeting', 'closed')) as positive
      from sequences s left join events e on e.sequence_id = s.id
      where s.id in ${ids}
      group by s.id
    `) as unknown as Ev[];
    const senders = await db.select({ sequenceId: sequenceSenders.sequenceId, id: senderProfiles.id, name: senderProfiles.name })
      .from(sequenceSenders).innerJoin(senderProfiles, eq(senderProfiles.id, sequenceSenders.senderProfileId))
      .where(inArray(sequenceSenders.sequenceId, ids));
    return rows.map((r) => {
      const s = stats.find((x) => x.sequence_id === r.id);
      const e = ev.find((x) => x.sequence_id === r.id);
      return {
        ...r,
        contacts: s?.contacts ?? 0,
        progress: s?.contacts ? Math.round((s.done / s.contacts) * 100) : 0,
        contacted: s?.contacted ?? 0,
        emailsSent: e?.sent ?? 0,
        replied: e?.replied ?? 0,
        replyRate: s?.contacted ? (e?.replied ?? 0) / s.contacted : 0,
        positive: e?.positive ?? 0,
        bounced: e?.bounced ?? 0,
        optedOut: e?.opted_out ?? 0,
        opened: e?.opened ?? 0,
        clicked: e?.clicked ?? 0,
        senders: senders.filter((x) => x.sequenceId === r.id).map(({ id, name }) => ({ id, name })),
      };
    });
  });

  app.get("/v1/workspaces/:ws/reports/sequence-contacts.csv", async (req, reply) => {
    const q = query(req, z.object({ sequenceId: z.string().uuid().optional() }));
    const workspaceId = wsId(req);
    const rows = await db.execute<Record<string, unknown>>(sql`
      select s.name as sequence, c.email, c.first_name, c.last_name, c.company_name, sc.state, sc.current_step + 1 as emails_sent,
             sc.next_run_at, c.last_contacted_at
      from sequence_contacts sc join sequences s on s.id = sc.sequence_id join contacts c on c.id = sc.contact_id
      where sc.workspace_id = ${workspaceId} ${q.sequenceId ? sql`and sc.sequence_id = ${q.sequenceId}` : sql``}
      order by s.name, c.email limit 200000
    `) as unknown as Record<string, unknown>[];
    const cols = ["sequence", "email", "first_name", "last_name", "company_name", "state", "emails_sent", "next_run_at", "last_contacted_at"];
    const esc = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString() : String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    reply.header("content-type", "text/csv").header("content-disposition", 'attachment; filename="sequence-contacts.csv"');
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  });

  app.get("/v1/workspaces/:ws/products", async (req) => db.select().from(products).where(eq(products.workspaceId, wsId(req))).orderBy(asc(products.name)));

  app.post("/v1/workspaces/:ws/products", async (req) => {
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(5000).default("") }));
    const [row] = await db.insert(products).values({ workspaceId: wsId(req), ...b }).returning();
    return row;
  });

  app.delete("/v1/workspaces/:ws/products/:id", async (req) => {
    const p = params(req, idParams);
    await db.delete(products).where(and(eq(products.id, p.id), eq(products.workspaceId, wsId(req))));
    return { ok: true };
  });

  app.post("/v1/workspaces/:ws/sequences", async (req) => {
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120) }));
    const settings: SequenceSettings = structuredClone(DEFAULT_SEQUENCE_SETTINGS);
    settings.schedule.timezone = req.workspace!.timezone;
    const [seq] = await db.insert(sequences).values({ workspaceId: wsId(req), name: b.name, settings }).returning();
    // Start with the shape most sequences use: an email, a 3-day wait, and a follow-up in the same thread.
    const [s1, , s3] = await db.insert(sequenceSteps).values([
      { sequenceId: seq!.id, position: 0, type: "email", name: "Initial email" },
      { sequenceId: seq!.id, position: 1, type: "delay", delayDays: 3 },
      { sequenceId: seq!.id, position: 2, type: "email", name: "Follow-up 1" },
    ]).returning();
    await db.insert(stepVariants).values([
      { stepId: s1!.id, label: "A", subject: "", bodyHtml: "" },
      { stepId: s3!.id, label: "A", subject: "", bodyHtml: "" },
    ]);
    return seq;
  });

  app.get("/v1/workspaces/:ws/sequences/:id", async (req) => {
    const p = params(req, idParams);
    const seq = await owned(wsId(req), p.id);
    const senderRows = await db.select({ id: sequenceSenders.senderProfileId }).from(sequenceSenders).where(eq(sequenceSenders.sequenceId, seq.id));
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(sequenceContacts).where(eq(sequenceContacts.sequenceId, seq.id));
    return { ...seq, steps: await loadSteps(seq.id), senderProfileIds: senderRows.map((r) => r.id), contactCount: count?.n ?? 0 };
  });

  app.patch("/v1/workspaces/:ws/sequences/:id", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120).optional(), priority: z.enum(["high", "regular"]).optional(), settings: settingsSchema.optional() }));
    const seq = await owned(wsId(req), p.id);
    if (b.settings?.schedule) {
      try { new Intl.DateTimeFormat("en", { timeZone: b.settings.schedule.timezone }); } catch { throw new HttpError(400, "invalid_timezone", "Unknown time zone"); }
      if (b.settings.schedule.end <= b.settings.schedule.start) throw new HttpError(400, "invalid_schedule", "End time must be after start time");
    }
    const [row] = await db.update(sequences).set({
      name: b.name, priority: b.priority, settings: b.settings ? { ...seq.settings, ...b.settings } : undefined,
    }).where(eq(sequences.id, seq.id)).returning();
    return row;
  });

  app.put("/v1/workspaces/:ws/sequences/:id/steps", async (req) => {
    const p = params(req, idParams);
    const b = body(req, stepsSchema);
    const seq = await owned(wsId(req), p.id);
    const existing = await db.select({ id: sequenceSteps.id }).from(sequenceSteps).where(eq(sequenceSteps.sequenceId, seq.id));
    const existingIds = new Set(existing.map((e) => e.id));
    await db.transaction(async (tx) => {
      const keep = new Set<string>();
      for (const [position, s] of b.steps.entries()) {
        let stepId = s.id && existingIds.has(s.id) ? s.id : undefined;
        if (stepId) {
          await tx.update(sequenceSteps).set({ position, type: s.type, name: s.name, delayDays: s.delayDays }).where(eq(sequenceSteps.id, stepId));
        } else {
          stepId = (await tx.insert(sequenceSteps).values({ sequenceId: seq.id, position, type: s.type, name: s.name, delayDays: s.delayDays }).returning())[0]!.id;
        }
        keep.add(stepId);
        const current = await tx.select({ id: stepVariants.id }).from(stepVariants).where(eq(stepVariants.stepId, stepId));
        const currentIds = new Set(current.map((c) => c.id));
        const keepVariants = new Set<string>();
        for (const v of s.type === "email" ? s.variants : []) {
          if (v.id && currentIds.has(v.id)) {
            await tx.update(stepVariants).set({ label: v.label, subject: v.subject, bodyHtml: v.bodyHtml, weight: v.weight }).where(eq(stepVariants.id, v.id));
            keepVariants.add(v.id);
          } else {
            const [nv] = await tx.insert(stepVariants).values({ stepId, label: v.label, subject: v.subject, bodyHtml: v.bodyHtml, weight: v.weight }).returning();
            keepVariants.add(nv!.id);
          }
        }
        const dropVariants = [...currentIds].filter((id) => !keepVariants.has(id));
        if (dropVariants.length) await tx.delete(stepVariants).where(inArray(stepVariants.id, dropVariants));
      }
      const drop = [...existingIds].filter((id) => !keep.has(id));
      if (drop.length) await tx.delete(sequenceSteps).where(inArray(sequenceSteps.id, drop));
      // Contacts waiting on a step that no longer exists move to the end of the sequence.
      await tx.execute(sql`
        update sequence_contacts set next_step = null, state = 'finished', next_run_at = null
        where sequence_id = ${seq.id} and state in ('active', 'ooo') and next_step >= ${b.steps.length}
      `);
    });
    return loadSteps(seq.id);
  });

  app.put("/v1/workspaces/:ws/sequences/:id/senders", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({ senderProfileIds: z.array(z.string().uuid()) }));
    const seq = await owned(wsId(req), p.id);
    const valid = b.senderProfileIds.length
      ? await db.select({ id: senderProfiles.id }).from(senderProfiles)
        .where(and(eq(senderProfiles.workspaceId, wsId(req)), isNull(senderProfiles.ownerSequenceId), inArray(senderProfiles.id, b.senderProfileIds)))
      : [];
    // Only shared profiles are replaced; the sequence's own picked-mailbox profile stays attached.
    await db.delete(sequenceSenders).where(and(
      eq(sequenceSenders.sequenceId, seq.id),
      sql`${sequenceSenders.senderProfileId} in (select id from sender_profiles where owner_sequence_id is null)`,
    ));
    if (valid.length) await db.insert(sequenceSenders).values(valid.map((v) => ({ sequenceId: seq.id, senderProfileId: v.id }))).onConflictDoNothing();
    return { senderProfileIds: valid.map((v) => v.id) };
  });

  app.get("/v1/workspaces/:ws/sequences/:id/mailboxes", async (req) => {
    const p = params(req, idParams);
    await owned(wsId(req), p.id);
    const rows = await db.select({ id: senderProfileMailboxes.mailboxId }).from(senderProfileMailboxes)
      .innerJoin(senderProfiles, eq(senderProfiles.id, senderProfileMailboxes.senderProfileId))
      .where(eq(senderProfiles.ownerSequenceId, p.id));
    return { mailboxIds: rows.map((r) => r.id) };
  });

  // "Select mailboxes": mailboxes picked directly for this sequence live in a private sender profile owned by it.
  app.put("/v1/workspaces/:ws/sequences/:id/mailboxes", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({ mailboxIds: z.array(z.string().uuid()).max(1000) }));
    const workspaceId = wsId(req);
    const seq = await owned(workspaceId, p.id);
    const valid = b.mailboxIds.length
      ? (await db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.workspaceId, workspaceId), inArray(mailboxes.id, b.mailboxIds)))).map((m) => m.id)
      : [];
    await db.transaction(async (tx) => {
      let [profile] = await tx.select().from(senderProfiles).where(eq(senderProfiles.ownerSequenceId, seq.id));
      if (!profile) {
        if (!valid.length) return;
        [profile] = await tx.insert(senderProfiles).values({ workspaceId, name: "Selected mailboxes", ownerSequenceId: seq.id }).returning();
        await tx.insert(sequenceSenders).values({ sequenceId: seq.id, senderProfileId: profile!.id });
      }
      await tx.delete(senderProfileMailboxes).where(eq(senderProfileMailboxes.senderProfileId, profile!.id));
      if (valid.length) await tx.insert(senderProfileMailboxes).values(valid.map((m) => ({ senderProfileId: profile!.id, mailboxId: m })));
    });
    return { mailboxIds: valid };
  });

  app.post("/v1/workspaces/:ws/sequences/:id/launch", async (req) => {
    const p = params(req, idParams);
    try {
      await launchSequence(wsId(req), p.id);
    } catch (e) {
      if (e instanceof LaunchError) throw new HttpError(400, "cannot_launch", e.message);
      throw e;
    }
    return { ok: true };
  });

  app.post("/v1/workspaces/:ws/sequences/:id/pause", async (req) => {
    const p = params(req, idParams);
    await setSequenceStatus(wsId(req), p.id, "paused");
    return { ok: true };
  });

  app.post("/v1/workspaces/:ws/sequences/:id/resume", async (req) => {
    const p = params(req, idParams);
    await setSequenceStatus(wsId(req), p.id, "active");
    return { ok: true };
  });

  app.post("/v1/workspaces/:ws/sequences/:id/duplicate", async (req) => {
    const p = params(req, idParams);
    const seq = await owned(wsId(req), p.id);
    const steps = await loadSteps(seq.id);
    const [copy] = await db.insert(sequences).values({ workspaceId: seq.workspaceId, name: `${seq.name} (copy)`, priority: seq.priority, settings: seq.settings }).returning();
    for (const s of steps) {
      const [ns] = await db.insert(sequenceSteps).values({ sequenceId: copy!.id, position: s.position, type: s.type, name: s.name, delayDays: s.delayDays }).returning();
      if (s.variants.length) await db.insert(stepVariants).values(s.variants.map((v) => ({ stepId: ns!.id, label: v.label, subject: v.subject, bodyHtml: v.bodyHtml, weight: v.weight })));
    }
    const senders = await db.select({ id: senderProfiles.id, owner: senderProfiles.ownerSequenceId }).from(sequenceSenders)
      .innerJoin(senderProfiles, eq(senderProfiles.id, sequenceSenders.senderProfileId)).where(eq(sequenceSenders.sequenceId, seq.id));
    const shared = senders.filter((s) => !s.owner);
    if (shared.length) await db.insert(sequenceSenders).values(shared.map((s) => ({ sequenceId: copy!.id, senderProfileId: s.id })));
    // The copy gets its own picked-mailbox profile so editing one sequence never changes the other.
    const own = senders.find((s) => s.owner === seq.id);
    if (own) {
      const mbs = await db.select({ id: senderProfileMailboxes.mailboxId }).from(senderProfileMailboxes).where(eq(senderProfileMailboxes.senderProfileId, own.id));
      const [profile] = await db.insert(senderProfiles).values({ workspaceId: seq.workspaceId, name: "Selected mailboxes", ownerSequenceId: copy!.id }).returning();
      await db.insert(sequenceSenders).values({ sequenceId: copy!.id, senderProfileId: profile!.id });
      if (mbs.length) await db.insert(senderProfileMailboxes).values(mbs.map((m) => ({ senderProfileId: profile!.id, mailboxId: m.id })));
    }
    return copy;
  });

  app.delete("/v1/workspaces/:ws/sequences/:id", async (req) => {
    const p = params(req, idParams);
    await owned(wsId(req), p.id);
    await db.delete(senderProfiles).where(eq(senderProfiles.ownerSequenceId, p.id));
    await db.delete(sequences).where(eq(sequences.id, p.id));
    return { ok: true };
  });

  app.get("/v1/workspaces/:ws/sequences/:id/contacts", async (req) => {
    const p = params(req, idParams);
    const q = query(req, z.object({ state: z.string().optional(), q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }));
    await owned(wsId(req), p.id);
    const where = and(
      eq(sequenceContacts.sequenceId, p.id),
      q.state ? eq(sequenceContacts.state, q.state as "active") : undefined,
      q.q ? ilike(contacts.email, `%${q.q}%`) : undefined,
    );
    const [rows, [count]] = await Promise.all([
      db.select({
        id: sequenceContacts.id, state: sequenceContacts.state, currentStep: sequenceContacts.currentStep, nextStep: sequenceContacts.nextStep,
        nextRunAt: sequenceContacts.nextRunAt, lastError: sequenceContacts.lastError, mailboxId: sequenceContacts.assignedMailboxId,
        contact: { id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName, companyName: contacts.companyName },
      }).from(sequenceContacts).innerJoin(contacts, eq(contacts.id, sequenceContacts.contactId)).where(where)
        .orderBy(desc(sequenceContacts.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(sequenceContacts).innerJoin(contacts, eq(contacts.id, sequenceContacts.contactId)).where(where),
    ]);
    return { items: rows, total: count?.n ?? 0 };
  });

  app.post("/v1/workspaces/:ws/sequences/:id/contacts", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({ contactIds: z.array(z.string().uuid()).optional(), tagId: z.string().uuid().optional(), all: z.boolean().optional() }));
    const workspaceId = wsId(req);
    await owned(workspaceId, p.id);
    let ids = b.contactIds ?? [];
    if (b.all) {
      ids = (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.workspaceId, workspaceId))).map((r) => r.id);
    } else if (b.tagId) {
      const rows = await db.execute<{ id: string }>(sql`
        select c.id from contacts c join contact_tags ct on ct.contact_id = c.id where ct.tag_id = ${b.tagId} and c.workspace_id = ${workspaceId}
      `) as unknown as { id: string }[];
      ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
    }
    if (ids.length) {
      const owned2 = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, ids)));
      ids = owned2.map((r) => r.id);
    }
    const added = await addContactsToSequence(workspaceId, p.id, ids);
    return { added, alreadyIn: ids.length - added };
  });

  app.post("/v1/workspaces/:ws/sequences/:id/contacts/remove", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({ ids: z.array(z.string().uuid()).min(1) }));
    await owned(wsId(req), p.id);
    await db.update(sequenceContacts).set({ state: "finished", nextRunAt: null, lastError: "removed" })
      .where(and(eq(sequenceContacts.sequenceId, p.id), inArray(sequenceContacts.id, b.ids), inArray(sequenceContacts.state, [...OPEN])));
    return { ok: true };
  });

  // Renders a step for one contact (or sample data) and scores it, for the editor's Preview tab.
  app.post("/v1/workspaces/:ws/preview", async (req) => {
    const b = body(req, z.object({ subject: z.string().default(""), bodyHtml: z.string().default(""), contactId: z.string().uuid().optional() }));
    const workspaceId = wsId(req);
    const contact = b.contactId
      ? await db.query.contacts.findFirst({ where: and(eq(contacts.id, b.contactId), eq(contacts.workspaceId, workspaceId)) })
      : await db.query.contacts.findFirst({ where: eq(contacts.workspaceId, workspaceId), orderBy: desc(contacts.createdAt) });
    const mailbox = await db.query.mailboxes.findFirst({ where: eq(mailboxes.workspaceId, workspaceId) });
    const sender = { fromName: mailbox?.fromName ?? "Alex Sender", email: mailbox?.email ?? "alex@example.com" };
    const vars = contact
      ? contactVariables(contact, sender)
      : { first_name: "Jordan", last_name: "Lee", company: "Acme Inc", company_name: "Acme Inc", title: "Head of Sales", sender_name: sender.fromName, sender_first_name: sender.fromName.split(" ")[0] };
    const seed = `${contact?.id ?? "sample"}:${Date.now()}`;
    const subject = render(b.subject, vars, { seed: `${seed}:s` });
    const html = render(b.bodyHtml, vars, { seed, html: true });
    return { subject, html, contact: contact ? { id: contact.id, email: contact.email } : null, spam: spamCheck(subject, html) };
  });

  app.post("/v1/workspaces/:ws/spam-check", async (req) => {
    const b = body(req, z.object({ subject: z.string().default(""), bodyHtml: z.string().default("") }));
    return spamCheck(b.subject, b.bodyHtml);
  });

  app.post("/v1/workspaces/:ws/send-test", async (req) => {
    const b = body(req, z.object({ mailboxId: z.string().uuid(), to: z.string().email(), subject: z.string(), bodyHtml: z.string() }));
    const workspaceId = wsId(req);
    const mailbox = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, b.mailboxId), eq(mailboxes.workspaceId, workspaceId)) });
    if (!mailbox) notFound("Mailbox");
    const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, b.to.toLowerCase())) });
    const vars = contact ? contactVariables(contact, mailbox) : { first_name: "there", sender_name: mailbox.fromName };
    const seed = `test:${Date.now()}`;
    const email = composeEmail({
      from: { name: mailbox.fromName, address: mailbox.email },
      to: b.to,
      subject: `[Test] ${render(b.subject, vars, { seed: `${seed}:s` })}`,
      bodyHtml: render(b.bodyHtml, vars, { seed, html: true }),
      signatureHtml: renderSignature(mailbox, seed),
      plainText: false,
    });
    const c = await connectionFor(mailbox);
    await sendSmtp(c.server, c.auth, email);
    return { ok: true };
  });
}
