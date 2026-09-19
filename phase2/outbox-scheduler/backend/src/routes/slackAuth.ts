import { Router } from "express";
import { prisma } from "../lib/prisma";

export const slackAuthRouter = Router();

/**
 * DESIGN DECISION: senderId travels through OAuth's `state` param.
 *
 * Slack's OAuth flow has no concept of "which of my app's tenants is
 * connecting" — that's on us to track. We don't have a full user-auth
 * session system in this assignment's scope, so the dashboard passes
 * the currently-selected Sender's id as `state`, Slack echoes it back
 * unchanged on the callback, and we use it to know which Sender row
 * to attach the resulting token to. `state` is also Slack's documented
 * CSRF-protection mechanism, so this reuse is intentional, not a hack —
 * just be aware in a real multi-user product you'd sign/verify `state`
 * rather than trust it verbatim (out of scope for this assignment).
 */

// GET /auth/slack/authorize?senderId=<uuid>
// Dashboard's "Connect Slack" button points the browser here directly.
slackAuthRouter.get("/authorize", async (req, res) => {
  const senderId = req.query.senderId as string | undefined;
  if (!senderId) {
    return res.status(400).json({ error: "senderId query param is required" });
  }

  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) {
    return res.status(404).json({ error: `Sender ${senderId} not found` });
  }

  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID || "",
    scope: "incoming-webhook,chat:write", // incoming-webhook gets us a per-channel webhook URL directly
    redirect_uri: process.env.SLACK_REDIRECT_URI || "",
    state: senderId,
  });

  res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
});

// GET /auth/slack/callback?code=...&state=<senderId>
// Slack redirects here after the user approves the app in their workspace.
slackAuthRouter.get("/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) {
    // e.g. user clicked "Deny" — redirect back to dashboard with a flag,
    // no DB write, nothing crashes.
    return res.redirect(`${process.env.FRONTEND_URL}/settings?slack=denied`);
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state from Slack callback" });
  }

  const senderId = state;

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID || "",
      client_secret: process.env.SLACK_CLIENT_SECRET || "",
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI || "",
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    ok: boolean;
    access_token?: string;
    team?: { name?: string };
    incoming_webhook?: { url?: string; channel_id?: string };
  };

  if (!tokenData.ok) {
    console.error("[slack oauth] token exchange failed", tokenData);
    return res.redirect(`${process.env.FRONTEND_URL}/settings?slack=error`);
  }

  // incoming-webhook scope returns tokenData.incoming_webhook.url — this
  // is what lib/slack.ts posts to directly (see notifySlackRateLimitHit).
  // If you instead use chat:write with a bot token, store tokenData.access_token
  // and tokenData.incoming_webhook?.channel_id here instead, and switch
  // lib/slack.ts to call chat.postMessage with Authorization: Bearer.
  const webhookUrl = tokenData.incoming_webhook?.url;
  if (!webhookUrl) {
    console.error("[slack oauth] no incoming_webhook in response", tokenData);
    return res.redirect(`${process.env.FRONTEND_URL}/settings?slack=error`);
  }

  await prisma.slackIntegration.upsert({
    where: { senderId },
    update: {
      accessToken: webhookUrl,
      teamName: tokenData.team?.name,
      channelId: tokenData.incoming_webhook?.channel_id,
    },
    create: {
      senderId,
      accessToken: webhookUrl,
      teamName: tokenData.team?.name,
      channelId: tokenData.incoming_webhook?.channel_id,
    },
  });

  res.redirect(`${process.env.FRONTEND_URL}/settings?slack=connected`);
});

// DELETE /auth/slack/:senderId — disconnect. Rate-limit hits go back to
// silent no-op immediately (lib/slack.ts re-queries every time, no cache).
slackAuthRouter.delete("/:senderId", async (req, res) => {
  const { senderId } = req.params;
  await prisma.slackIntegration.deleteMany({ where: { senderId } });
  res.json({ disconnected: true });
});

// GET /auth/slack/status/:senderId — dashboard checks this to show
// "Connect Slack" vs "Connected to #channel" in Settings.
slackAuthRouter.get("/status/:senderId", async (req, res) => {
  const { senderId } = req.params;
  const integration = await prisma.slackIntegration.findUnique({ where: { senderId } });
  res.json({
    connected: !!integration,
    teamName: integration?.teamName ?? null,
  });
});
