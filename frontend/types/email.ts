export type EmailStatus = "PENDING" | "QUEUED" | "SENT" | "FAILED" | "RATE_LIMITED";

export interface EmailJob {
  id: string;
  senderId: string;
  toEmail: string;
  subject: string;
  body: string;
  scheduledFor: string;
  status: EmailStatus;
  bullJobId: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  batchId: string | null;
  sender: {
    name: string;
    fromEmail: string;
  };
}

export interface ScheduleRequest {
  senderId: string;
  recipients: string[];
  subject: string;
  body: string;
  startTime: string;
  delayBetweenEmailsMs: number;
  batchId?: string;
}

export interface ScheduleResponse {
  batchId: string;
  scheduled: number;
  emailJobIds: string[];
}
