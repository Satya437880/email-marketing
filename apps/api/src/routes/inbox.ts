import { addDnc, emitEvent, maybeCompleteSequence, sendReply } from "@outreach/core";
import { contacts, db, events, labels, mailboxes, messages, sequenceContacts, sequences, templates, threads } from "@outreach/db";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wsId } from "../auth";
import { body, HttpError, idParams, notFound, params, query } from "../http";

const listQuery = z.object({
  label: z.string().optional(),
  view: z.enum(["all", "unread", "reminders"]).default("all"),
  q: z.string().trim().optional(),
  sequenceIds: z.string().optional(),
  mailboxIds: z.string().optional(),
  excludeSequenceIds: z.string().optional(),
  excludeMailboxIds: z.string().optional(),
  reminder: z.enum(["with", "without"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const csvIds = (s?: string) => (s ? s.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : []);

export async function inboxRoutes(app: FastifyInstance) {
  app.get("/v1/workspaces/:ws/threads", async (req) => {
    const q = query(req, listQuery);
    const workspaceId = wsId(req);
    const parts: (SQL | undefined)[] = [eq(threads.workspaceId, workspaceId), eq(threads.hasInbound, true)];
    if (q.label === "none") parts.push(isNull(threads.labelId));
    else if (q.label) parts.push(eq(threads.labelId, q.label));
    if (q.view === "unread") parts.push(eq(threads.unread, true));
    if (q.view === "reminders") parts.push(isNotNull(threads.reminderAt));
    const seqIds = csvIds(q.sequenceIds);
    const mbIds = csvIds(q.mailboxIds);
    if (seqIds.length) parts.push(inArray(threads.sequenceId, seqIds));
    if (mbIds.length) parts.push(inArray(threads.mailboxId, mbIds));
    const exSeq = csvIds(q.excludeSequenceIds);
    const exMb = csvIds(q.excludeMailboxIds);
    // Threads outside any sequence stay visible when sequences are excluded.
    if (exSeq.length) parts.push(or(isNull(threads.sequenceId), notInArray(threads.sequenceId, exSeq)));
    if (exMb.length) parts.push(notInArray(threads.mailboxId, exMb));
    if (q.reminder === "with") parts.push(isNotNull(threads.reminderAt));
    if (q.reminder === "without") parts.push(isNull(threads.reminderAt));
    if (q.q) {
      const like = `%${q.q}%`;
      parts.push(or(ilike(threads.subject, like), ilike(contacts.email, like), ilike(contacts.firstName, like), ilike(contacts.lastName, like), ilike(contacts.companyName, like)));
    }
    const where = and(...parts);
    const rows = await db.select({
      id: threads.id, subject: threads.subject, unread: threads.unread, lastMessageAt: threads.lastMessageAt, reminderAt: threads.reminderAt,
      labelId: threads.labelId, sequenceId: threads.sequenceId, mailboxId: threads.mailboxId,
      contact: { id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName, companyName: contacts.companyName },
      snippet: sql<string>`(select left(regexp_replace(m.body_text, '\s+', ' ', 'g'), 160) from messages m where m.thread_id = ${threads.id} and m.direction = 'in' order by m.sent_at desc limit 1)`,
    }).from(threads).leftJoin(contacts, eq(contacts.id, threads.contactId)).where(where)
      .orderBy(q.view === "reminders" ? asc(threads.reminderAt) : desc(threads.lastMessageAt))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(threads).leftJoin(contacts, eq(contacts.id, threads.contactId)).where(where);
    return { items: rows, total: count?.n ?? 0 };
  });

  app.get("/v1/workspaces/:ws/threads/counts", async (req) => {
    const workspaceId = wsId(req);
    const [row] = await db.execute<{ all: number; unread: number; none: number; reminders: number; due: number }>(sql`
      select count(*)::int as all,
             count(*) filter (where unread)::int as unread,
             count(*) filter (where label_id is null)::int as none,
             count(*) filter (where reminder_at is not null)::int as reminders,
             count(*) filter (where reminder_at <= now())::int as due
      from threads where workspace_id = ${workspaceId} and has_inbound
    `) as unknown as { all: number; unread: number; none: number; reminders: number; due: number }[];
    return row;
  });

  app.get("/v1/workspaces/:ws/threads/:id", async (req) => {
    const p = params(req, idParams);
    const workspaceId = wsId(req);
    const thread = await db.query.threads.findFirst({ where: and(eq(threads.id, p.id), eq(threads.workspaceId, workspaceId)) });
    if (!thread) notFound("Thread");
    const [msgs, contact, mailbox, sequence] = await Promise.all([
      db.select({
        id: messages.id, direction: messages.direction, fromAddress: messages.fromAddress, fromName: messages.fromName, toAddress: messages.toAddress,
        subject: messages.subject, bodyHtml: messages.bodyHtml, bodyText: messages.bodyText, sentAt: messages.sentAt,
      }).from(messages).where(eq(messages.threadId, thread.id)).orderBy(asc(messages.sentAt)),
      thread.contactId ? db.query.contacts.findFirst({ where: eq(contacts.id, thread.contactId) }) : undefined,
      db.query.mailboxes.findFirst({ where: eq(mailboxes.id, thread.mailboxId), columns: { id: true, email: true, fromName: true } }),
      thread.sequenceId ? db.query.sequences.findFirst({ where: eq(sequences.id, thread.sequenceId), columns: { id: true, name: true } }) : undefined,
    ]);
    if (thread.unread) await db.update(threads).set({ unread: false }).where(eq(threads.id, thread.id));
    return { ...thread, unread: false, messages: msgs, contact: contact ?? null, mailbox, sequence: sequence ?? null };
  });

  app.patch("/v1/workspaces/:ws/threads/:id", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({
      labelId: z.string().uuid().nullable().optional(),
      unread: z.boolean().optional(),
      reminderAt: z.coerce.date().nullable().optional(),
    }));
    const workspaceId = wsId(req);
    if (b.labelId) {
      const label = await db.query.labels.findFirst({ where: and(eq(labels.id, b.labelId), eq(labels.workspaceId, workspaceId)) });
      if (!label) notFound("Label");
    }
    const [row] = await db.update(threads).set(b).where(and(eq(threads.id, p.id), eq(threads.workspaceId, workspaceId))).returning();
    if (!row) notFound("Thread");
    if (b.labelId !== undefined) {
      await db.insert(events).values({ workspaceId, type: "labeled", contactId: row.contactId, sequenceId: row.sequenceId, mailboxId: row.mailboxId, meta: { labelId: b.labelId } });
      const [label, contact] = await Promise.all([
        b.labelId ? db.query.labels.findFirst({ where: eq(labels.id, b.labelId), columns: { name: true } }) : undefined,
        row.contactId ? db.query.contacts.findFirst({ where: eq(contacts.id, row.contactId), columns: { email: true } }) : undefined,
      ]);
      emitEvent(workspaceId, "label.changed", { threadId: row.id, contactId: row.contactId, contactEmail: contact?.email ?? null, label: label?.name ?? null, sequenceId: row.sequenceId });
    }
    return row;
  });

  app.post("/v1/workspaces/:ws/threads/:id/reply", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({
      bodyHtml: z.string().min(1).max(100000),
      includeHistory: z.boolean().default(true),
      cc: z.array(z.string().email()).max(10).optional(),
      bcc: z.array(z.string().email()).max(10).optional(),
      mailboxId: z.string().uuid().optional(),
    }));
    try {
      return await sendReply({ workspaceId: wsId(req), threadId: p.id, bodyHtml: b.bodyHtml, includeHistory: b.includeHistory, cc: b.cc, bcc: b.bcc, via: b.mailboxId });
    } catch (e) {
      throw new HttpError(400, "send_failed", (e as Error).message);
    }
  });

  app.post("/v1/workspaces/:ws/threads/:id/dnc", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({ scope: z.enum(["email", "domain"]).default("email") }));
    const workspaceId = wsId(req);
    const thread = await db.query.threads.findFirst({ where: and(eq(threads.id, p.id), eq(threads.workspaceId, workspaceId)) });
    if (!thread?.contactId) notFound("Thread");
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, thread.contactId) });
    if (!contact) notFound("Contact");
    await addDnc(workspaceId, b.scope, b.scope === "email" ? contact.email : contact.email.split("@")[1]!, "primebox");
    const stopped = await db.update(sequenceContacts).set({ state: "opted_out", nextRunAt: null })
      .where(and(eq(sequenceContacts.contactId, contact.id), inArray(sequenceContacts.state, ["queued", "active", "sending", "ooo"])))
      .returning({ sequenceId: sequenceContacts.sequenceId });
    for (const s of new Set(stopped.map((x) => x.sequenceId))) await maybeCompleteSequence(s);
    return { ok: true };
  });

  app.delete("/v1/workspaces/:ws/threads/:id", async (req) => {
    const p = params(req, idParams);
    await db.delete(threads).where(and(eq(threads.id, p.id), eq(threads.workspaceId, wsId(req))));
    return { ok: true };
  });

  app.get("/v1/workspaces/:ws/reminders/due", async (req) => {
    return db.select({ id: threads.id, subject: threads.subject, reminderAt: threads.reminderAt }).from(threads)
      .where(and(eq(threads.workspaceId, wsId(req)), lte(threads.reminderAt, new Date()))).orderBy(asc(threads.reminderAt)).limit(20);
  });

  // Reply templates
  app.get("/v1/workspaces/:ws/templates", async (req) => {
    return db.select().from(templates).where(eq(templates.workspaceId, wsId(req))).orderBy(asc(templates.name));
  });

  app.post("/v1/workspaces/:ws/templates", async (req) => {
    const b = body(req, z.object({ name: z.string().trim().min(1).max(100), subject: z.string().max(500).default(""), bodyHtml: z.string().max(100000), kind: z.enum(["sequence", "reply"]).default("reply") }));
    const [row] = await db.insert(templates).values({ workspaceId: wsId(req), ...b }).returning();
    return row;
  });

  app.delete("/v1/workspaces/:ws/templates/:id", async (req) => {
    const p = params(req, idParams);
    await db.delete(templates).where(and(eq(templates.id, p.id), eq(templates.workspaceId, wsId(req))));
    return { ok: true };
  });
}
