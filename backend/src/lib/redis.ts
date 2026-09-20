import IORedis from "ioredis";

// BullMQ requires maxRetriesPerRequest: null on the connection it's given.
// We reuse this same connection for our rate-limit counters too, rather
// than opening a second client — one less thing to leak on restart.
//
// TLS is enabled conditionally: local Docker Redis doesn't use TLS, but
// hosted providers (Upstash, Redis Cloud, etc.) require it. Set
// REDIS_TLS=true in .env when pointing at a hosted instance.
export const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {}),
});
