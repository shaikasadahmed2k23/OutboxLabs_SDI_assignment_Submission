# Outbox Labs — Email Job Scheduler

Full-stack email scheduler: BullMQ + Redis for delayed/persistent jobs,
Postgres (Supabase) for state, Ethereal for SMTP. See `DECISIONS.md`
for the full architecture reasoning as it's built.

**Status: Phase 1 + Phase 2 + Phase 4 complete** — core scheduler, idempotency,
restart recovery, rate limiting, concurrency/throttling, Slack OAuth
notifications, live BullMQ dashboard, Elasticsearch search indexing, and a
Next.js dashboard with real Google login. Phase 3/5 wrap-up (README polish,
demo video) in progress.

## Setup

### 1. Supabase (Postgres)
1. Create a free project at [supabase.com](https://supabase.com)
2. Project Settings → Database → Connection string (URI, "Transaction" pooler is fine for this scale)
3. Copy it into `backend/.env` as `DATABASE_URL`

### 2. Redis + Elasticsearch (via Docker)
```bash
docker compose up -d
```
Starts Redis (AOF-persisted) on `localhost:6379` and Elasticsearch on `localhost:9200`.

### 3. Slack app (for rate-limit notifications)
1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) → "From scratch"
2. OAuth & Permissions → add redirect URL `http://localhost:4000/auth/slack/callback`
3. Scopes → add `incoming-webhook`
4. Install to your workspace, copy the Client ID + Client Secret into `.env`

### 4. Backend
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, ETHEREAL_USER/PASS at minimum
npm install
npx prisma migrate dev --name init
npx prisma db seed       # creates a test Sender, cap=10/hr for easy demo
```

### 5. Ethereal SMTP
Get free test SMTP creds at [ethereal.email/create](https://ethereal.email/create) (no signup) and put them in `.env` as `ETHEREAL_USER` / `ETHEREAL_PASS`.

### 6. Run
Two processes, separate terminals:
```bash
npm run dev       # Express API on :4000
npm run worker    # BullMQ worker
```

### 7. Test it
```bash
# get the seeded sender's id
npx prisma studio   # opens a DB browser — copy the Sender.id

curl -X POST http://localhost:4000/api/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "senderId": "<paste sender id>",
    "recipients": ["a@test.com","b@test.com","c@test.com"],
    "subject": "Test",
    "body": "Hello from the scheduler",
    "startTime": "2026-09-18T15:00:00.000Z",
    "delayBetweenEmailsMs": 2000
  }'

curl http://localhost:4000/api/scheduled
curl http://localhost:4000/api/sent
```

### 8. Prove restart-safety (for the demo video)
1. Schedule an email 3-4 minutes out
2. Kill the worker process (`Ctrl+C`)
3. Restart it (`npm run worker`)
4. Confirm the email still sends at the right time, exactly once —
   check `/api/sent` shows `status: SENT` with a single `sentAt`, and
   that Redis/Postgres agree (no duplicate `EmailJob` row, no second send).

### 9. Trigger rate limiting (for the demo)
The seeded sender has `maxPerHour: 10`. Schedule 15+ emails for the
same `startTime` with a small `delayBetweenEmailsMs` — the 11th
onward will show `status: RATE_LIMITED` then get rescheduled into the
next hour window automatically.

### 10. Verify Phase 2 pieces
- **BullMQ dashboard**: open `http://localhost:4000/admin/queues` — you should see the `email-send` queue with your scheduled/delayed jobs listed live
- **Slack**: `GET http://localhost:4000/auth/slack/authorize?senderId=<id>` in a browser → approve → check `GET http://localhost:4000/auth/slack/status/<id>` shows `connected: true` → schedule enough emails to exceed the seeded sender's 10/hr cap and confirm a message lands in your Slack channel
- **Elasticsearch search**: `curl "http://localhost:4000/api/search?q=test"` after scheduling a few emails — should return matching rows

## Frontend setup

### 1. Google OAuth
1. [Google Cloud Console](https://console.cloud.google.com) → new project → **OAuth consent screen** (External, add your own Google account as a test user)
2. **Credentials → Create Credentials → OAuth client ID → Web application**
3. Authorized JavaScript origin: `http://localhost:3000`
4. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Copy the Client ID + Client Secret

### 2. Install & configure
```bash
cd frontend
cp .env.local.example .env.local
npm install
```
Fill in `.env.local`:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step 1
- `NEXTAUTH_SECRET` — any long random string (`openssl rand -base64 32`)
- `NEXT_PUBLIC_DEFAULT_SENDER_ID` — the seeded `Sender.id` from the backend setup (`npx prisma db seed` printed it, or check `npx prisma studio`)

### 3. Run
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) — redirects to `/login`. Sign in with the Google account you added as a test user.

### 4. What you'll see
- **Dashboard** (`/dashboard`): header with your Google name/email/avatar, Scheduled/Sent tabs, "+ Compose New Email"
- **Compose modal**: subject, body, CSV/text upload (shows detected email count), start time, delay between emails, hourly limit (informational — the enforced cap is the seeded `Sender.maxPerHour`)
- **Settings** (`/settings`): Slack connect/disconnect, link to the live BullMQ dashboard (`/admin/queues`)

The frontend polls `/api/scheduled` and `/api/sent` every 8s, so scheduling an email and watching it move from Scheduled → Sent (or get rate-limited) is visible without a manual refresh — useful for the demo video.
