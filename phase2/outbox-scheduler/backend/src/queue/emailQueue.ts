import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";

export const QUEUE_NAME = "email-send";

export interface EmailJobData {
  emailJobId: string; // Postgres EmailJob.id — this IS the BullMQ jobId too
  senderId: string;
}

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 3600 }, // keep 24h for dashboard/debugging
    removeOnFail: false, // keep failures visible for the dashboard
  },
});

/**
 * Schedules (or re-schedules) an email send.
 *
 * IDEMPOTENCY: jobId is always the Postgres row's own id. BullMQ
 * enforces unique jobIds per queue — calling add() twice with the
 * same emailJobId is a safe no-op on BullMQ's side, and our worker
 * additionally re-checks the DB row's status before sending. Two
 * independent guards against duplicate sends.
 */
export async function scheduleEmailJob(params: {
  emailJobId: string;
  senderId: string;
  delayMs: number;
}) {
  return emailQueue.add(
    "send",
    { emailJobId: params.emailJobId, senderId: params.senderId },
    {
      jobId: params.emailJobId,
      delay: Math.max(params.delayMs, 0),
    }
  );
}
