import { MANUAL_SEND_MAX, sendManualEmails } from "@outreach/core";
import { db } from "@outreach/db";
import { render } from "@outreach/mail";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wsId } from "../auth";
import { body, HttpError, idParams, notFound, params, query } from "../http";

interface EmailRow {
  id: string;
  kind: "scheduled" | "sent";
  status: "scheduled" | "paused" | "sent";
  at: string | null;
  // Time zone of the sequence schedule, so the web can show the send time in it.
  timezone: string | null;
  contactId: string | null;
  email: string;
  name: string;
  sequenceId: string | null;
  sequenceName: string | null;
  step: number | null;
  steps: number | null;
  subject: string;
  snippet: string;
  canSendNow: boolean;
}

type DueRow = {
  id: string; state: string; next_run_at: Date; seq_status: string; contact_id: string; email: string; first_name: string; last_name: string;
  company_name: string; title: string; seq_id: string; seq_name: string; step_no: number; step_total: number; subject: string | null; body_html: string | null; tz: string | null;
};

type SentRow = {
  id: string; sent_at: Date; contact_id: string | null; to_address: string; first_name: string | null; last_name: string | null; seq_id: string | null; seq_name: string | null;
  step_no: number | null; step_total: number | null; subject: string; body_text: string;
};

const listQuery = z.object({
  status: z.enum(["all", "scheduled", "sent"]).default("all"),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const CAP = 500;

export async function emailRoutes(app: FastifyInstance) {
  // Every email in the workspace: the ones waiting to go out (scheduled by sequences) and the ones already sent.
  app.get("/v1/workspaces/:ws/emails", async (req) => {
    const q = query(req, listQuery);
    const workspaceId = wsId(req);
    const like = q.q ? `%${q.q}%` : null;
    const rows: EmailRow[] = [];

    if (q.status !== "sent") {
      const due = await db.execute<DueRow>(sql`
        select sc.id, sc.state, sc.next_run_at, s.status as seq_status, c.id as contact_id, c.email, c.first_name, c.last_name, c.company_name, c.title,
               s.id as seq_id, s.name as seq_name,
               (select count(*)::int from sequence_steps x where x.sequence_id = sc.sequence_id and x.type = 'email' and x.position <= sc.next_step) as step_no,
               (select count(*)::int from sequence_steps x where x.sequence_id = sc.sequence_id and x.type = 'email') as step_total,
               v.subject, v.body_html, s.settings->'schedule'->>'timezone' as tz
        from sequence_contacts sc
        join contacts c on c.id = sc.contact_id
        join sequences s on s.id = sc.sequence_id
        left join sequence_steps st on st.sequence_id = sc.sequence_id and st.position = sc.next_step
        left join lateral (select subject, body_html from step_variants v where v.step_id = st.id order by label limit 1) v on true
        where sc.workspace_id = ${workspaceId} and sc.state in ('queued', 'active', 'ooo') and sc.next_run_at is not null and sc.next_step is not null
          ${like ? sql`and (c.email ilike ${like} or (c.first_name || ' ' || c.last_name) ilike ${like} or s.name ilike ${like})` : sql``}
        order by sc.next_run_at asc
        limit ${CAP}
      `) as unknown as DueRow[];
      for (const r of due) {
        const vars = { first_name: r.first_name, last_name: r.last_name, company: r.company_name, company_name: r.company_name, title: r.title, email: r.email };
        const subject = r.subject ? render(r.subject, vars, { seed: r.id }) : "";
        const plain = (r.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        const paused = r.seq_status !== "active" || r.state === "ooo";
        rows.push({
          id: r.id, kind: "scheduled", status: paused ? "paused" : "scheduled", at: new Date(r.next_run_at).toISOString(), timezone: r.tz, contactId: r.contact_id,
          email: r.email, name: `${r.first_name} ${r.last_name}`.trim(), sequenceId: r.seq_id, sequenceName: r.seq_name, step: r.step_no, steps: r.step_total,
          subject: subject || "Replies in the same thread", snippet: render(plain, vars, { seed: r.id }).slice(0, 160), canSendNow: !paused,
        });
      }
    }

    if (q.status !== "scheduled") {
      const sent = await db.execute<SentRow>(sql`
        select m.id, m.sent_at, m.contact_id, m.to_address, c.first_name, c.last_name, s.id as seq_id, s.name as seq_name,
               case when st.id is null then null else (select count(*)::int from sequence_steps x where x.sequence_id = st.sequence_id and x.type = 'email' and x.position <= st.position) end as step_no,
               case when st.id is null then null else (select count(*)::int from sequence_steps x where x.sequence_id = st.sequence_id and x.type = 'email') end as step_total,
               m.subject, left(m.body_text, 160) as body_text
        from messages m
        left join contacts c on c.id = m.contact_id
        left join sequences s on s.id = m.sequence_id
        left join sequence_steps st on st.id = m.step_id
        where m.workspace_id = ${workspaceId} and m.direction = 'out'
          ${like ? sql`and (m.to_address ilike ${like} or m.subject ilike ${like} or s.name ilike ${like} or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike ${like})` : sql``}
        order by m.sent_at desc
        limit ${CAP}
      `) as unknown as SentRow[];
      for (const r of sent) {
        rows.push({
          id: r.id, kind: "sent", status: "sent", at: new Date(r.sent_at).toISOString(), timezone: null, contactId: r.contact_id, email: r.to_address,
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), sequenceId: r.seq_id, sequenceName: r.seq_name, step: r.step_no, steps: r.step_total,
          subject: r.subject, snippet: r.body_text.replace(/\s+/g, " ").trim(), canSendNow: false,
        });
      }
    }

    // Upcoming first (soonest at the top), then what was sent, newest first.
    const upcoming = rows.filter((r) => r.kind === "scheduled").sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    const done = rows.filter((r) => r.kind === "sent").sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    const all = [...upcoming, ...done];
    const start = (q.page - 1) * q.pageSize;
    return { items: all.slice(start, start + q.pageSize), total: all.length, scheduled: upcoming.length };
  });

  // Manual send: moves a scheduled email to the front of the queue. It still goes out through the normal sender, so
  // the sending window, mailbox daily limits and gaps between emails are respected.
  app.post("/v1/workspaces/:ws/emails/:id/send-now", async (req) => {
    const p = params(req, idParams);
    const workspaceId = wsId(req);
    const [row] = await db.execute<{ id: string; seq_status: string }>(sql`
      select sc.id, s.status as seq_status from sequence_contacts sc join sequences s on s.id = sc.sequence_id
      where sc.id = ${p.id} and sc.workspace_id = ${workspaceId} and sc.state in ('queued', 'active') and sc.next_step is not null
    `) as unknown as { id: string; seq_status: string }[];
    if (!row) notFound("Scheduled email");
    if (row.seq_status !== "active") throw new HttpError(409, "sequence_not_active", "Resume the sequence first, then send this email.");
    await db.execute(sql`update sequence_contacts set next_run_at = now(), due_at = now() where id = ${row.id}`);
    return { ok: true };
  });

  // Compose and send by hand, no sequence needed. Recipients are contacts picked in the Compose screen.
  app.post("/v1/workspaces/:ws/emails/send", async (req) => {
    const b = body(req, z.object({
      mailboxId: z.string().uuid(),
      contactIds: z.array(z.string().uuid()).min(1, "Pick at least one recipient").max(MANUAL_SEND_MAX, `Send to ${MANUAL_SEND_MAX} contacts or fewer at a time`),
      subject: z.string().trim().min(1, "Add a subject").max(500),
      bodyHtml: z.string().min(1, "Write your email").max(8_000_000),
      attachments: z.array(z.object({
        name: z.string().min(1).max(200), type: z.string().max(150).default("application/octet-stream"),
        size: z.number().int().min(0).max(10 * 1024 * 1024), data: z.string().max(Math.ceil(10 * 1024 * 1024 * 1.4)),
      })).max(5).default([]),
    }));
    if (!b.bodyHtml.replace(/<[^>]+>/g, "").trim() && !/<img\s/i.test(b.bodyHtml)) throw new HttpError(400, "empty_body", "Write your email");
    try {
      const results = await sendManualEmails({ workspaceId: wsId(req), ...b }, { trackingBaseUrl: process.env.TRACKING_BASE_URL ?? "http://localhost:4000" });
      return { results, sent: results.filter((r) => r.status === "sent").length };
    } catch (e) {
      throw new HttpError(400, "send_failed", (e as Error).message);
    }
  });
}
