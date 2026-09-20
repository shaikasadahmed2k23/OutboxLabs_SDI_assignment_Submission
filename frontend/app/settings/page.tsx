"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import { api, API_URL } from "@/lib/api";

const DEFAULT_SENDER_ID = process.env.NEXT_PUBLIC_DEFAULT_SENDER_ID || "";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const slackParam = searchParams.get("slack");

  const [connected, setConnected] = useState<boolean | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    if (!DEFAULT_SENDER_ID) {
      setLoading(false);
      return;
    }
    try {
      const status = await api.slackStatus(DEFAULT_SENDER_ID);
      setConnected(status.connected);
      setTeamName(status.teamName);
    } catch (err) {
      console.error("Failed to load Slack status", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect() {
    if (!DEFAULT_SENDER_ID) return;
    await api.slackDisconnect(DEFAULT_SENDER_ID);
    loadStatus();
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-semibold">Settings</h1>

        {slackParam === "connected" && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm px-4 py-3">
            Slack connected successfully.
          </div>
        )}
        {slackParam === "denied" && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm px-4 py-3">
            Slack authorization was cancelled.
          </div>
        )}
        {slackParam === "error" && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-3">
            Something went wrong connecting Slack. Please try again.
          </div>
        )}

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-medium mb-1">Slack notifications</h2>
          <p className="text-sm text-[var(--text-dim)] mb-4">
            Get notified the moment a sender&apos;s hourly rate limit is hit.
          </p>

          {loading ? (
            <div className="h-9 w-32 rounded-lg bg-[var(--surface-2)] animate-pulse" />
          ) : connected ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-emerald-400">
                ✓ Connected{teamName ? ` to ${teamName}` : ""}
              </span>
              <button
                onClick={handleDisconnect}
                className="text-sm text-[var(--text-dim)] hover:text-red-400 border border-[var(--border)] rounded-lg px-3 py-1.5 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <a
              href={`${API_URL}/auth/slack/authorize?senderId=${DEFAULT_SENDER_ID}`}
              className="inline-block rounded-lg bg-[#4A154B] hover:opacity-90 text-white text-sm font-medium px-4 py-2 transition-opacity"
            >
              Connect Slack
            </a>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-medium mb-1">Queue dashboard</h2>
          <p className="text-sm text-[var(--text-dim)] mb-4">
            Live BullMQ queue visibility — scheduled, active, and completed jobs in real time.
          </p>
          <a
            href={`${API_URL}/admin/queues`}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-lg border border-[var(--border)] hover:bg-[var(--surface-2)] text-sm font-medium px-4 py-2 transition-colors"
          >
            Open Bull Board ↗
          </a>
        </section>
      </main>
    </div>
  );
}
