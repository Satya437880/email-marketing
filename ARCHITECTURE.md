# Architecture

Outreach is a cold-email and sequence tool. Users connect their own mailboxes (Gmail, Outlook or plain SMTP/IMAP), import contacts, build multi-step sequences, and the system sends the emails on a schedule, tracks opens, clicks and unsubscribes, and pulls replies back into a shared inbox ("Primebox").

It is a TypeScript npm-workspaces monorepo (`package.json` workspaces: `packages/*`, `apps/*`) with three runnable apps and four shared packages.

## System overview

```
                 ┌──────────────┐   /v1, /t, /u    ┌────────────────┐
  Browser ─────▶ │  apps/web    │ ───────────────▶ │  apps/api      │
  (user)         │  React+Vite  │   (proxy/rewrite)│  Fastify :4000 │
                 └──────────────┘                  └───────┬────────┘
                                                           │ drizzle
  Recipient ── open pixel / click / unsubscribe ──▶ /t, /u │
                                                           ▼
                                                   ┌────────────────┐
                 ┌──────────────┐   enqueue/consume│   PostgreSQL   │
                 │ apps/workers │ ◀───────────────▶│  (source of    │
                 │  BullMQ      │                  │   truth)       │
                 └──┬────────┬──┘                  └────────────────┘
                    │        │          ┌─────────┐
       SMTP send ◀──┘        └─────────▶│  Redis  │  BullMQ queues: "send", "sync"
       IMAP sync ──▶ mailbox providers   └─────────┘
```

| Piece | Path | Role |
|---|---|---|
| Web | `apps/web` | React 18, Vite, Tailwind, TanStack Query, React Router, Recharts |
| API | `apps/api` | Fastify 5 REST API under `/v1`, plus public tracking routes |
| Workers | `apps/workers` | Planner loop, send queue, mailbox-sync queue (BullMQ on Redis) |
| `@outreach/db` | `packages/db` | Drizzle ORM schema, SQL migrations, credential encryption |
| `@outreach/engine` | `packages/engine` | Pure scheduling and mailbox-selection logic (no I/O) |
| `@outreach/mail` | `packages/mail` | Email composition, rendering, SMTP/IMAP transport, inbound classification |
| `@outreach/core` | `packages/core` | Business logic that ties db, engine and mail together |

Dependency direction: `apps/*` → `core` → (`engine`, `mail`, `db`). `engine` and `mail` have no database access, which keeps them unit-testable (`engine.test.ts`, `mail.test.ts`).

## Packages

