import { prisma } from "./prisma";

/**
 * Sends a real Slack message the moment a sender's hourly limit is hit.
 * If the sender has no SlackIntegration row, this is a silent no-op —
 * per the spec: "rate-limit hits should simply not notify (no crash)".
 * If they connect Slack later, the very next rate-limit hit picks up
 * the new integration automatically (we re-query per call, no caching),
 * so notifications start working without a redeploy.
 */
export async function notifySlackRateLimitHit(params: {
  senderId: string;
  senderName: string;
  hourWindow: string;
  currentCount: number;
  cap: number;
}) {
  const integration = await prisma.slackIntegration.findUnique({
    where: { senderId: params.senderId },
  });

  if (!integration) return; // not connected — no-op, no crash

  const text =
    `:rotating_light: *Rate limit hit* for sender *${params.senderName}*\n` +
    `Window: ${params.hourWindow} — ${params.currentCount}/${params.cap} emails sent this hour.\n` +
    `Remaining jobs are being rescheduled into the next window.`;

  // Slack incoming-webhook style payload. If using a bot token + chat.postMessage
  // instead, swap this fetch for a call to https://slack.com/api/chat.postMessage
  // with Authorization: Bearer ${integration.accessToken} and channel: integration.channelId.
  const res = await fetch(integration.accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    // Don't throw — a failed Slack notification should never fail the
    // underlying rate-limit handling. Just log for now.
    console.error("[slack] notification failed", await res.text());
  }
}
