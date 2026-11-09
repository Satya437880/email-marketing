import { db, type SequenceSettings } from "@outreach/db";
import { evaluate, localDayKey, orderDue, randomGapMs, type MailboxCandidate, type Provider } from "@outreach/engine";
import { sql } from "drizzle-orm";
import { dncMatches } from "./workspace";

export interface SendJob {
  sequenceContactId: string;
  mailboxId: string;
  stepIndex: number;
}

type DueRow = {
  id: string;
  sequence_id: string;
  workspace_id: string;
  contact_id: string;
  current_step: number;
  next_step: number | null;
  next_run_at: Date;
  assigned_mailbox_id: string | null;
  sc_created_at: Date;
  priority: "high" | "regular";
  settings: SequenceSettings;
  email: string;
  esp: string;
  company_id: string | null;
  unsubscribed_at: Date | null;
  company_replied_at: Date | null;
};

type MailboxRow = {
  sequence_id: string;
  id: string;
  provider: Provider;
  status: string;
  daily_limit: number;
  min_gap_seconds: number;
  max_gap_seconds: number;
  timezone: string;
  next_available_at: Date | null;
};

interface MailboxState extends MailboxCandidate {
  timezone: string;
  minGap: number;
  maxGap: number;
}

const PLANNER_LOCK = 774201;
const BATCH = 1000;

