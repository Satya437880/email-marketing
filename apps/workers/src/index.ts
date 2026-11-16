import { executeSend, markSendFailed, PermanentSendError, planTick, syncMailbox, type SendJob } from "@outreach/core";
import { db, mailboxes, sqlClient } from "@outreach/db";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const trackingBaseUrl = process.env.TRACKING_BASE_URL ?? "http://localhost:4000";
const PLAN_EVERY_MS = 30_000;
const SYNC_EVERY_MS = 60_000;
const SEND_ATTEMPTS = 3;

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

// A network hiccup (for example a mail server resetting a connection) must never stop sending: log it and carry on.
process.on("uncaughtException", (e) => log("uncaught_exception", { error: String(e) }));
process.on("unhandledRejection", (e) => log("unhandled_rejection", { error: String(e) }));

const sendQueue = new Queue<SendJob>("send", { connection });
const syncQueue = new Queue<{ mailboxId: string }>("sync", { connection });

const sendWorker = new Worker<SendJob>("send", async (job) => {
  try {
    const outcome = await executeSend(job.data, { trackingBaseUrl });
    log("send", { sc: job.data.sequenceContactId, mailbox: job.data.mailboxId, step: job.data.stepIndex, outcome });
    return outcome;
  } catch (e) {
    if (e instanceof PermanentSendError) throw new UnrecoverableError(e.message);
    throw e;
  }
}, { connection, concurrency: 10 });

sendWorker.on("failed", async (job, err) => {
  if (!job) return;
  const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  log("send_failed", { sc: job.data.sequenceContactId, attempt: job.attemptsMade, final, error: err.message });
  if (final) await markSendFailed(job.data, err.message).catch((e) => log("mark_failed_error", { error: String(e) }));
});

const syncWorker = new Worker<{ mailboxId: string }>("sync", async (job) => {
  const mailbox = await db.query.mailboxes.findFirst({ where: eq(mailboxes.id, job.data.mailboxId) });
  if (!mailbox || mailbox.status === "disconnected") return;
  const r = await syncMailbox(mailbox);
  if (r.fetched) log("sync", { mailbox: mailbox.email, ...r });
}, { connection, concurrency: 5 });

syncWorker.on("failed", (job, err) => log("sync_failed", { mailbox: job?.data.mailboxId, error: err.message }));

let planning = false;
async function plan() {
  if (planning) return;
  planning = true;
  try {
    const { jobs, stats } = await planTick();
    if (stats.considered) log("plan", stats);
    // jobId makes enqueueing idempotent if a tick is retried.
    await sendQueue.addBulk(jobs.map((data) => ({
      name: "send",
      data,
      opts: { jobId: `${data.sequenceContactId}-${data.stepIndex}-${Date.now()}`, attempts: SEND_ATTEMPTS, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    })));
  } catch (e) {
    log("plan_error", { error: String(e) });
  } finally {
    planning = false;
  }
}

async function scheduleSyncs() {
  try {
    const list = await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.status, "active"));
    const minute = Math.floor(Date.now() / SYNC_EVERY_MS);
    await syncQueue.addBulk(list.map((m) => ({
      name: "sync",
      data: { mailboxId: m.id },
      opts: { jobId: `sync-${m.id}-${minute}`, attempts: 1, removeOnComplete: 100, removeOnFail: 500 },
    })));
  } catch (e) {
    log("sync_schedule_error", { error: String(e) });
  }
}

const timers = [setInterval(plan, PLAN_EVERY_MS), setInterval(scheduleSyncs, SYNC_EVERY_MS)];
void plan();
void scheduleSyncs();
log("workers_started", { planEveryMs: PLAN_EVERY_MS, syncEveryMs: SYNC_EVERY_MS });

async function shutdown() {
  log("shutting_down");
  timers.forEach(clearInterval);
  await Promise.all([sendWorker.close(), syncWorker.close()]);
  await Promise.all([sendQueue.close(), syncQueue.close()]);
  connection.disconnect();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
