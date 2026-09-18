import "dotenv/config";
import express from "express";
import cors from "cors";
import { scheduleRouter } from "./routes/schedule";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "5mb" })); // headroom for CSV-derived recipient lists

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", scheduleRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
