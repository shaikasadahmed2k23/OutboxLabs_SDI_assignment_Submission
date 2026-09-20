const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${body}`);
  }

  return res.json();
}

export const api = {
  getScheduled: () => request<import("@/types/email").EmailJob[]>("/api/scheduled"),
  getSent: () => request<import("@/types/email").EmailJob[]>("/api/sent"),
  schedule: (payload: import("@/types/email").ScheduleRequest) =>
    request<import("@/types/email").ScheduleResponse>("/api/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  slackStatus: (senderId: string) =>
    request<{ connected: boolean; teamName: string | null }>(`/auth/slack/status/${senderId}`),
  slackDisconnect: (senderId: string) =>
    request<{ disconnected: boolean }>(`/auth/slack/${senderId}`, { method: "DELETE" }),
};

export { API_URL };
