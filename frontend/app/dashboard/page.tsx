"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import ScheduledTable from "@/components/ScheduledTable";
import SentTable from "@/components/SentTable";
import ComposeModal from "@/components/ComposeModal";
import { api } from "@/lib/api";
import { EmailJob } from "@/types/email";

type Tab = "scheduled" | "sent";

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("scheduled");
  const [scheduled, setScheduled] = useState<EmailJob[]>([]);
  const [sent, setSent] = useState<EmailJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, se] = await Promise.all([api.getScheduled(), api.getSent()]);
      setScheduled(s);
      setSent(se);
    } catch (err) {
      console.error("Failed to load dashboard data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Light polling so the dashboard reflects worker activity (sends,
    // rate-limit requeues) without a manual refresh.
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Email Scheduler</h1>
          <button
            onClick={() => setComposeOpen(true)}
            className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            + Compose New Email
          </button>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="flex border-b border-[var(--border)]">
            <TabButton active={tab === "scheduled"} onClick={() => setTab("scheduled")}>
              Scheduled Emails
              {scheduled.length > 0 && <Count n={scheduled.length} />}
            </TabButton>
            <TabButton active={tab === "sent"} onClick={() => setTab("sent")}>
              Sent Emails
              {sent.length > 0 && <Count n={sent.length} />}
            </TabButton>
          </div>

          {tab === "scheduled" ? (
            <ScheduledTable jobs={scheduled} loading={loading} />
          ) : (
            <SentTable jobs={sent} loading={loading} />
          )}
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onScheduled={load} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-brand-500 text-[var(--text)]"
          : "border-transparent text-[var(--text-dim)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="text-xs bg-[var(--surface-2)] px-1.5 py-0.5 rounded-full text-[var(--text-dim)]">
      {n}
    </span>
  );
}
