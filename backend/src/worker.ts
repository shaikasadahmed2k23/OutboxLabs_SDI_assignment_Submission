import "dotenv/config";
import { Worker, Job } from "bullmq";
import { redisConnection } from "./lib/redis";
import { prisma } from "./lib/prisma";
import { sendEmail } from "./lib/mailer";
import {
  checkAndIncrementRateLimit,
  releaseRateLimitSlot,
  msUntilNextHourWindow,
} from "./lib/rateLimiter";
import { notifySlackRateLimitHit } from "./lib/slack";
import { indexEmailJob } from "./lib/elasticsearch";
import { QUEUE_NAME, EmailJobData, scheduleEmailJob } from "./queue/emailQueue";

const MIN_DELAY_BETWEEN_SENDS_MS = Number(process.env.MIN_DELAY_BETWEEN_SENDS_MS) || 2000;
const DEFAULT_MAX_PER_HOUR = Number(process.env.MAX_EMAILS_PER_HOUR) || 200;

// Enforces "minimum delay between individual email sends" per worker
// slot. A concurrency of N means N sends can be in-flight together,
// each internally still respecting this floor before its own SMTP call.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processEmailJob(job: Job<EmailJobData>) {
  const { emailJobId, senderId } = job.data;

  // ── Idempotency guard #1: re-check DB state before doing anything ──
  const row = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { sender: true },
  });

  if (!row) {
    console.warn(`[worker] EmailJob ${emailJobId} not found — skipping (deleted?)`);
    return;
  }

  if (row.status === "SENT") {
    // Already sent in a previous run (e.g. BullMQ redelivered after a
    // crash between "send succeeded" and "ack"). Do NOT resend.
    console.log(`[worker] ${emailJobId} already SENT — skipping duplicate delivery`);
    return;
  }

  await prisma.emailJob.update({
    where: { id: emailJobId },
    data: { status: "QUEUED" },
  });

  // ── Rate limit check (Redis, atomic, safe across worker instances) ──
  const cap = row.sender.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
  const check = await checkAndIncrementRateLimit(senderId, cap);

  if (!check.allowed) {
    // Give back the slot we just consumed — we're not sending.
    await releaseRateLimitSlot(senderId, check.hourWindow);

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: "RATE_LIMITED" },
    });

    await prisma.rateLimitEvent.create({
      data: {
        senderId,
        hourWindow: check.hourWindow,
        emailsInWindow: check.currentCount,
        cap: check.cap,
      },
    });

    await notifySlackRateLimitHit({
      senderId,
      senderName: row.sender.name,
      hourWindow: check.hourWindow,
      currentCount: check.currentCount,
      cap: check.cap,
    });

    // Reschedule into the next hour window. Re-using scheduleEmailJob
    // with the SAME emailJobId means BullMQ's unique-jobId guarantee
    // still protects us — but since this job instance is currently
    // "active", we let it complete normally and add() creates the
    // next attempt fresh once this run finishes (see finally-style
    // flow below via explicit re-add after status reset).
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: "PENDING" },
    });
    await scheduleEmailJob({
      emailJobId,
      senderId,
      delayMs: msUntilNextHourWindow(),
    });

    console.log(
      `[worker] ${emailJobId} rate-limited (${check.currentCount}/${check.cap}) — requeued for next hour window`
    );
    return;
  }

  // ── Throttle: minimum delay between sends ──
  await sleep(MIN_DELAY_BETWEEN_SENDS_MS);

  // ── Actually send ──
  try {
    const { messageId, previewUrl } = await sendEmail({
      fromEmail: row.sender.fromEmail,
      toEmail: row.toEmail,
      subject: row.subject,
      body: row.body,
    });

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    // Fire-and-forget — see schedule.ts for reasoning
    indexEmailJob({
      id: row.id,
      toEmail: row.toEmail,
      subject: row.subject,
      body: row.body,
      status: "SENT",
      senderId: row.senderId,
      senderName: row.sender.name,
      scheduledFor: row.scheduledFor,
      sentAt: new Date(),
      batchId: row.batchId,
    });

    console.log(`[worker] SENT ${emailJobId} → ${row.toEmail} (${messageId}) preview: ${previewUrl}`);
  } catch (err: any) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastError: String(err?.message ?? err),
      },
    });

    // Fire-and-forget — see schedule.ts for reasoning
    indexEmailJob({
      id: row.id,
      toEmail: row.toEmail,
      subject: row.subject,
      body: row.body,
      status: "FAILED",
      senderId: row.senderId,
      senderName: row.sender.name,
      scheduledFor: row.scheduledFor,
      batchId: row.batchId,
    });

    // Re-throw so BullMQ applies its own retry/backoff on top.
    throw err;
  }
}

const worker = new Worker<EmailJobData>(QUEUE_NAME, processEmailJob, {
  connection: redisConnection,
  concurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
});

worker.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));
worker.on("failed", (job, err) =>
  console.error(`[worker] job ${job?.id} failed:`, err.message)
);

console.log("[worker] started, concurrency =", process.env.WORKER_CONCURRENCY || 5);

// ─────────────────────────────────────────────────────────────
// RESTART RECOVERY
//
// BullMQ + Redis already persist delayed jobs across restarts —
// that's the whole point of using it over cron. On boot we do one
// extra sanity sweep: any EmailJob row stuck in QUEUED (meaning
// the process died mid-send, between "mark QUEUED" and "mark
// SENT/FAILED") gets its BullMQ job re-verified. If BullMQ has no
// record of it anymore, we re-add it so it isn't silently lost.
// ─────────────────────────────────────────────────────────────
async function recoverStuckJobs() {
  const stuck = await prisma.emailJob.findMany({
    where: { status: "QUEUED" },
  });

  for (const row of stuck) {
    const existing = row.bullJobId ? await job_getById(row.bullJobId) : null;
    if (!existing) {
      await prisma.emailJob.update({ where: { id: row.id }, data: { status: "PENDING" } });
      await scheduleEmailJob({ emailJobId: row.id, senderId: row.senderId, delayMs: 0 });
      console.log(`[worker] recovered stuck job ${row.id} after restart`);
    }
  }
}

async function job_getById(bullJobId: string) {
  const { emailQueue } = await import("./queue/emailQueue");
  return emailQueue.getJob(bullJobId);
}

recoverStuckJobs().catch((e) => console.error("[worker] recovery sweep failed", e));
