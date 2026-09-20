import { EmailJob } from "@/types/email";
import StatusBadge from "./StatusBadge";
import EmptyState from "./EmptyState";
import LoadingRows from "./LoadingRows";

export default function ScheduledTable({
  jobs,
  loading,
}: {
  jobs: EmailJob[];
  loading: boolean;
}) {
  if (loading) return <LoadingRows />;
  if (jobs.length === 0)
    return <EmptyState title="No scheduled emails" subtitle="Compose one to see it here." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--text-dim)] border-b border-[var(--border)]">
            <th className="py-3 px-4 font-medium">Email</th>
            <th className="py-3 px-4 font-medium">Subject</th>
            <th className="py-3 px-4 font-medium">Scheduled time</th>
            <th className="py-3 px-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b border-[var(--border)] last:border-0">
              <td className="py-3 px-4">{job.toEmail}</td>
              <td className="py-3 px-4 text-[var(--text-dim)]">{job.subject}</td>
              <td className="py-3 px-4 text-[var(--text-dim)]">
                {new Date(job.scheduledFor).toLocaleString()}
              </td>
              <td className="py-3 px-4">
                <StatusBadge status={job.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
