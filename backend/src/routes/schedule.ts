import { Router } from "express";
import { prisma } from "../lib/prisma";
import { scheduleEmailJob } from "../queue/emailQueue";
import { scheduleRequestSchema } from "../types/schedule";
import { indexEmailJob, searchEmailJobs } from "../lib/elasticsearch";
import { randomUUID } from "crypto";

export const scheduleRouter = Router();

/**
 * POST /schedule
 *
 * DESIGN DECISION — CSV/batch fan-out: each recipient in `recipients`
 * becomes its OWN EmailJob row + its own BullMQ delayed job. The
 * `delayBetweenEmailsMs` is applied as a staggered offset from
 * `startTime`, i.e. recipient[i] is scheduled at
 * startTime + i * delayBetweenEmailsMs.
 *
 * This is deliberate, not the worker's per-send sleep: staggering at
 * SCHEDULE time spreads jobs across real delayed-job slots (so 1000
 * emails scheduled "for now" don't all land in the queue at the same
 * instant and fight over the worker's concurrency/rate-limit window
 * simultaneously). The worker's MIN_DELAY_BETWEEN_SENDS_MS is a
 * second, independent throttle on top of this, per worker slot.
 * Documented in README under "Behavior under load".
 */
scheduleRouter.post("/schedule", async (req, res) => {
  const parsed = scheduleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { senderId, recipients, subject, body, startTime, delayBetweenEmailsMs } = parsed.data;

  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) {
    return res.status(404).json({ error: `Sender ${senderId} not found` });
  }

  const batchId = parsed.data.batchId ?? randomUUID();
  const start = new Date(startTime);
  const now = Date.now();

  const created = [];
  for (let i = 0; i < recipients.length; i++) {
    const scheduledFor = new Date(start.getTime() + i * delayBetweenEmailsMs);

    const row = await prisma.emailJob.create({
      data: {
        senderId,
        toEmail: recipients[i],
        subject,
        body,
        scheduledFor,
        batchId,
      },
    });

    const delayMs = scheduledFor.getTime() - now;
    await scheduleEmailJob({ emailJobId: row.id, senderId, delayMs });

    // Store the BullMQ jobId (== row.id) back for clarity/debugging
    await prisma.emailJob.update({ where: { id: row.id }, data: { bullJobId: row.id } });

    // Fire-and-forget: indexing is best-effort (see elasticsearch.ts), and
    // awaiting it here would serialize ES latency into every recipient in
    // the batch — at 1000+ recipients that turns a down/slow ES into a
    // multi-minute API response. indexEmailJob already catches its own
    // errors internally, so this is safe to not await.
    indexEmailJob({
      id: row.id,
      toEmail: row.toEmail,
      subject: row.subject,
      body: row.body,
      status: row.status,
      senderId: row.senderId,
      senderName: sender.name,
      scheduledFor: row.scheduledFor,
      batchId: row.batchId,
    });

    created.push(row.id);
  }

  res.status(201).json({ batchId, scheduled: created.length, emailJobIds: created });
});

/** GET /scheduled — rows not yet sent/failed, for the dashboard's "Scheduled" tab */
scheduleRouter.get("/scheduled", async (_req, res) => {
  const rows = await prisma.emailJob.findMany({
    where: { status: { in: ["PENDING", "QUEUED", "RATE_LIMITED"] } },
    include: { sender: { select: { name: true, fromEmail: true } } },
    orderBy: { scheduledFor: "asc" },
  });
  res.json(rows);
});

/** GET /search?q=... — full-text search across scheduled + sent emails via Elasticsearch */
scheduleRouter.get("/search", async (req, res) => {
  const q = (req.query.q as string) || "";
  if (!q.trim()) {
    return res.status(400).json({ error: "q query param is required" });
  }
  try {
    const results = await searchEmailJobs(q);
    res.json(results);
  } catch (err) {
    console.error("[search] elasticsearch query failed", err);
    res.status(503).json({ error: "Search is temporarily unavailable" });
  }
});

/** GET /sent — sent + failed rows, for the dashboard's "Sent" tab */
scheduleRouter.get("/sent", async (_req, res) => {
  const rows = await prisma.emailJob.findMany({
    where: { status: { in: ["SENT", "FAILED"] } },
    include: { sender: { select: { name: true, fromEmail: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});
