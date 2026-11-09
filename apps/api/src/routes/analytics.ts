import { db } from "@outreach/db";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wsId } from "../auth";
import { query } from "../http";

const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sequenceId: z.string().uuid().optional(),
});

export async function analyticsRoutes(app: FastifyInstance) {
  app.get("/v1/workspaces/:ws/analytics", async (req) => {
    const q = query(req, rangeQuery);
    const workspaceId = wsId(req);
    const toDate = q.to ?? new Date();
    const to = toDate.toISOString();
    const from = (q.from ?? new Date(toDate.getTime() - 30 * 86400000)).toISOString();
    const seq = q.sequenceId ? sql`and sequence_id = ${q.sequenceId}` : sql``;
    const seqT = q.sequenceId ? sql`and t.sequence_id = ${q.sequenceId}` : sql``;
    const seqSc = q.sequenceId ? sql`and sc.sequence_id = ${q.sequenceId}` : sql``;

    const [totals] = await db.execute<Record<string, number>>(sql`
      select
        count(*) filter (where type = 'sent')::int as sent,
        count(distinct contact_id) filter (where type = 'sent')::int as contacted,
        count(distinct message_id) filter (where type = 'opened')::int as opened,
        count(distinct message_id) filter (where type = 'clicked')::int as clicked,
        count(distinct contact_id) filter (where type = 'replied' and coalesce(meta->>'kind', 'reply') = 'reply')::int as replied,
        count(distinct contact_id) filter (where type = 'bounced')::int as bounced,
        count(distinct contact_id) filter (where type = 'opted_out')::int as opted_out
      from events
      where workspace_id = ${workspaceId} and occurred_at between ${from} and ${to} ${seq}
    `) as unknown as Record<string, number>[];

    const [funnel] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from sequence_contacts sc where sc.workspace_id = ${workspaceId} and sc.created_at <= ${to} ${seqSc}) as added,
        (select count(*)::int from threads t join labels l on l.id = t.label_id
           where t.workspace_id = ${workspaceId} and l.counts_as = 'positive' and t.last_message_at between ${from} and ${to} ${seqT}) as positive,
        (select count(*)::int from threads t join labels l on l.id = t.label_id
           where t.workspace_id = ${workspaceId} and l.counts_as = 'meeting' and t.last_message_at between ${from} and ${to} ${seqT}) as meetings,
        (select count(*)::int from threads t join labels l on l.id = t.label_id
           where t.workspace_id = ${workspaceId} and l.counts_as = 'closed' and t.last_message_at between ${from} and ${to} ${seqT}) as closed
    `) as unknown as Record<string, number>[];

    const daily = await db.execute<{ day: string; sent: number; replied: number; opened: number; bounced: number }>(sql`
      select to_char(d, 'YYYY-MM-DD') as day,
        coalesce(sum((e.type = 'sent')::int), 0)::int as sent,
        coalesce(sum((e.type = 'replied' and coalesce(e.meta->>'kind', 'reply') = 'reply')::int), 0)::int as replied,
        coalesce(sum((e.type = 'opened')::int), 0)::int as opened,
        coalesce(sum((e.type = 'bounced')::int), 0)::int as bounced
      from generate_series(date_trunc('day', ${from}::timestamptz), date_trunc('day', ${to}::timestamptz), interval '1 day') d
      left join events e on e.workspace_id = ${workspaceId} and date_trunc('day', e.occurred_at) = d ${q.sequenceId ? sql`and e.sequence_id = ${q.sequenceId}` : sql``}
      group by d order by d
    `) as unknown as { day: string; sent: number; replied: number; opened: number; bounced: number }[];

    const senders = await db.execute<Record<string, unknown>>(sql`
      select m.id, m.email, m.from_name,
        count(*) filter (where e.type = 'sent')::int as sent,
        count(distinct e.contact_id) filter (where e.type = 'sent')::int as contacted,
        count(distinct e.message_id) filter (where e.type = 'opened')::int as opened,
        count(distinct e.contact_id) filter (where e.type = 'replied' and coalesce(e.meta->>'kind', 'reply') = 'reply')::int as replied,
        count(distinct e.contact_id) filter (where e.type = 'bounced')::int as bounced,
        count(distinct e.contact_id) filter (where e.type = 'opted_out')::int as opted_out
      from mailboxes m
      left join events e on e.mailbox_id = m.id and e.occurred_at between ${from} and ${to} ${q.sequenceId ? sql`and e.sequence_id = ${q.sequenceId}` : sql``}
      where m.workspace_id = ${workspaceId}
      group by m.id order by sent desc, m.email
    `) as unknown as Record<string, unknown>[];

    const variants = q.sequenceId ? await db.execute<Record<string, unknown>>(sql`
      select st.position, st.name as step_name, v.id, v.label, v.subject,
        count(*) filter (where e.type = 'sent')::int as sent,
        count(distinct e.message_id) filter (where e.type = 'opened')::int as opened
      from sequence_steps st join step_variants v on v.step_id = st.id
      left join events e on e.variant_id = v.id and e.occurred_at between ${from} and ${to}
      where st.sequence_id = ${q.sequenceId}
      group by st.position, st.name, v.id, v.label, v.subject order by st.position, v.label
    `) as unknown as Record<string, unknown>[] : [];

    return { range: { from, to }, totals, funnel, daily, senders, variants };
  });

  app.get("/v1/workspaces/:ws/reports/messages.csv", async (req, reply) => {
    const q = query(req, rangeQuery);
    const workspaceId = wsId(req);
    const rows = await db.execute<Record<string, string>>(sql`
      select m.sent_at, m.direction, m.from_address, m.to_address, m.subject, s.name as sequence
      from messages m left join sequences s on s.id = m.sequence_id
      where m.workspace_id = ${workspaceId} ${q.sequenceId ? sql`and m.sequence_id = ${q.sequenceId}` : sql``}
        ${q.from ? sql`and m.sent_at >= ${q.from.toISOString()}` : sql``} ${q.to ? sql`and m.sent_at <= ${q.to.toISOString()}` : sql``}
      order by m.sent_at desc limit 100000
    `) as unknown as Record<string, unknown>[];
    const esc = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString() : String(v ?? "");
      // Neutralise spreadsheet formulas in text that came from outside (e.g. reply subjects).
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    reply.header("content-type", "text/csv").header("content-disposition", 'attachment; filename="messages.csv"');
    return ["sent_at,direction,from,to,subject,sequence", ...rows.map((r) => [r.sent_at, r.direction, r.from_address, r.to_address, r.subject, r.sequence].map(esc).join(","))].join("\n");
  });
}
