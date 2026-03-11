import { useEffect, useState } from 'react';
import { status } from '../lib/api';
import type { StatusData } from '../lib/types';
import StatusIndicator from '../components/StatusIndicator';

// ── Helpers ──────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function timeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - timestamp);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatCron(cron: string): string {
  return cron;
}

// ── Skeleton ─────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-surface-overlay ${className}`}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

// ── Sector badge colors ──────────────────────────────────────────

const sectorColors: Record<string, string> = {
  semantic: 'bg-blue-500/20 text-blue-400',
  episodic: 'bg-purple-500/20 text-purple-400',
  procedural: 'bg-green-500/20 text-green-400',
  preference: 'bg-amber-500/20 text-amber-400',
};

function sectorColor(sector: string): string {
  return sectorColors[sector] ?? 'bg-surface-overlay text-text-muted';
}

// ── Page ─────────────────────────────────────────────────────────

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchStatus() {
      try {
        const result = await status.get();
        if (mounted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch status');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-accent mb-1">Status</h1>
          <p className="text-text-secondary text-sm">System health, tokens, and scheduled tasks</p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-accent mb-1">Status</h1>
          <p className="text-text-secondary text-sm">System health, tokens, and scheduled tasks</p>
        </div>
        <div className="bg-surface-raised rounded-lg border border-border p-6 text-center">
          <p className="text-red-400 font-display">{error ?? 'Unable to load status'}</p>
        </div>
      </div>
    );
  }

  const tokenStats = data.token_usage_today;

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-accent mb-1">Status</h1>
        <p className="text-text-secondary text-sm">System health, tokens, and scheduled tasks</p>
      </div>

      {/* ── Status Header ────────────────────────────────────── */}
      <div
        className="animate-fade-in bg-surface-raised rounded-lg border border-border p-6 flex items-center gap-4"
        style={{ animationDelay: '50ms' }}
      >
        <StatusIndicator status={data.online ? 'online' : 'offline'} size="lg" />
        <span className={`font-display text-2xl font-bold ${data.online ? 'text-status-active' : 'text-red-400'}`}>
          {data.online ? 'Online' : 'Offline'}
        </span>
        <span className="text-text-secondary font-display text-sm ml-auto">
          Up for {formatUptime(data.uptime_seconds)}
        </span>
      </div>

      {/* ── Token Usage Today ────────────────────────────────── */}
      {tokenStats && (
        <div
          className="animate-fade-in bg-surface-raised rounded-lg border border-border p-4"
          style={{ animationDelay: '100ms' }}
        >
          <h2 className="font-display text-xs text-text-muted uppercase tracking-wider mb-3">
            Token Usage Today
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {([
              ['Turns', tokenStats.turns.toLocaleString()],
              ['Input', tokenStats.total_input.toLocaleString()],
              ['Output', tokenStats.total_output.toLocaleString()],
              ['Cache Read', tokenStats.peak_cache_read.toLocaleString()],
              ['Cost', `$${tokenStats.total_cost.toFixed(2)}`],
              ['Compactions', tokenStats.compactions.toLocaleString()],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <p className="text-text-muted text-xs font-display uppercase">{label}</p>
                <p className="text-text-primary text-lg font-display font-bold">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Scheduled Tasks ──────────────────────────────────── */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: '150ms' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-sm font-bold text-text-primary uppercase tracking-wider">
            Scheduled Tasks
          </h2>
          <span className="text-xs font-display bg-surface-overlay text-text-muted px-2 py-0.5 rounded-full">
            {data.scheduled_tasks.length}
          </span>
        </div>

        <div className="bg-surface-raised rounded-lg border border-border">
          {data.scheduled_tasks.length === 0 ? (
            <p className="text-text-muted text-sm font-display py-6 text-center">
              No scheduled tasks
            </p>
          ) : (
            data.scheduled_tasks.map((task, i) => (
              <div
                key={task.id}
                className={`flex items-center gap-3 py-3 px-4 ${
                  i < data.scheduled_tasks.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <StatusIndicator
                  status={task.status === 'active' ? 'active' : 'paused'}
                  size="sm"
                />
                <span className="flex-1 text-text-primary text-sm truncate min-w-0" title={task.prompt}>
                  {task.prompt}
                </span>
                <span className="text-text-muted text-xs font-display hidden sm:block">
                  {formatCron(task.schedule)}
                </span>
                <span className="text-text-secondary text-xs font-display hidden md:block">
                  {formatDate(task.next_run)}
                </span>
                <span className="text-text-muted text-xs font-display">
                  {task.last_run ? timeAgo(task.last_run) : 'Never'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Recent Memories ──────────────────────────────────── */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: '200ms' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-sm font-bold text-text-primary uppercase tracking-wider">
            Memories
          </h2>
          <span className="text-xs font-display bg-surface-overlay text-text-muted px-2 py-0.5 rounded-full">
            {data.recent_memories.length}
          </span>
        </div>

        {data.recent_memories.length === 0 ? (
          <div className="bg-surface-raised rounded-lg border border-border p-6 text-center">
            <p className="text-text-muted text-sm font-display">No memories stored</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.recent_memories.map((memory, i) => (
              <div
                key={memory.id}
                className="animate-fade-in bg-surface-raised rounded-lg border border-border p-3 flex flex-col gap-2"
                style={{ animationDelay: `${250 + i * 60}ms` }}
              >
                <p className="text-text-primary text-sm line-clamp-2">{memory.content}</p>
                <div className="flex items-center gap-2 mt-auto">
                  <span className={`text-xs font-display px-2 py-0.5 rounded-full ${sectorColor(memory.sector)}`}>
                    {memory.sector}
                  </span>
                  <div className="flex-1 h-1 bg-surface-overlay rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${(memory.salience / 5.0) * 100}%` }}
                    />
                  </div>
                  <span className="text-text-muted text-xs font-display">{timeAgo(memory.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent Conversation ──────────────────────────────── */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: '300ms' }}
      >
        <h2 className="font-display text-sm font-bold text-text-primary uppercase tracking-wider mb-3">
          Recent Conversation
        </h2>

        <div className="bg-surface-raised rounded-lg border border-border p-4 max-h-96 overflow-y-auto space-y-3">
          {data.recent_conversation.length === 0 ? (
            <p className="text-text-muted text-sm font-display text-center py-4">
              No recent messages
            </p>
          ) : (
            data.recent_conversation.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={i}
                  className={`${
                    isUser
                      ? 'ml-8 bg-accent/10 border border-accent/20'
                      : 'mr-8 bg-surface-overlay border border-border'
                  } rounded-lg p-3`}
                >
                  <p className="text-text-muted text-xs font-display mb-1">
                    {isUser ? 'User' : 'Assistant'}
                  </p>
                  <p className="text-text-primary text-sm line-clamp-3">{msg.content}</p>
                  <p className="text-text-muted text-xs font-display mt-1">
                    {timeAgo(msg.created_at)}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
