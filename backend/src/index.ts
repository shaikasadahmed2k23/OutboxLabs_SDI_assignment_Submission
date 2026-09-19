import "dotenv/config";
import express from "express";
import cors from "cors";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { scheduleRouter } from "./routes/schedule";
import { slackAuthRouter } from "./routes/slackAuth";
import { emailQueue } from "./queue/emailQueue";
import { ensureEmailIndex } from "./lib/elasticsearch";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "5mb" })); // headroom for CSV-derived recipient lists

// ── Live BullMQ dashboard (spec requirement: "real-time queue visibility") ──
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});
app.use("/admin/queues", serverAdapter.getRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", scheduleRouter);
app.use("/auth/slack", slackAuthRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});

ensureEmailIndex().catch((err) =>
  console.error("[elasticsearch] failed to ensure index on boot (ES may not be running yet)", err.message)
);
