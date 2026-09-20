"use client";

import { useState } from "react";
import Papa from "papaparse";
import { api } from "@/lib/api";

const DEFAULT_SENDER_ID = process.env.NEXT_PUBLIC_DEFAULT_SENDER_ID || "";

export default function ComposeModal({
  open,
  onClose,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      let emails: string[] = [];

      if (isCsv) {
        const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
        emails = parsed.data.flat().map((s) => String(s).trim());
      } else {
        // plain text: one email per line, or comma-separated
        emails = text
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      setRecipients(emails.filter((e) => emailRegex.test(e)));
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    setError(null);

    if (!DEFAULT_SENDER_ID) {
      setError("No sender configured. Set NEXT_PUBLIC_DEFAULT_SENDER_ID in .env.local.");
      return;
    }
    if (recipients.length === 0) {
      setError("Upload a CSV/text file with at least one valid email address.");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required.");
      return;
    }
    if (!startTime) {
      setError("Pick a start time.");
      return;
    }

    setSubmitting(true);
    try {
      await api.schedule({
        senderId: DEFAULT_SENDER_ID,
        recipients,
        subject,
        body,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmailsMs: delayMs,
      });
      onScheduled();
      onClose();
      // reset
      setSubject("");
      setBody("");
      setRecipients([]);
      setFileName("");
      setStartTime("");
    } catch (err: any) {
      setError(err.message || "Failed to schedule emails.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Compose new email</h2>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)]">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Q4 product update"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Hi there, ..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Leads (CSV or text)</label>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFile}
              className="w-full text-sm text-[var(--text-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1.5 file:text-sm"
            />
            {fileName && (
              <p className="text-xs text-[var(--text-dim)] mt-1">
                {fileName} — {recipients.length} email address{recipients.length !== 1 ? "es" : ""} detected
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Start time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Delay between emails (ms)</label>
              <input
                type="number"
                min={0}
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Hourly limit</label>
            <input
              type="number"
              min={1}
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(Number(e.target.value))}
              className="w-full rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="text-xs text-[var(--text-dim)] mt-1">
              Informational — the active cap is configured per sender on the backend (Sender.maxPerHour).
            </p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium py-2.5 text-sm transition-colors"
          >
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
