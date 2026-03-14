import { useEffect, useState } from 'react';

// ── Types ────────────────────────────────────────────────────

interface TokenStats {
  todayInput: number;
  todayOutput: number;
  todayCost: number;
  todayTurns: number;
  allTimeCost: number;
  allTimeTurns: number;
}

interface CostTimelinePoint {
  date: string;
  cost: number;
  turns: number;
}

interface AdvisorCost {
  role: string;
  name: string;
  calls: number;
  cost: number;
  tokens_in: number;
  tokens_out: number;
  first_call: string | null;
  last_call: string | null;
}

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string;
  running: boolean;
  todayTurns: number;
  todayCost: number;
}

interface SchedulerLog {
  id: number;
  task_id: string;
  task_prompt: string;
  status: 'success' | 'error';
  output: string;
  error: string;
  started_at: number;
  finished_at: number;
  duration_ms: number;
}

interface QueueItem {
  id: number;
  task_id: string;
  feature_id: string | null;
  project_id: string | null;
  status: string;
  output: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface HealthData {
  contextPct: number;
  turns: number;
  compactions: number;
  sessionAge: string;
  model: string;
  telegramConnected: boolean;
  waConnected: boolean;
  slackConnected: boolean;
}

interface MemoryStats {
  stats: {
    total: number;
    semantic: number;
    episodic: number;
    avgSalience: number | null;
    salienceDistribution: { bucket: string; count: number }[];
  };
  fading: { id: number; content: string; salience: number; sector: string }[];
  topAccessed: { id: number; content: string; accessed_at: number }[];
  timeline: { date: string; count: number }[];
}

// ── Helpers ──────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ── Skeleton ─────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-overlay ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function OperacionesPage() {
  const [tokens, setTokens] = useState<{ stats: TokenStats; costTimeline: CostTimelinePoint[] } | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [logs, setLogs] = useState<SchedulerLog[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [advisorCosts, setAdvisorCosts] = useState<{ advisors: AdvisorCost[]; total_cost: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchAll() {
      const results = await Promise.allSettled([
        fetch('/api/tokens').then((r) => r.json()),
        fetch('/api/agents').then((r) => r.json()),
        fetch('/api/scheduler/logs?limit=20').then((r) => r.json()),
        fetch('/api/autopilot/queue').then((r) => r.json()),
        fetch('/api/health').then((r) => r.json()),
        fetch('/api/memories').then((r) => r.json()),
        fetch('/api/advisor-costs').then((r) => r.json()),
      ]);

      if (!mounted) return;

      if (results[0].status === 'fulfilled') setTokens(results[0].value);
      if (results[1].status === 'fulfilled') setAgents(results[1].value.agents ?? []);
      if (results[2].status === 'fulfilled') setLogs(results[2].value);
      if (results[3].status === 'fulfilled') setQueue(Array.isArray(results[3].value) ? results[3].value : results[3].value.queue ?? []);
      if (results[4].status === 'fulfilled') setHealth(results[4].value);
      if (results[5].status === 'fulfilled') setMemory(results[5].value);
      if (results[6].status === 'fulfilled') setAdvisorCosts(results[6].value);
      setLoading(false);
    }

    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-accent mb-1">Operaciones</h1>
          <p className="text-text-secondary text-sm">Costos, agentes, scheduler, autopilot, sesion y memoria</p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  const stats = tokens?.stats;
  const timeline = tokens?.costTimeline ?? [];
  const maxCost = Math.max(...timeline.map((d) => d.cost), 0.001);

  const queueCounts = {
    pending: queue.filter((q) => q.status === 'pending').length,
    running: queue.filter((q) => q.status === 'running').length,
    done: queue.filter((q) => q.status === 'done').length,
    failed: queue.filter((q) => q.status === 'failed').length,
  };

  const logSuccess = logs.filter((l) => l.status === 'success').length;
  const logErrors = logs.filter((l) => l.status === 'error').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-accent mb-1">Operaciones</h1>
        <p className="text-text-secondary text-sm">Costos, agentes, scheduler, autopilot, sesion y memoria</p>
      </div>

      {/* ── Section 1: Costos y Tokens ──────────────────────── */}
      <section className="animate-fade-in" style={{ animationDelay: '50ms' }}>
        <h2 className="font-display text-xs text-text-muted uppercase tracking-wider mb-3">
          Costos y Tokens
        </h2>
        <div className="bg-surface-raised rounded-lg border border-border p-4">
          {stats ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
                {([
                  ['Costo Hoy', fmtCost(stats.todayCost), 'text-accent'],
                  ['Costo Total', fmtCost(stats.allTimeCost), 'text-text-primary'],
                  ['Turns Hoy', stats.todayTurns.toLocaleString(), 'text-text-primary'],
                  ['Turns Total', fmtNumber(stats.allTimeTurns), 'text-text-primary'],
                  ['Input Hoy', fmtNumber(stats.todayInput), 'text-blue-400'],
                  ['Output Hoy', fmtNumber(stats.todayOutput), 'text-purple-400'],
                ] as const).map(([label, value, color]) => (
                  <div key={label}>
                    <p className="text-text-muted text-xs font-display uppercase">{label}</p>
                    <p className={`text-lg font-display font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Cost timeline chart */}
              {timeline.length > 0 && (
                <div>
                  <p className="text-text-muted text-[10px] font-display uppercase tracking-wider mb-2">
                    Costo diario (ultimos {timeline.length} dias)
                  </p>
                  <div className="flex items-end gap-px h-20">
                    {timeline.map((day) => (
                      <div
                        key={day.date}
                        className="flex-1 bg-accent/60 hover:bg-accent rounded-t transition-colors relative group cursor-default"
                        style={{ height: `${Math.max((day.cost / maxCost) * 100, 2)}%` }}
                      >
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-surface-overlay border border-border rounded px-2 py-1 text-[10px] font-display text-text-primary whitespace-nowrap z-10">
                          {day.date}: {fmtCost(day.cost)} ({day.turns} turns)
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-text-muted text-sm font-display text-center py-4">Sin datos de tokens</p>
          )}
        </div>
      </section>

      {/* ── Section 1.5: Costos por Advisor ─────────────────── */}
      {advisorCosts && advisorCosts.advisors.length > 0 && (() => {
        const ADVISOR_THEME: Record<string, { color: string; glow: string; icon: string }> = {
          ceo:       { color: '#f59e0b', glow: 'rgba(245,158,11,0.35)', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
          sales:     { color: '#10b981', glow: 'rgba(16,185,129,0.35)', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
          marketing: { color: '#a78bfa', glow: 'rgba(167,139,250,0.35)', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
          architect: { color: '#22d3ee', glow: 'rgba(34,211,238,0.35)', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
        };
        const total = advisorCosts.total_cost;
        const advisors = advisorCosts.advisors;

        // SVG donut data
        const R = 54, STROKE = 12, CIRC = 2 * Math.PI * R;
        let cumulativeOffset = 0;
        const segments = advisors.map((a) => {
          const pct = total > 0 ? a.cost / total : 0;
          const len = pct * CIRC;
          const offset = cumulativeOffset;
          cumulativeOffset += len;
          return { ...a, pct, len, offset, theme: ADVISOR_THEME[a.role] ?? ADVISOR_THEME.ceo };
        });

        const maxTokens = Math.max(...advisors.map((a) => a.tokens_in + a.tokens_out), 1);

        return (
          <section className="animate-fade-in" style={{ animationDelay: '75ms' }}>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-display text-xs text-text-muted uppercase tracking-wider">
                Costos por Advisor
              </h2>
              <span className="text-xs font-display bg-surface-overlay text-text-muted px-2 py-0.5 rounded-full">
                30 dias
              </span>
            </div>

            <div className="bg-surface-raised rounded-lg border border-border p-5">
              <div className="flex flex-col lg:flex-row gap-6">

                {/* ── Left: Donut Chart ── */}
                <div className="flex flex-col items-center justify-center shrink-0">
                  <div className="relative" style={{ width: 152, height: 152 }}>
                    <svg viewBox="0 0 140 140" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                      {/* Track ring */}
                      <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-surface-overlay)" strokeWidth={STROKE} />
                      {/* Segments */}
                      {segments.map((s, i) => (
                        <circle
                          key={s.role}
                          cx="70" cy="70" r={R}
                          fill="none"
                          stroke={s.theme.color}
                          strokeWidth={STROKE}
                          strokeDasharray={`${s.len} ${CIRC - s.len}`}
                          strokeDashoffset={-s.offset}
                          strokeLinecap="round"
                          className="transition-all duration-700"
                          style={{
                            filter: `drop-shadow(0 0 6px ${s.theme.glow})`,
                            animation: `donutGrow 0.8s ease-out ${i * 0.15}s both`,
                          }}
                        />
                      ))}
                    </svg>
                    {/* Center label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-xl font-bold text-text-primary">{fmtCost(total)}</span>
                      <span className="text-[10px] font-display text-text-muted uppercase tracking-wider">Total</span>
                    </div>
                  </div>
                  {/* Legend below donut */}
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
                    {segments.map((s) => (
                      <div key={s.role} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.theme.color, boxShadow: `0 0 6px ${s.theme.glow}` }} />
                        <span className="text-[10px] font-display text-text-secondary">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Right: Advisor Breakdown Cards ── */}
                <div className="flex-1 flex flex-col gap-3 min-w-0">
                  {segments.map((s, i) => {
                    const tokenTotal = s.tokens_in + s.tokens_out;
                    const tokenPct = (tokenTotal / maxTokens) * 100;
                    const inRatio = tokenTotal > 0 ? (s.tokens_in / tokenTotal) * 100 : 50;
                    const lastCall = s.last_call ? new Date(s.last_call).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
                    const roleLabels: Record<string, string> = {
                      ceo: 'CEO Strategist', sales: 'Sales Expert', marketing: 'Marketing Expert', architect: 'Software Architect',
                    };

                    return (
                      <div
                        key={s.role}
                        className="group relative bg-surface-overlay/40 rounded-lg border border-border/60 p-4 hover:border-border-bright transition-all duration-300 overflow-hidden"
                        style={{ animationDelay: `${i * 80}ms` }}
                      >
                        {/* Subtle colored left accent */}
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ backgroundColor: s.theme.color }} />

                        <div className="flex items-start gap-4 pl-2">
                          {/* Icon */}
                          <div
                            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-shadow duration-300"
                            style={{ backgroundColor: `${s.theme.color}15`, border: `1px solid ${s.theme.color}30` }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={s.theme.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d={s.theme.icon} />
                            </svg>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-display text-sm font-bold text-text-primary">{s.name}</span>
                                <span className="text-[9px] font-display text-text-muted bg-surface-overlay px-1.5 py-0.5 rounded">
                                  {roleLabels[s.role] || s.role}
                                </span>
                              </div>
                              <div className="flex items-baseline gap-1.5">
                                <span className="font-display text-base font-bold" style={{ color: s.theme.color }}>{fmtCost(s.cost)}</span>
                                <span className="text-[10px] font-display text-text-muted">{(s.pct * 100).toFixed(0)}%</span>
                              </div>
                            </div>

                            {/* Token bar: split in/out with glow */}
                            <div className="mb-2">
                              <div className="h-2 rounded-full bg-surface-overlay overflow-hidden flex" style={{ width: `${Math.max(tokenPct, 8)}%` }}>
                                <div
                                  className="h-full transition-all duration-500"
                                  style={{
                                    width: `${inRatio}%`,
                                    backgroundColor: s.theme.color,
                                    boxShadow: `0 0 8px ${s.theme.glow}`,
                                  }}
                                />
                                <div
                                  className="h-full transition-all duration-500"
                                  style={{
                                    width: `${100 - inRatio}%`,
                                    backgroundColor: s.theme.color,
                                    opacity: 0.4,
                                  }}
                                />
                              </div>
                            </div>

                            {/* Stats row */}
                            <div className="flex items-center gap-4 text-[11px] font-display text-text-muted">
                              <span>{s.calls} llamadas</span>
                              <span className="flex items-center gap-1">
                                <span style={{ color: s.theme.color }}>{fmtNumber(s.tokens_in)}</span>
                                <span className="text-text-muted/50">in</span>
                                <span className="text-text-muted/30">/</span>
                                <span style={{ color: s.theme.color, opacity: 0.6 }}>{fmtNumber(s.tokens_out)}</span>
                                <span className="text-text-muted/50">out</span>
                              </span>
                              {lastCall && (
                                <span className="ml-auto text-text-muted/70">{lastCall}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Hover glow background */}
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-lg"
                          style={{
                            background: `radial-gradient(ellipse at 20% 50%, ${s.theme.glow.replace('0.35', '0.06')}, transparent 70%)`,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── Section 2: Estado de Agentes ────────────────────── */}
      <section className="animate-fade-in" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-xs text-text-muted uppercase tracking-wider">
            Agentes
          </h2>
          <span className="text-xs font-display bg-surface-overlay text-text-muted px-2 py-0.5 rounded-full">
            {agents.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-surface-raised rounded-lg border border-border p-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${agent.running ? 'bg-status-active' : 'bg-red-400'}`} />
                <span className="font-display text-sm font-bold text-text-primary">{agent.name}</span>
                <span className="ml-auto text-[10px] font-display bg-surface-overlay text-text-muted px-1.5 py-0.5 rounded">
                  {agent.model.replace('claude-', '').replace('-4-6', ' 4.6').replace('-4-5', ' 4.5')}
                </span>
              </div>
              {agent.description && (
                <p className="text-text-muted text-xs line-clamp-1">{agent.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs font-display text-text-secondary mt-auto">
                <span>{agent.todayTurns} turns</span>
                <span>{fmtCost(agent.todayCost)}</span>
                <span className={`ml-auto ${agent.running ? 'text-status-active' : 'text-red-400'}`}>
                  {agent.running ? 'Running' : 'Stopped'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 3: Scheduler Logs ───────────────────────── */}
      <section className="animate-fade-in" style={{ animationDelay: '150ms' }}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-xs text-text-muted uppercase tracking-wider">
            Scheduler Logs
          </h2>
          {logs.length > 0 && (
            <div className="flex items-center gap-3 text-xs font-display ml-2">
              <span className="text-status-active">{logSuccess} ok</span>
              {logErrors > 0 && <span className="text-red-400">{logErrors} err</span>}
            </div>
          )}
        </div>
        <div className="bg-surface-raised rounded-lg border border-border">
          {logs.length === 0 ? (
            <p className="text-text-muted text-sm font-display py-6 text-center">Sin logs recientes</p>
          ) : (
            <div className="divide-y divide-border">
              {logs.map((log) => {
                const isExpanded = expandedLog === log.id;
                const isError = log.status === 'error';
                return (
                  <div key={log.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                      className="w-full px-4 py-2.5 text-left hover:bg-surface-overlay/30 transition-colors flex items-center gap-3"
                    >
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-red-400' : 'bg-status-active'}`} />
                      <span className="flex-1 text-sm text-text-primary truncate min-w-0">
                        {log.task_prompt}
                      </span>
                      <span className="text-text-muted text-xs font-display shrink-0 hidden sm:block">
                        {fmtDate(log.started_at)}
                      </span>
                      <span className="text-text-muted text-[10px] font-mono bg-surface-overlay px-1.5 py-0.5 rounded shrink-0">
                        {fmtDuration(log.duration_ms)}
                      </span>
                      <svg
                        width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                        className={`text-text-muted transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      >
                        <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border px-4 py-3">
                        <pre className={`text-xs rounded-lg p-3 border whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto font-mono ${
                          isError
                            ? 'text-red-300 bg-red-500/5 border-red-500/10'
                            : 'text-text-secondary bg-surface-overlay/50 border-border/50'
                        }`}>
                          {isError ? (log.error || 'Sin detalle') : (log.output || 'Sin output')}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: Autopilot Queue ──────────────────────── */}
      <section className="animate-fade-in" style={{ animationDelay: '200ms' }}>
        <h2 className="font-display text-xs text-text-muted uppercase tracking-wider mb-3">
          Autopilot Queue
        </h2>
        <div className="bg-surface-raised rounded-lg border border-border p-4">
          <div className="flex items-center gap-3 mb-3">
            {([
              ['Pending', queueCounts.pending, 'bg-amber-500/20 text-amber-400'],
              ['Running', queueCounts.running, 'bg-blue-500/20 text-blue-400'],
              ['Done', queueCounts.done, 'bg-green-500/20 text-green-400'],
              ['Failed', queueCounts.failed, 'bg-red-500/20 text-red-400'],
            ] as const).map(([label, count, colors]) => (
              <span key={label} className={`text-xs font-display px-2.5 py-1 rounded-full ${colors}`}>
                {label}: {count}
              </span>
            ))}
          </div>
          {queue.length === 0 ? (
            <p className="text-text-muted text-sm font-display text-center py-2">Cola vacia</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {queue.slice(0, 10).map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.status === 'done' ? 'bg-green-400' :
                    item.status === 'running' ? 'bg-blue-400' :
                    item.status === 'failed' ? 'bg-red-400' :
                    'bg-amber-400'
                  }`} />
                  <span className="text-text-primary truncate flex-1 min-w-0">
                    {item.task_id}
                  </span>
                  <span className="text-text-muted text-xs font-display shrink-0">{item.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 5: Session Health ───────────────────────── */}
      <section className="animate-fade-in" style={{ animationDelay: '250ms' }}>
        <h2 className="font-display text-xs text-text-muted uppercase tracking-wider mb-3">
          Sesion y Conexiones
        </h2>
        <div className="bg-surface-raised rounded-lg border border-border p-4">
          {health ? (
            <>
              {/* Context bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-text-secondary text-xs font-display">Context Window</span>
                  <span className="text-text-primary text-sm font-display font-bold">{health.contextPct}%</span>
                </div>
                <div className="h-2 bg-surface-overlay rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      health.contextPct > 80 ? 'bg-red-400' :
                      health.contextPct > 50 ? 'bg-amber-400' :
                      'bg-accent'
                    }`}
                    style={{ width: `${Math.min(health.contextPct, 100)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                {([
                  ['Turns', health.turns.toString()],
                  ['Compactaciones', health.compactions.toString()],
                  ['Sesion', health.sessionAge],
                  ['Modelo', health.model.replace('claude-', '').replace('-4-6', ' 4.6')],
                ] as const).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-text-muted text-xs font-display uppercase">{label}</p>
                    <p className="text-text-primary text-sm font-display font-bold">{value}</p>
                  </div>
                ))}
              </div>

              {/* Connections */}
              <div className="flex items-center gap-4">
                {([
                  ['Telegram', health.telegramConnected],
                  ['WhatsApp', health.waConnected],
                  ['Slack', health.slackConnected],
                ] as const).map(([name, connected]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-status-active' : 'bg-red-400'}`} />
                    <span className="text-xs font-display text-text-secondary">{name}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-text-muted text-sm font-display text-center py-4">Sin datos de sesion</p>
          )}
        </div>
      </section>

      {/* ── Section 6: Memoria ──────────────────────────────── */}
      <section className="animate-fade-in" style={{ animationDelay: '300ms' }}>
        <h2 className="font-display text-xs text-text-muted uppercase tracking-wider mb-3">
          Memoria
        </h2>
        <div className="bg-surface-raised rounded-lg border border-border p-4">
          {memory?.stats ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-text-muted text-xs font-display uppercase">Total</p>
                  <p className="text-text-primary text-lg font-display font-bold">{memory.stats.total}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs font-display uppercase">Semantic</p>
                  <p className="text-blue-400 text-lg font-display font-bold">{memory.stats.semantic}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs font-display uppercase">Episodic</p>
                  <p className="text-purple-400 text-lg font-display font-bold">{memory.stats.episodic}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs font-display uppercase">Avg Salience</p>
                  <p className="text-text-primary text-lg font-display font-bold">
                    {memory.stats.avgSalience != null ? memory.stats.avgSalience.toFixed(1) : '-'}
                  </p>
                </div>
              </div>

              {/* Salience distribution */}
              {memory.stats.salienceDistribution.length > 0 && (
                <div>
                  <p className="text-text-muted text-[10px] font-display uppercase tracking-wider mb-2">
                    Distribucion de salience
                  </p>
                  <div className="space-y-1.5">
                    {memory.stats.salienceDistribution.map((b) => {
                      const maxCount = Math.max(...memory.stats.salienceDistribution.map((d) => d.count), 1);
                      return (
                        <div key={b.bucket} className="flex items-center gap-2">
                          <span className="text-text-muted text-[10px] font-mono w-10 shrink-0">{b.bucket}</span>
                          <div className="flex-1 h-3 bg-surface-overlay rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent/60 rounded-full"
                              style={{ width: `${(b.count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-text-muted text-[10px] font-display w-6 text-right">{b.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Fading memories count */}
              {memory.fading.length > 0 && (
                <p className="text-amber-400 text-xs font-display mt-3">
                  {memory.fading.length} memorias con salience baja (riesgo de olvido)
                </p>
              )}
            </>
          ) : (
            <p className="text-text-muted text-sm font-display text-center py-4">Sin datos de memoria</p>
          )}
        </div>
      </section>
    </div>
  );
}
