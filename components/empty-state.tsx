import { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-[var(--surface-elevated)] flex items-center justify-center mb-4">
        <Icon size={20} className="text-[var(--muted)]" />
      </div>
      <h3 className="text-sm font-medium text-[var(--foreground)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--muted)] max-w-xs mb-4">{description}</p>
      {action}
    </div>
  );
}
