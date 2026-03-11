import { useState, useEffect, useCallback } from 'react';

type Tab = 'tasks' | 'logs';

interface ScheduledTask {
  id: string;
  prompt: string;
  schedule: string;
  next_run: number;
  last_run: number | null;
  last_result: string | null;
  status: string;
  created_at: number;
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

const CRON_PRESETS = [
  { label: 'Diario 9am', cron: '0 9 * * *' },
  { label: 'Lun-Vie 8am', cron: '0 8 * * 1-5' },
  { label: 'Cada lunes 9am', cron: '0 9 * * 1' },
  { label: 'Domingo 6pm', cron: '0 18 * * 0' },
  { label: 'Cada 4 horas', cron: '0 */4 * * *' },
  { label: 'Cada hora', cron: '0 * * * *' },
];

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fmtRelative(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'vencido';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export default function SchedulerPage() {
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [logs, setLogs] = useState<SchedulerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPrompt, setNewPrompt] = useState('');
  const [newCron, setNewCron] = useState('0 9 * * *');
  const [creating, setCreating] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('');

  async function loadTasks() {
    try {
      const res = await fetch('/api/scheduler/tasks');
      if (res.ok) setTasks(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const loadLogs = useCallback(async (taskId?: string) => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (taskId) params.set('task_id', taskId);
      const res = await fetch(`/api/scheduler/logs?${params}`);
      if (res.ok) setLogs(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, []);

  useEffect(() => {
    if (tab === 'logs') loadLogs(logFilter || undefined);
  }, [tab, logFilter, loadLogs]);

  async function handleCreate() {
    if (!newPrompt.trim() || !newCron.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/scheduler/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt.trim(), schedule: newCron.trim() }),
      });
      if (res.ok) {
        setNewPrompt('');
        setNewCron('0 9 * * *');
        setShowCreate(false);
        loadTasks();
      }
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(task: ScheduledTask) {
    const action = task.status === 'active' ? 'pause' : 'resume';
    await fetch(`/api/scheduler/tasks/${task.id}/${action}`, { method: 'POST' });
    loadTasks();
  }

  async function deleteTask(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, { method: 'DELETE' });
    loadTasks();
  }

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'tasks', label: 'Tareas' },
    { key: 'logs', label: 'Logs' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6 animate-fade-in">
        <h1 className="font-display text-2xl text-accent">Scheduler</h1>
        <div className="flex items-center gap-3">
          {/* Tab toggle */}
          <div className="flex gap-1 bg-surface-raised rounded-lg p-1 border border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 rounded-md text-sm font-display font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'tasks' && (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="bg-accent text-surface rounded-md px-4 py-2 font-display font-semibold text-sm hover:bg-accent/90 transition-colors"
            >
              {showCreate ? 'Cancelar' : 'Nueva Tarea'}
            </button>
          )}
        </div>
      </div>

