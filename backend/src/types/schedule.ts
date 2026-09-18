import { z } from "zod";

export const scheduleRequestSchema = z.object({
  senderId: z.string().uuid(),
  recipients: z.array(z.string().email()).min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  startTime: z.string().datetime(), // ISO string — when the FIRST email goes out
  delayBetweenEmailsMs: z.number().int().min(0).default(2000),
  batchId: z.string().optional(),
});

export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;
