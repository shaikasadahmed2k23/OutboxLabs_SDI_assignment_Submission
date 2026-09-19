import { redisConnection } from "./redis";

/**
 * DESIGN DECISION: fixed hour-window counter in Redis, keyed by
 * `ratelimit:{senderId}:{YYYY-MM-DDTHH}`.
 *
 * Why fixed window over sliding window: the assignment asks for
 * "emails per hour", and a fixed window is trivial to reason about,
 * cheap (one INCR + one EXPIRE, O(1)), and safe across N worker
 * processes because Redis INCR is atomic — two workers incrementing
 * the same key concurrently can never both "win" the last slot.
 *
 * Trade-off: fixed windows allow a burst at the boundary (e.g. 200
 * emails at 1:59 + 200 at 2:00). Acceptable here — a sliding window
 * (sorted set of timestamps) would be more precise but heavier, and
 * isn't what the assignment is testing for. Documented in README.
 */

function currentHourWindow(date = new Date()): string {
  // e.g. "2026-09-18T14" — one bucket per calendar hour, UTC
  return date.toISOString().slice(0, 13);
}

function rateLimitKey(senderId: string, hourWindow: string): string {
  return `ratelimit:${senderId}:${hourWindow}`;
}

export interface RateLimitCheck {
  allowed: boolean;
  currentCount: number;
  cap: number;
  hourWindow: string;
}

/**
 * Atomically increments the counter for this sender's current hour
 * window and reports whether the send that triggered this call is
 * still within the cap. Called by the worker immediately before
 * attempting an SMTP send — never before, to avoid burning quota on
 * jobs that get delayed/rescheduled without actually sending.
 */
export async function checkAndIncrementRateLimit(
  senderId: string,
  cap: number
): Promise<RateLimitCheck> {
  const hourWindow = currentHourWindow();
  const key = rateLimitKey(senderId, hourWindow);

  const count = await redisConnection.incr(key);
  if (count === 1) {
    // first increment in this window — set expiry so old windows
    // clean themselves up (65 min buffer covers clock drift)
    await redisConnection.expire(key, 65 * 60);
  }

  if (count > cap) {
    // we've already incremented past the cap; this particular send
    // does NOT get to proceed. The worker is responsible for
    // decrementing back if it chooses to reschedule rather than
    // consume the slot — see worker.ts.
    return { allowed: false, currentCount: count, cap, hourWindow };
  }

  return { allowed: true, currentCount: count, cap, hourWindow };
}

/** Give back a slot we incremented but didn't end up using (job requeued). */
export async function releaseRateLimitSlot(senderId: string, hourWindow: string) {
  const key = rateLimitKey(senderId, hourWindow);
  await redisConnection.decr(key);
}

/** Ms until the current hour window rolls over — used to compute reschedule delay. */
export function msUntilNextHourWindow(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}