      {tab === 'tasks' && (
        <>
          {/* Create form */}
          {showCreate && (
            <div className="animate-fade-in theme-card bg-surface-raised p-5 mb-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Prompt</label>
                  <textarea
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder="Que quieres que haga el bot..."
                    rows={3}
                    className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Cron</label>
                  <input
                    type="text"
                    value={newCron}
                    onChange={(e) => setNewCron(e.target.value)}
                    placeholder="0 9 * * *"
                    className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary focus:outline-none focus:border-border-bright transition-colors font-mono text-sm"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {CRON_PRESETS.map((p) => (
                      <button
                        type="button"
                        key={p.cron}
                        onClick={() => setNewCron(p.cron)}
                        className={`text-xs px-2 py-1 rounded-md font-display transition-colors ${
                          newCron === p.cron
                            ? 'bg-accent text-surface'
                            : 'bg-surface-overlay text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newPrompt.trim() || creating}
                  className="bg-accent text-surface rounded-md px-4 py-2 font-display font-semibold text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </div>
          )}

          {/* Stats */}
          {!loading && (
            <div className="grid grid-cols-3 gap-3 mb-6 animate-fade-in" style={{ animationDelay: '50ms' }}>
              <div className="theme-card bg-surface-raised p-4">
                <p className="text-text-muted text-xs font-display mb-1">Total</p>
                <p className="font-display text-2xl font-bold text-text-primary">{tasks.length}</p>
              </div>
              <div className="theme-card bg-surface-raised p-4">
                <p className="text-text-muted text-xs font-display mb-1">Activas</p>
                <p className="font-display text-2xl font-bold text-status-active">{activeTasks.length}</p>
              </div>
              <div className="theme-card bg-surface-raised p-4">
                <p className="text-text-muted text-xs font-display mb-1">Pausadas</p>
                <p className="font-display text-2xl font-bold text-status-paused">{pausedTasks.length}</p>
              </div>
            </div>
          )}

          {/* Task list */}
          {loading ? (
            <div className="text-text-muted text-center py-20 font-display text-sm">Cargando...</div>
          ) : tasks.length === 0 ? (
            <div className="text-text-muted text-center py-20 font-display text-sm">
              No hay tareas programadas.
            </div>
          ) : (
            <div className="space-y-3 animate-fade-in" style={{ animationDelay: '100ms' }}>
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="theme-card bg-surface-raised p-4 flex items-start gap-4"
                >
                  {/* Status indicator */}
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                    task.status === 'active' ? 'bg-status-active' : 'bg-status-paused'
                  }`} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm mb-1 line-clamp-2">{task.prompt}</p>
                    <div className="flex items-center gap-3 text-xs text-text-muted font-display">
                      <span className="font-mono bg-surface-overlay px-1.5 py-0.5 rounded">{task.schedule}</span>
                      <span>Siguiente: {fmtRelative(task.next_run)}</span>
                      {task.last_run && <span>Ultima: {fmtDate(task.last_run)}</span>}
                    </div>
                    {task.last_result && (
                      <p className="text-xs text-text-muted mt-1 line-clamp-1 opacity-60">{task.last_result}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setLogFilter(task.id); setTab('logs'); }}
                      title="Ver logs"
                      className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-surface-overlay transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M16 13H8M16 17H8M10 9H8" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStatus(task)}
                      title={task.status === 'active' ? 'Pausar' : 'Reanudar'}
                      className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
                    >
                      {task.status === 'active' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5,3 19,12 5,21" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTask(task.id)}
                      title="Eliminar"
                      className="p-1.5 rounded-md text-text-muted hover:text-red-400 hover:bg-surface-overlay transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'logs' && (
        <LogsView
          logs={logs}
          loading={logsLoading}
          tasks={tasks}
          filter={logFilter}
          setFilter={setLogFilter}
          onRefresh={() => loadLogs(logFilter || undefined)}
        />
      )}
    </div>
  );
}

/* ─── Logs View ────────────────────────────────────────────── */

function LogsView({
  logs,
  loading,
  tasks,
  filter,
  setFilter,
  onRefresh,
}: {
  logs: SchedulerLog[];
  loading: boolean;
  tasks: ScheduledTask[];
  filter: string;
  setFilter: (f: string) => void;
  onRefresh: () => void;
}) {
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const successCount = logs.filter((l) => l.status === 'success').length;
  const errorCount = logs.filter((l) => l.status === 'error').length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Log stats + filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              title="Filtrar por tarea"
              className="bg-surface-raised border border-border rounded-lg px-3 py-1.5 text-sm text-text-secondary font-display"
            >
              <option value="">Todas las tareas</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.prompt.slice(0, 50)}{t.prompt.length > 50 ? '...' : ''}
                </option>
              ))}
            </select>
          </div>
          {logs.length > 0 && (
            <div className="flex items-center gap-3 text-xs font-display">
              <span className="text-status-active">{successCount} exitosos</span>
              {errorCount > 0 && <span className="text-red-400">{errorCount} fallidos</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg border border-border text-sm font-display font-medium text-text-secondary hover:text-text-primary hover:border-border-bright transition-colors"
        >
          Actualizar
        </button>
      </div>

      {/* Log entries */}
      {loading ? (
        <div className="text-text-muted text-center py-20 font-display text-sm">Cargando logs...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-3 text-text-muted/30">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <p className="text-text-muted text-sm font-display">
            {filter ? 'No hay logs para esta tarea' : 'No hay logs de ejecucion todavia'}
          </p>
          <p className="text-text-muted/60 text-xs mt-1">
            Los logs aparecen cuando el scheduler ejecuta tareas automaticamente
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => {
            const isExpanded = expandedLog === log.id;
            const isError = log.status === 'error';
            return (
              <div key={log.id} className={`theme-card bg-surface-raised overflow-hidden transition-all ${isError ? 'border-red-500/20' : ''}`}>
                <button
                  type="button"
                  onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                  className="w-full p-3 text-left hover:bg-surface-overlay/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {isError ? (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-red-400">
                          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M9 6v3.5M9 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-status-active">
                          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M6.5 9l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">{log.task_prompt}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted font-display">
                        <span>{fmtDate(log.started_at)}</span>
                        <span className="font-mono bg-surface-overlay px-1.5 py-0.5 rounded text-[10px]">
                          {fmtDuration(log.duration_ms)}
                        </span>
                        <span className="font-mono text-[10px] opacity-50">{log.task_id}</span>
                      </div>
                    </div>

                    {/* Expand arrow */}
                    <svg
                      width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
                      className={`text-text-muted transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      <path d="M4 5.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3">
                    {isError ? (
                      <div>
                        <p className="text-[10px] font-display font-semibold text-red-400 uppercase tracking-wider mb-1.5">Error</p>
                        <pre className="text-xs text-red-300 bg-red-500/5 rounded-lg p-3 border border-red-500/10 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto font-mono">
                          {log.error || 'Sin detalle de error'}
                        </pre>
                      </div>
                    ) : (
                      <div>
                        <p className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider mb-1.5">Output</p>
                        <pre className="text-xs text-text-secondary bg-surface-overlay/50 rounded-lg p-3 border border-border/50 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto font-mono">
                          {log.output || 'Sin output'}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
