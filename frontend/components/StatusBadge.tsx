import { EmailStatus } from "@/types/email";

const STYLES: Record<EmailStatus, string> = {
  PENDING: "bg-slate-500/15 text-slate-300",
  QUEUED: "bg-blue-500/15 text-blue-300",
  SENT: "bg-emerald-500/15 text-emerald-300",
  FAILED: "bg-red-500/15 text-red-300",
  RATE_LIMITED: "bg-amber-500/15 text-amber-300",
};

export default function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}
