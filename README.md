# Outbox Labs — Email Job Scheduler

Full-stack email scheduler: BullMQ + Redis for delayed/persistent jobs,
Postgres (Supabase) for state, Ethereal for SMTP. See `DECISIONS.md`
for the full architecture reasoning as it's built.

**Status: Phase 1 complete** — core scheduler, idempotency, restart
recovery, rate limiting, concurrency/throttling, Slack notification hook.
Phase 2 (Slack OAuth flow), Phase 3 (Elasticsearch), Phase 4 (frontend)
still to come.

## Setup

### 1. Supabase (Postgres)
1. Create a free project at [supabase.com](https://supabase.com)
2. Project Settings → Database → Connection string (URI, "Transaction" pooler is fine for this scale)
3. Copy it into `backend/.env` as `DATABASE_URL`

### 2. Redis (via Docker)
```bash
docker compose up -d
```
Starts Redis on `localhost:6379` with AOF persistence enabled (`docker-compose.yml`), so queued jobs survive a container restart too.

### 3. Backend
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, ETHEREAL_USER/PASS at minimum
npm install
npx prisma migrate dev --name init
npx prisma db seed       # creates a test Sender, cap=10/hr for easy demo
```

### 4. Ethereal SMTP
Get free test SMTP creds at [ethereal.email/create](https://ethereal.email/create) (no signup) and put them in `.env` as `ETHEREAL_USER` / `ETHEREAL_PASS`.

### 5. Run
Two processes, separate terminals:
```bash
npm run dev       # Express API on :4000
npm run worker    # BullMQ worker
```

### 6. Test it
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

### 7. Prove restart-safety (for the demo video)
1. Schedule an email 3-4 minutes out
2. Kill the worker process (`Ctrl+C`)
3. Restart it (`npm run worker`)
4. Confirm the email still sends at the right time, exactly once —
   check `/api/sent` shows `status: SENT` with a single `sentAt`, and
   that Redis/Postgres agree (no duplicate `EmailJob` row, no second send).

### 8. Trigger rate limiting (for the demo)
The seeded sender has `maxPerHour: 10`. Schedule 15+ emails for the
same `startTime` with a small `delayBetweenEmailsMs` — the 11th
onward will show `status: RATE_LIMITED` then get rescheduled into the
next hour window automatically.
