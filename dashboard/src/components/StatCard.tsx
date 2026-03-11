interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  delay?: number;
}

export default function StatCard({ icon, label, value, delay = 0 }: StatCardProps) {
  return (
    <div
      className="animate-fade-in theme-card bg-surface-raised p-5 transition-all duration-200"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3">{icon}</div>
      <p className="text-text-secondary text-sm font-body mb-1">{label}</p>
      <p className="font-display text-3xl font-bold text-text-primary">{value}</p>
    </div>
  );
}
