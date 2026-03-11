import { useEffect, useState, useCallback } from 'react';

interface QueueItem {
  id: number;
  task_id: string;
  feature_id: string;
  project_id: string;
  task_desc: string;
  project_name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  started_at: number | null;
  completed_at: number | null;
  output: string;
  commit_sha: string;
  error: string;
  created_at: number;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function elapsed(start: number, end?: number | null): string {
  const s = (end ?? Math.floor(Date.now() / 1000)) - start;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

const statusConfig = {
  running: { label: 'Running', dot: 'bg-amber-400 animate-pulse', badge: 'bg-amber-400/15 text-amber-400 ring-amber-400/30' },
  pending: { label: 'Queued', dot: 'bg-text-muted', badge: 'bg-text-muted/15 text-text-muted ring-text-muted/30' },
  done: { label: 'Done', dot: 'bg-emerald-400', badge: 'bg-emerald-400/15 text-emerald-400 ring-emerald-400/30' },
  failed: { label: 'Failed', dot: 'bg-red-400', badge: 'bg-red-400/15 text-red-400 ring-red-400/30' },
};

type Filter = 'all' | 'running' | 'pending' | 'done' | 'failed';

export default function AutopilotPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    try {
      const qs = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/autopilot/queue${qs}`);
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  async function retry(id: number) {
    await fetch(`/api/autopilot/queue/${id}/retry`, { method: 'POST' });
    fetchQueue();
  }

  async function remove(id: number) {
    await fetch(`/api/autopilot/queue/${id}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const running = items.filter((i) => i.status === 'running');
  const pending = items.filter((i) => i.status === 'pending');
  const done = items.filter((i) => i.status === 'done');
  const failed = items.filter((i) => i.status === 'failed');

  const filtered = filter === 'all' ? items : items.filter((i) => i.status === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-accent mb-1">Autopilot</h1>
        <p className="text-text-secondary text-sm">AI agents executing tasks autonomously</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-fade-in" style={{ animationDelay: '50ms' }}>
        {([
          { key: 'running' as const, count: running.length, color: 'text-amber-400' },
          { key: 'pending' as const, count: pending.length, color: 'text-text-muted' },
          { key: 'done' as const, count: done.length, color: 'text-emerald-400' },
          { key: 'failed' as const, count: failed.length, color: 'text-red-400' },
        ]).map(({ key, count, color }) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg border transition-all ${
              filter === key
                ? 'bg-surface-overlay border-accent'
                : 'bg-surface-raised border-border hover:border-accent/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${statusConfig[key].dot}`} />
            <span className="font-display text-xs text-text-secondary uppercase">{statusConfig[key].label}</span>
            <span className={`ml-auto font-display text-lg font-bold ${color}`}>{count}</span>
          </button>
        ))}
      </div>

      {/* Active tasks highlight */}
      {running.length > 0 && (
        <div className="animate-fade-in space-y-2" style={{ animationDelay: '100ms' }}>
          <h2 className="font-display text-sm text-amber-400 uppercase tracking-wider">Executing Now</h2>
          {running.map((item) => (
            <div key={item.id} className="bg-surface-raised border border-amber-400/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 flex-shrink-0">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium">{item.task_desc}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-text-muted text-xs">{item.project_name}</span>
                    {item.started_at && (
                      <span className="text-amber-400/70 text-xs font-mono">{elapsed(item.started_at)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task list */}
      <div className="animate-fade-in" style={{ animationDelay: '150ms' }}>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-surface-raised rounded-lg h-16 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <p className="text-sm">No tasks in queue</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((item) => {
              const cfg = statusConfig[item.status];
              const isExpanded = expandedId === item.id;
              return (
                <div key={item.id} className="bg-surface-raised rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-overlay/50 transition-colors"
                  >
                    <span className={`flex-shrink-0 w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="text-text-primary text-sm truncate flex-1">{item.task_desc}</span>
                    <span className="text-text-muted text-xs flex-shrink-0 hidden sm:block">{item.project_name}</span>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-display ring-1 ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    {item.started_at && (
                      <span className="text-text-muted text-xs font-mono flex-shrink-0">
                        {item.status === 'running' ? elapsed(item.started_at) : item.completed_at ? elapsed(item.started_at, item.completed_at) : ''}
                      </span>
                    )}
                    <span className="text-text-muted text-xs flex-shrink-0">{timeAgo(item.created_at)}</span>
                    <svg
                      className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3 border-t border-border/50">
                      <div className="pt-3 space-y-2">
                        {item.commit_sha && (
                          <div className="flex items-center gap-2">
                            <span className="text-text-muted text-xs">Commit:</span>
                            <code className="text-emerald-400 text-xs font-mono">{item.commit_sha.slice(0, 10)}</code>
                          </div>
                        )}
                        {item.error && (
                          <div className="bg-red-400/5 border border-red-400/20 rounded p-2">
                            <pre className="text-red-400 text-xs whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{item.error}</pre>
                          </div>
                        )}
                        {item.output && item.status === 'done' && (
                          <div className="bg-surface-overlay rounded p-2">
                            <pre className="text-text-secondary text-xs whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{item.output.slice(0, 1000)}</pre>
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          {item.status === 'failed' && (
                            <button
                              onClick={() => retry(item.id)}
                              className="text-xs font-display text-accent hover:text-accent/80 transition-colors"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            onClick={() => remove(item.id)}
                            className="text-xs font-display text-red-400 hover:text-red-300 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