### `packages/db`
- `src/schema.ts`: the whole data model (see [Data model](#data-model)).
- `migrations/`: Drizzle-generated SQL, applied with `npm run db:migrate`. Generate new ones with `npm run db:generate`.
- `src/index.ts`: creates the `postgres` client and Drizzle instance. It loads the repo-root `.env` itself if present, so every app gets the same configuration. `DB_POOL` sets the connection pool size (default 10).
- `src/crypto.ts`: AES-256-GCM `encryptJson` / `decryptJson`, keyed by `CREDENTIALS_KEY` (64 hex chars). Stored format is `v1.<iv>.<tag>.<data>`. Used for mailbox passwords and OAuth tokens.

### `packages/engine` (pure logic)
- `schedule.ts`: sending windows. A schedule is a timezone, weekdays, start/end times and optional per-weekday hours. It provides `alignToWindow`, `nextWindowStart` and `localDayKey`.
- `planner.ts`: `evaluate()` decides, for one due contact, whether to **send**, **reschedule** or **stop**. It checks:
  - the do-not-contact list and unsubscribes;
  - company rules (stop when anyone at the company replies, one contact at a time, a per-company cap);
  - mailbox choice: sticky mailbox per contact, daily capacity, the gap between sends, and optional matching of the sending provider to the recipient's ESP (Google to Google, and so on).
  - It also contains `orderDue`, `randomGapMs`, `pickVariant` and `nextEmailStep`.

### `packages/mail`
- `render.ts`: `{{variable}}` substitution and spintax, seeded so a given contact always gets the same variation. Also `htmlToText` and `escapeHtml`.
- `compose.ts`: builds the outgoing message. It adds the plain-text part, signature, unsubscribe link and `List-Unsubscribe` headers, open pixel, click-link rewriting, reply threading headers (`In-Reply-To` / `References`), quoted text, cc/bcc, and inline images as `cid:` attachments.
- `transport.ts`: Nodemailer for SMTP and ImapFlow for IMAP. Google and Microsoft mailboxes use the same adapters with XOAUTH2 access tokens (`MailboxAuth` is either `password` or `oauth2`). `PROVIDER_SERVERS` holds the Gmail and Office 365 hosts.
- `classify.ts`: rule-based classification of inbound mail into `bounce` (hard or soft), `out_of_office` (with return date), `unsubscribe`, `auto_reply` or `reply`.
- `esp.ts`: MX lookup to detect a recipient's provider, and a deliverability check (`domainAcceptsMail`).
- `spam-check.ts`: content checks before sending.
- `system.ts`: sends the system's own mail (sign-up verification codes) using `SYSTEM_SMTP_URL`.

### `packages/core`
| File | Responsibility |
|---|---|
| `planner.ts` | `planTick()`: one scheduling pass (see below) |
| `send.ts` | `executeSend()`: render, compose, send, record. Also `markSendFailed`, `maybeCompleteSequence` |
| `inbound.ts` | `syncMailbox()`: fetch new IMAP mail, classify it, update threads, contacts and sequences |
| `mailbox.ts` | `connectionFor()`: decrypts credentials and refreshes OAuth tokens into SMTP/IMAP settings |
| `oauth.ts` | Google and Microsoft OAuth flows (login and mailbox connect) |
| `tracking.ts` | `recordOpen`, `recordClick`, `unsubscribeByToken` |
| `webhooks.ts` | `emitEvent()`: signed (HMAC) outbound webhooks, with an SSRF guard that allows only public https hosts |
| `reply.ts`, `manual.ts` | Replies and one-off manual sends from the inbox |
| `sequences.ts`, `workspace.ts` | Sequence helpers; the do-not-contact list (`dncMatches`, `addDnc`) and labels |

## Apps

### `apps/api`
`server.ts` registers cookie, CORS (only `WEB_ORIGIN`, with credentials) and the route modules: `auth`, `oauth-login`, `workspace`, `mailboxes`, `contacts`, `sequences`, `emails`, `invites`, `inbox`, `analytics` and `tracking`. It also serves `GET /health`.

Request pipeline:
1. **`onRequest`**, for `/v1/*` only. An API key (`loadApiKey`) is accepted first and skips CSRF. Otherwise non-GET requests must send `X-Requested-With: outreach`, and then the session user is loaded from the `sid` cookie (`loadUser`).
2. **`preHandler`**: for `/v1/workspaces/:ws/...`, `loadWorkspace` resolves the workspace and the caller's role.
3. A global error handler maps `HttpError` to `{code, message, details}` and hides internal 500 details.

Auth (`auth.ts`):
- Passwords are hashed with Argon2id (`@node-rs/argon2`).
- Sessions are random 32-byte ids stored in the `sessions` table (30 days). They are sent in an httpOnly, `sameSite=lax` cookie, and `secure` in production.
- Roles are `owner`, `admin`, `member`, `viewer` and `primebox`. The primebox role is restricted by path to threads, labels, templates and reminders only.
- Sign-up requires a 6-digit emailed code (`pending_signups`). Google and Microsoft login are optional and appear only when their client IDs are set.

Public tracking routes (`routes/tracking.ts`, no session, no workspace in the path):
- `GET /t/o/:token`: records an open and returns a 1×1 GIF.
- `GET /t/c/:token?u=…`: records the click and 302-redirects to the target.
- `GET /u/:token` shows a confirmation page. `POST /u/:token` performs the unsubscribe and also serves RFC 8058 one-click. Unsubscribing happens on POST only so link scanners can't opt people out.
- Tokens are 16 random bytes in base64url, one per sent message. A mailbox can use its own verified tracking domain instead of the default base URL.

### `apps/workers`
One process, two BullMQ queues on Redis, plus two timers:

| Loop | Interval | What it does |
|---|---|---|
| `plan()` | 30 s | Calls `planTick()`, then enqueues the resulting jobs on the `send` queue |
| `scheduleSyncs()` | 60 s | Enqueues one `sync` job per active mailbox (`jobId` includes the minute, so duplicates are dropped) |
| `send` worker | concurrency 10 | `executeSend()`; 3 attempts with exponential backoff from 60 s |
| `sync` worker | concurrency 5 | `syncMailbox()` for one mailbox |

Failure handling:
- `PermanentSendError` (for example, mailbox auth failure) becomes BullMQ's `UnrecoverableError`, so it is not retried.
- When a job's retries are used up, `markSendFailed` releases the daily-cap reservation and reschedules the contact one hour later.
- Uncaught exceptions are logged and do not stop the process. `SIGINT` and `SIGTERM` close the queues and the database pool.

### `apps/web`
React SPA. Pages (`src/pages`): Auth, Invite, Sequences (list, overview, steps, builder), Contacts, Emails, Compose, Mailboxes, Primebox (the inbox, with filters and reply composer), Analytics and Settings. `api.ts` is the fetch wrapper (it adds the CSRF header and sends credentials). `EmailEditor.tsx` and `StepBuilder.tsx` are the rich-text editor and the sequence step editor. In development, Vite proxies `/v1`, `/t/` and `/u/` to `localhost:4000`. In production, `vercel.json` rewrites those paths to the API host and falls back to `index.html`.

## How an email gets sent

1. **Plan** (`planTick`, every 30 s). Inside one transaction:
   - It takes a Postgres advisory lock (`pg_try_advisory_xact_lock`), so only one planner runs at a time.
   - It selects up to 1000 due `sequence_contacts` with `FOR UPDATE SKIP LOCKED`.
   - It loads each sequence's mailboxes, today's per-mailbox sent counts, DNC matches and company counters.
   - It calls `evaluate()` for each contact.
   - On *send*, it marks the contact `sending`, **reserves** the send against the mailbox's daily cap (upsert into `mailbox_daily_stats`), sets the mailbox's `next_available_at` to a random gap, and emits a `SendJob`.
   - On *reschedule* or *stop*, it updates the state.

   Reserving the cap inside the same transaction means daily limits hold even if the job fails later.
2. **Enqueue**: the worker adds the jobs to the `send` queue.
3. **Execute** (`executeSend`):
   - It re-checks that the contact is still `sending` and that the sequence and mailbox are `active`.
   - It picks a step variant (A/B).
   - The "bounce shield" skips invalid addresses and domains with no mail server.
   - It renders the subject and body, and continues the existing thread when the follow-up's subject is empty.
   - It composes the message with tracking and unsubscribe, sends over SMTP with `connectionFor()` credentials, and handles errors:
     - `EAUTH` marks the mailbox `error`.
     - A 5xx rejection marks the contact `bounced` and `invalid`.
     - Anything else is retried.
   - In one transaction it writes the `thread`, the `message`, a `sent` event and the contact's new state (next step and the next run time aligned to the sending window).
   - It then emits the `email.sent` webhook.
4. **Complete**: when no contacts are left in `queued`, `active`, `sending` or `ooo`, the sequence becomes `completed` and `sequence.completed` is emitted.

## How replies come back

`syncMailbox` fetches new IMAP messages after the stored `imap_last_uid` (guarded by `imap_uid_validity`) and runs each one through `classify` and `processInbound`:
- A **bounce** marks the contact bounced.
- An **out-of-office** pauses the contact (`ooo`) until the return date.
- An **unsubscribe** reply adds the contact to the do-not-contact list.
- A **reply** is attached to the thread, stops the sequence for that contact, can stop the whole company, and is labelled (positive, meeting booked, and so on). It appears in Primebox.

An authentication failure sets the mailbox to `error`, and a later successful sync restores it to `active`.

## Data model

Defined in `packages/db/src/schema.ts` (PostgreSQL). Tables are grouped by area:

- **Tenancy and access:** `organizations`, `workspaces`, `users`, `memberships`, `sessions`, `api_keys`, `workspace_invites`, `pending_signups`
- **Sending infrastructure:** `domains`, `mailboxes` (encrypted credentials, daily limit, gap range, timezone, signature, tracking domain, IMAP cursor), `mailbox_daily_stats`, `sender_profiles`, `sender_profile_mailboxes`
- **Audience:** `companies`, `contacts`, `tags`, `contact_tags`, `import_jobs`, `dnc_entries`
- **Campaigns:** `sequences` (settings JSON: schedule, tracking, opt-out, cc/bcc, company rules), `sequence_steps`, `step_variants`, `sequence_senders`, `sequence_contacts` (the per-contact state machine: `queued`, `active`, `sending`, `ooo`, `finished`, `bounced`, `error`, and others)
- **Conversations:** `threads`, `messages` (in and out, with tracking token and Message-ID headers), `labels`
- **Integrations and content:** `webhooks`, `products`, `templates`
- **Analytics:** `events`, an append-only log (sent, bounced, opened, clicked, replied, and so on) indexed by workspace and time and by sequence and type. The analytics routes read from it.

All business data carries a `workspace_id`, and API access is scoped through the workspace the caller belongs to.

## Security notes
- Mailbox passwords and OAuth tokens are encrypted at rest with AES-256-GCM. Losing or changing `CREDENTIALS_KEY` makes stored credentials unreadable.
- CSRF protection uses the `X-Requested-With` header, with CORS limited to `WEB_ORIGIN`. API keys bypass CSRF because they are sent explicitly.
- Unsubscribe is POST-only for the state change, and open and click tokens are validated against a strict pattern.
- Webhook targets must be public https hosts (private, loopback and link-local addresses are rejected). Payloads are HMAC-signed.
- The API sets `trustProxy: true`, so it expects to run behind a reverse proxy or platform router.

## Configuration

Environment variables (see `.env.example`; `.env` is git-ignored):

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL`, `DB_POOL` | all | Postgres connection and pool size |
| `REDIS_URL` | workers | BullMQ connection |
| `CREDENTIALS_KEY` | api, workers | 64-hex AES key for stored credentials |
| `SESSION_SECRET` | api | Cookie signing |
| `API_PORT`, `WEB_ORIGIN` | api | Port (default 4000) and the allowed CORS origin |
| `PUBLIC_URL` | api | Public app address; OAuth redirect URIs are built from it |
| `TRACKING_BASE_URL`, `TRACKING_CNAME_TARGET` | api, workers | Base URL for tracking and unsubscribe links; target for custom tracking domains |
| `GOOGLE_*`, `MICROSOFT_*` | api, workers | Optional OAuth login and one-click mailbox connect |
| `SYSTEM_SMTP_URL`, `SYSTEM_MAIL_FROM` | api | Sends sign-up verification codes (required in production) |
| `LOG_LEVEL`, `NODE_ENV` | api | Logging and the secure-cookie switch |

## Running locally

```
npm install
npm run db:migrate      # needs Postgres
npm run dev:api         # :4000
npm run dev:workers     # needs Redis
npm run dev:web         # :5173, proxies /v1 /t /u to the API
npm test                # vitest
npm run typecheck
```

`start-memurai.bat` starts Memurai, a Redis-compatible server for Windows.

## Deployment shape
- **Web:** static build (`npm run build -w @outreach/web`). It can be hosted on Vercel, and `apps/web/vercel.json` rewrites the API paths to the API host.
- **API and workers:** long-running Node processes (`npm run start -w @outreach/api` and `-w @outreach/workers`). They need always-on hosting, not serverless.
- **Postgres and Redis** are required.
- Recipients' tracking and unsubscribe links point at `TRACKING_BASE_URL` (or a mailbox's own tracking domain), so that address must stay publicly reachable.
- The `vercel.json` rewrites currently point to a temporary `trycloudflare.com` tunnel address. Replace it with the permanent API address before a real deployment.
