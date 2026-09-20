# Architecture & Decisions Journal

Kept running as the project is built, so the final README's
architecture section is written *from* this, not reconstructed
after the fact.

## Phase 1 — Core scheduler (done)

**Stack:** Express + TypeScript, Prisma + Supabase (Postgres), BullMQ + Redis (Docker), Nodemailer + Ethereal.

### Idempotency & source of truth
`EmailJob.status` in Postgres is the single source of truth for whether
an email has been sent — not BullMQ's internal job state. The worker
always re-checks the DB row before attempting a send. `EmailJob.bullJobId`
is always set equal to the row's own `id`, and BullMQ enforces unique
`jobId`s per queue — so even a duplicate `schedule()` call or a
crash-recovery re-add can't produce two live jobs for the same row.
Two independent guards: BullMQ's unique jobId, and the DB status check.

### Persistence across restarts
BullMQ's delayed jobs live in Redis (AOF-persisted via
`docker-compose.yml`'s `--appendonly yes`), so scheduled jobs survive
an app restart on their own — this is *why* BullMQ was required over
cron. On worker boot, `recoverStuckJobs()` sweeps any `EmailJob` rows
stuck in `QUEUED` (meaning the process died mid-send) and re-adds them
if BullMQ has no live record, so a crash between "mark QUEUED" and
"mark SENT" can't silently lose a job.

### Rate limiting (emails/hour)
Redis fixed-hour-window counters (`ratelimit:{senderId}:{YYYY-MM-DDTHH}`),
incremented atomically via `INCR` — safe across multiple worker
processes since Redis operations are single-threaded/atomic. Chose a
fixed window over a sliding window (sorted set of timestamps) for
simplicity and O(1) cost; trade-off is a possible burst at the hour
boundary, which is acceptable for what this assignment is testing.
Cap is configurable per-sender (`Sender.maxPerHour`) with a global env
fallback (`MAX_EMAILS_PER_HOUR`) — no hardcoding.

When a send would exceed the cap: the job is NOT dropped or failed.
It's marked `RATE_LIMITED`, a `RateLimitEvent` audit row is written, a
Slack notification fires (if connected), and the job is re-added to
BullMQ delayed until the next hour window boundary
(`msUntilNextHourWindow()`).

### Concurrency & throttling
Worker concurrency is configurable via `WORKER_CONCURRENCY` env (BullMQ
`Worker` option). Independently, `MIN_DELAY_BETWEEN_SENDS_MS` enforces a
floor between individual sends *within* each worker slot — so even at
concurrency 5, no single slot fires faster than the configured delay.

### Batch scheduling (CSV / multiple recipients)
Each recipient in a `POST /schedule` request becomes its own `EmailJob`
row and its own BullMQ delayed job, staggered from `startTime` by
`i * delayBetweenEmailsMs`. This spreads 1000+ simultaneous recipients
across real delayed-job slots instead of dumping them all into the
queue at once — the worker's per-slot `MIN_DELAY_BETWEEN_SENDS_MS` is a
second, independent throttle on top of that stagger.

### Slack notifications
Real OAuth token (or incoming webhook URL) stored per-`Sender` in
`SlackIntegration`. The worker re-queries this table on every
rate-limit hit (no caching) — so connecting Slack mid-session starts
notifications immediately, no redeploy. No integration row = silent
no-op, never a crash.

### Still open for later phases
- Google OAuth login (Phase 4, frontend)
- Frontend dashboard itself (Phase 4)

## Phase 2 — Slack OAuth, live BullMQ dashboard, Elasticsearch (done)

### Slack OAuth flow
Real `oauth.v2.access` exchange (`/auth/slack/authorize` → Slack consent
screen → `/auth/slack/callback`). Used `incoming-webhook` scope rather than
a bot token + `chat:write` — simpler for this scope of assignment (one
webhook URL per workspace/channel, no bot token lifecycle to manage) and
still satisfies "real OAuth flow, live verifiable Slack message." The
`state` param carries the `senderId` through the redirect round-trip
(also doubles as Slack's documented CSRF protection). Disconnect (`DELETE
/auth/slack/:senderId`) just removes the `SlackIntegration` row — the
worker already re-queries per rate-limit hit with no caching, so
connect/disconnect take effect immediately, no redeploy, matching the
spec's explicit requirement.

### Live BullMQ dashboard
`@bull-board/express` mounted at `/admin/queues`, pointed at the same
`emailQueue` instance the API and worker both use — satisfies "expose a
live BullMQ dashboard for real-time queue visibility" directly, no custom
UI needed for this part.

### Elasticsearch indexing
Postgres remains the single source of truth (per Phase 1's core decision)
— ES is a best-effort search index only. Documents are upserted (doc id =
`EmailJob.id`) on creation and on every status transition (SENT, FAILED).
A failed ES write is logged and swallowed, never allowed to fail the
underlying schedule/send operation — a stale search index is an
acceptable trade-off, a scheduler that can't schedule because ES is down
is not. `GET /api/search?q=` does a `multi_match` across `toEmail`,
`subject`, `body`.

## Phase 4 — Frontend (done)

### Stack
Next.js 14 (App Router) + TypeScript + Tailwind, NextAuth.js for Google OAuth,
PapaParse for CSV parsing. No state management library — the dashboard's data
needs (scheduled/sent lists) are simple enough for local `useState` + polling.

### Google OAuth
Real OAuth via NextAuth's Google provider — no mock. `middleware.ts` protects
`/dashboard` and `/settings`, redirecting unauthenticated visitors to `/login`.
Session (name, email, avatar) comes straight from Google's profile via
NextAuth's default session callback — no separate user table needed for this
assignment's scope.

### Sender identity
The backend's data model is per-`Sender`, but the assignment's frontend spec
never asks for a sender-picker UI — compose only asks for subject/body/leads/
timing. Rather than build unrequested UI, the frontend targets a single sender
via `NEXT_PUBLIC_DEFAULT_SENDER_ID` (the seeded sender's id). Documented in
README setup.

### Compose modal — CSV/text parsing
Accepts `.csv` or `.txt`. CSV rows are parsed with PapaParse and flattened;
plain text is split on newlines/commas. Both paths run through the same email
regex filter before counting "recipients detected" — so a file with headers
or blank lines doesn't inflate the count. The "Hourly limit" field is kept in
the UI to match the spec's compose requirements, but is informational: the
enforced cap lives on `Sender.maxPerHour` in the DB (Phase 1 decision), not
per-request — wiring a per-batch override would mean a schema change with no
clear backend consumer at this scope, so it's called out with a note in the
UI rather than silently doing nothing.

### Dashboard polling
Scheduled/Sent tables poll the backend every 8s rather than using
WebSockets/SSE — the backend doesn't expose a push channel, and 8s is fast
enough to visibly reflect worker activity (a job moving from Scheduled to
Sent, or a rate-limit requeue) without over-fetching for what's ultimately a
demo-scale dataset.

### Settings page
Slack "Connect" is a plain `<a href>` straight to the backend's
`/auth/slack/authorize` — the OAuth redirect dance happens entirely
server-side (Phase 2), so the frontend just needs to link into it and reflect
`connected: true/false` afterward via `/auth/slack/status/:senderId`. The
Bull Board link opens the backend's `/admin/queues` in a new tab rather than
embedding it — Bull Board ships its own full UI, embedding it would mean
fighting its layout inside an iframe for no real benefit.