// One planner tick: decide for every due sequence contact whether to send now, wait or stop.
// Sends are reserved against the mailbox's daily cap inside the same transaction, so caps hold even if jobs fail later.
export async function planTick(now = new Date()): Promise<{ jobs: SendJob[]; stats: Record<string, number> }> {
  const stats: Record<string, number> = { considered: 0, send: 0, reschedule: 0, stop: 0 };
  const jobs: SendJob[] = [];

  await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${PLANNER_LOCK}) as ok`);
    if (!lock?.ok) return;

    const due = (await tx.execute<DueRow>(sql`
      select sc.id, sc.sequence_id, s.workspace_id, sc.contact_id, sc.current_step, sc.next_step, sc.next_run_at,
             sc.assigned_mailbox_id, sc.created_at as sc_created_at, s.priority, s.settings,
             c.email, c.esp, c.company_id, c.unsubscribed_at, co.replied_at as company_replied_at
      from sequence_contacts sc
      join sequences s on s.id = sc.sequence_id and s.status = 'active'
      join contacts c on c.id = sc.contact_id
      left join companies co on co.id = c.company_id
      where sc.state in ('active', 'ooo') and sc.next_run_at <= ${now.toISOString()} and sc.next_step is not null
      order by sc.next_run_at
      limit ${BATCH}
      for update of sc skip locked
    `)) as unknown as DueRow[];
    stats.considered = due.length;
    if (!due.length) return;

    const seqIds = [...new Set(due.map((d) => d.sequence_id))];
    const mbRows = (await tx.execute<MailboxRow>(sql`
      select distinct ss.sequence_id, m.id, m.provider, m.status, m.daily_limit, m.min_gap_seconds, m.max_gap_seconds,
             m.timezone, m.next_available_at
      from sequence_senders ss
      join sender_profile_mailboxes spm on spm.sender_profile_id = ss.sender_profile_id
      join mailboxes m on m.id = spm.mailbox_id
      where ss.sequence_id in ${seqIds}
    `)) as unknown as MailboxRow[];

    const mailboxState = new Map<string, MailboxState>();
    const bySequence = new Map<string, string[]>();
    for (const r of mbRows) {
      if (!mailboxState.has(r.id)) {
        mailboxState.set(r.id, {
          id: r.id,
          provider: r.provider,
          active: r.status === "active",
          dailyLimit: r.daily_limit,
          sentToday: 0,
          nextAvailableAt: r.next_available_at ? new Date(r.next_available_at) : null,
          timezone: r.timezone,
          minGap: r.min_gap_seconds,
          maxGap: r.max_gap_seconds,
        });
      }
      bySequence.set(r.sequence_id, [...(bySequence.get(r.sequence_id) ?? []), r.id]);
    }
    if (mailboxState.size) {
      const ids = [...mailboxState.keys()];
      const counts = (await tx.execute<{ mailbox_id: string; day: string; sent: number }>(sql`
        select mailbox_id, day::text as day, sent from mailbox_daily_stats
        where mailbox_id in ${ids} and day >= (current_date - 1) and day <= (current_date + 1)
      `)) as unknown as { mailbox_id: string; day: string; sent: number }[];
      for (const c of counts) {
        const m = mailboxState.get(c.mailbox_id);
        if (m && c.day === localDayKey(now, m.timezone)) m.sentToday = c.sent;
      }
    }

    const workspaces = [...new Set(due.map((d) => d.workspace_id))];
    const blocked = new Set<string>();
    for (const w of workspaces) {
      for (const e of await dncMatches(w, due.filter((d) => d.workspace_id === w).map((d) => d.email))) blocked.add(`${w}:${e}`);
    }

    const companyIds = [...new Set(due.map((d) => d.company_id).filter((c): c is string => !!c))];
    const companyCounts = new Map<string, { contacted: number; inflight: number }>();
    if (companyIds.length) {
      const rows = (await tx.execute<{ sequence_id: string; company_id: string; contacted: number; inflight: number }>(sql`
        select sc.sequence_id, c.company_id,
               count(*) filter (where sc.current_step >= 0)::int as contacted,
               count(*) filter (where sc.current_step >= 0 and sc.state in ('active', 'sending', 'ooo') and sc.next_step is not null)::int as inflight
        from sequence_contacts sc join contacts c on c.id = sc.contact_id
        where c.company_id in ${companyIds}
          and sc.sequence_id in ${seqIds}
        group by 1, 2
      `)) as unknown as { sequence_id: string; company_id: string; contacted: number; inflight: number }[];
      for (const r of rows) companyCounts.set(`${r.sequence_id}:${r.company_id}`, { contacted: r.contacted, inflight: r.inflight });
    }

    const ordered = orderDue(due.map((d) => ({
      ...d,
      sequencePriority: d.priority,
      inSequencePriority: d.settings.inSequencePriority,
      currentStep: d.current_step,
      nextRunAt: new Date(d.next_run_at),
    })));

    for (const d of ordered) {
      const s = d.settings;
      const companyKey = d.company_id ? `${d.sequence_id}:${d.company_id}` : null;
      const cc = (companyKey && companyCounts.get(companyKey)) || { contacted: 0, inflight: 0 };
      const isFirstTouch = d.current_step < 0;
      const decision = evaluate({
        now,
        schedule: s.schedule,
        inDnc: blocked.has(`${d.workspace_id}:${d.email.toLowerCase()}`),
        unsubscribed: !!d.unsubscribed_at,
        company: {
          stopOnCompanyReply: s.stopOnCompanyReply && !!d.company_id,
          companyHasReplied: !!d.company_replied_at && new Date(d.company_replied_at) > new Date(d.sc_created_at),
          sequentialWithinCompany: s.sequentialWithinCompany && !!d.company_id,
          otherContactInFlight: cc.inflight > 0,
          companyLimit: d.company_id ? s.companyLimit : null,
          companyContactedCount: cc.contacted,
          isFirstTouch,
        },
        mailbox: {
          candidates: (bySequence.get(d.sequence_id) ?? []).map((id) => mailboxState.get(id)!),
          stickyMailboxId: d.assigned_mailbox_id,
          contactEsp: d.esp,
          espMatching: s.espMatching,
          now,
          seed: d.id,
        },
      });
      stats[decision.action] = (stats[decision.action] ?? 0) + 1;

      if (decision.action === "send") {
        const m = mailboxState.get(decision.mailboxId)!;
        m.sentToday += 1;
        m.nextAvailableAt = new Date(now.getTime() + randomGapMs(m.minGap, m.maxGap));
        if (companyKey && isFirstTouch) companyCounts.set(companyKey, { contacted: cc.contacted + 1, inflight: cc.inflight + 1 });
        await tx.execute(sql`update sequence_contacts set state = 'sending', assigned_mailbox_id = ${m.id}, last_error = null where id = ${d.id}`);
        await tx.execute(sql`
          insert into mailbox_daily_stats (mailbox_id, day, sent) values (${m.id}, ${localDayKey(now, m.timezone)}, 1)
          on conflict (mailbox_id, day) do update set sent = mailbox_daily_stats.sent + 1
        `);
        await tx.execute(sql`update mailboxes set next_available_at = ${m.nextAvailableAt.toISOString()} where id = ${m.id}`);
        jobs.push({ sequenceContactId: d.id, mailboxId: m.id, stepIndex: d.next_step! });
      } else if (decision.action === "reschedule") {
        await tx.execute(sql`update sequence_contacts set state = 'active', next_run_at = ${decision.at.toISOString()}, last_error = ${decision.reason} where id = ${d.id}`);
      } else {
        await tx.execute(sql`update sequence_contacts set state = ${decision.state}, next_run_at = null, last_error = ${decision.reason} where id = ${d.id}`);
      }
    }
  });

  return { jobs, stats };
}
