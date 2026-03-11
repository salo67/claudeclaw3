interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'active' | 'paused';
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-2 w-2',
  md: 'h-3 w-3',
  lg: 'h-4 w-4',
};

const colorMap = {
  online: 'bg-status-active',
  active: 'bg-status-active',
  paused: 'bg-status-paused',
  offline: 'bg-red-500',
};

export default function StatusIndicator({ status, size = 'md' }: StatusIndicatorProps) {
  const sizeClass = sizeMap[size];
  const colorClass = colorMap[status];
  const shouldPulse = status === 'online' || status === 'active';

  return (
    <span className={`relative flex ${sizeClass}`}>
      {shouldPulse && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colorClass} opacity-75`}
        />
      )}
      <span className={`relative inline-flex rounded-full ${sizeClass} ${colorClass}`} />
    </span>
  );
}
