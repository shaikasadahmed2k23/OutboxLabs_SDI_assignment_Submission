import { Client } from "@elastic/elasticsearch";

/**
 * DESIGN DECISION: Elasticsearch is used purely as a search index, never
 * as a source of truth — Postgres stays authoritative for EmailJob state
 * (see worker.ts). ES is updated best-effort on create + on every status
 * transition; if an ES write fails, we log and continue rather than fail
 * the underlying DB operation. A search index being briefly stale is
 * acceptable; a scheduler that can't schedule because ES hiccupped is not.
 */

export const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
  requestTimeout: 3000, // fail fast — indexing is best-effort, never worth blocking the API on
  maxRetries: 0,
});
export const EMAIL_INDEX = "email_jobs";

export async function ensureEmailIndex() {
  const exists = await esClient.indices.exists({ index: EMAIL_INDEX });
  if (!exists) {
    await esClient.indices.create({
      index: EMAIL_INDEX,
      mappings: {
        properties: {
          toEmail: { type: "keyword" },
          subject: { type: "text" },
          body: { type: "text" },
          status: { type: "keyword" },
          senderId: { type: "keyword" },
          senderName: { type: "keyword" },
          scheduledFor: { type: "date" },
          sentAt: { type: "date" },
          batchId: { type: "keyword" },
        },
      },
    });
    console.log(`[elasticsearch] created index "${EMAIL_INDEX}"`);
  }
}

export async function indexEmailJob(doc: {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  senderId: string;
  senderName?: string;
  scheduledFor: Date;
  sentAt?: Date | null;
  batchId?: string | null;
}) {
  try {
    await esClient.index({
      index: EMAIL_INDEX,
      id: doc.id, // ES doc id == Postgres row id, so re-indexing on status change is an upsert, not a duplicate
      document: {
        toEmail: doc.toEmail,
        subject: doc.subject,
        body: doc.body,
        status: doc.status,
        senderId: doc.senderId,
        senderName: doc.senderName,
        scheduledFor: doc.scheduledFor,
        sentAt: doc.sentAt ?? null,
        batchId: doc.batchId ?? null,
      },
    });
  } catch (err) {
    console.error(`[elasticsearch] failed to index EmailJob ${doc.id}`, err);
  }
}

export async function searchEmailJobs(query: string) {
  const result = await esClient.search({
    index: EMAIL_INDEX,
    query: {
      multi_match: {
        query,
        fields: ["toEmail", "subject", "body"],
      },
    },
  });
  return result.hits.hits.map((hit) => ({ id: hit._id, ...(hit._source as object) }));
}
