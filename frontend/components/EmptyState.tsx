export default function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-12 w-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center mb-4 text-xl">
        📭
      </div>
      <p className="font-medium">{title}</p>
      {subtitle && <p className="text-sm text-[var(--text-dim)] mt-1">{subtitle}</p>}
    </div>
  );
}
