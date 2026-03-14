import { useEffect, useState, useCallback } from 'react';

const API = '/mail-api';

type Tab = 'inbox' | 'threads' | 'digest' | 'rules' | 'smart-review' | 'learning';

interface Email {
  id: number;
  message_id: string;
  subject: string;
  sender: string;
  sender_name: string;
  date: string;
  source: string;
  is_read: boolean;
  category: string | null;
  urgency: string | null;
  body_text: string;
}

interface ThreadSummary {
  thread_id: string;
  subject: string;
  message_count: number;
  participant_count: number;
  latest_date: string;
  latest_snippet: string;
  participants: string[];
  is_cc_only: boolean;
}

interface DigestCategory {
  category: string;
  count: number;
  emails: Record<string, unknown>[];
}

interface Digest {
  id: number;
  generated_at: string;
  content: {
    total_emails: number;
    categories: Record<string, DigestCategory>;
    urgent_items: Record<string, unknown>[];
    time_window_hours: number;
  };
  email_count: number;
}

interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

interface RuleAction {
  type: string;
  params: Record<string, string>;
}

interface Rule {
  id: number;
  name: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  is_active: boolean;
  priority: number;
  created_at: string;
}

interface ImportantEmail {
  email_id: number;
  importance: string;
  needs_response: boolean;
  analysis: string;
  response_strategy: string;
  urgency_reason: string;
}

interface SuggestedDraft {
  draft_id: number;
  email_id: number;
  subject: string;
  sender: string;
  sender_name: string;
  reasoning: string;
  key_points: string[];
  tone: string;
  draft_text: string;
}

interface SmartReview {
  summary: string;
  total_analyzed: number;
  needs_response: number;
  important_emails: ImportantEmail[];
  suggested_drafts: SuggestedDraft[];
  hours: number;
}

interface LearnedRule {
  id: number;
  pattern_type: string;
  pattern_key: string;
  pattern_value: Record<string, unknown>;
  confidence: number;
  sample_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface LearningStats {
  total_rules: number;
  active_rules: number;
  avg_confidence: number;
  by_pattern_type: Record<string, number>;
  feedback_counts: Record<string, number>;
}

interface SenderScore {
  email: string;
  name: string;
  importance_score: number;
  email_count: number;
  read_rate: number;
  positive_signals: number;
  negative_signals: number;
}

interface Stats {
  total: number;
  unread: number;
  by_source: Record<string, number>;
  by_category: Record<string, number>;
  by_urgency: Record<string, number>;
}

interface GmailAccount {
  account_id: string;
  email: string | null;
  connected: boolean;
}

interface ConnectionStatus {
  gmail_connected: boolean;
  gmail_email: string | null;
  gmail_accounts?: GmailAccount[];
  yahoo_configured: boolean;
  last_sync: string | null;
}

const urgencyColor: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  urgent: 'bg-orange-500/20 text-orange-400',
  normal: 'bg-blue-500/20 text-blue-400',
  low: 'bg-zinc-500/20 text-zinc-400',
};

const categoryColor: Record<string, string> = {
  cotizacion: 'bg-emerald-500/20 text-emerald-400',
  proveedor: 'bg-violet-500/20 text-violet-400',
  interno: 'bg-cyan-500/20 text-cyan-400',
  cliente: 'bg-amber-500/20 text-amber-400',
  sistema: 'bg-zinc-500/20 text-zinc-400',
  newsletter: 'bg-indigo-500/20 text-indigo-400',
};

const patternTypeColor: Record<string, string> = {
  sender_importance: 'bg-emerald-500/20 text-emerald-400',
  domain_pattern: 'bg-violet-500/20 text-violet-400',
  subject_keyword: 'bg-amber-500/20 text-amber-400',
  category_override: 'bg-cyan-500/20 text-cyan-400',
  urgency_boost: 'bg-red-500/20 text-red-400',
};

const sourceIcon: Record<string, string> = {
  gmail: 'G1',
  'gmail:sales11': 'G2',
  yahoo: 'Y',
};

function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
}

export default function CorreoPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [emails, setEmails] = useState<Email[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);

  const openEmail = async (email: Email) => {
    setSelectedEmail(email); // show immediately with what we have
    try {
      const res = await fetch(`${API}/emails/${email.id}`);
      if (res.ok) {
        const full = await res.json();
        setSelectedEmail(full);
      }
    } catch { /* use list data as fallback */ }
  };
  const [smartReview, setSmartReview] = useState<SmartReview | null>(null);
  const [filter, setFilter] = useState<{ source?: string; category?: string; urgency?: string }>({});

  const fetchStats = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`${API}/emails/stats`),
        fetch(`${API}/emails/status`),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (cRes.ok) setConn(await cRes.json());
    } catch { /* offline */ }
  }, []);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('per_page', '50');
      if (filter.source) params.set('source', filter.source);
      if (filter.category) params.set('category', filter.category);
      if (filter.urgency) params.set('urgency', filter.urgency);
      const res = await fetch(`${API}/emails?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails);
      }
    } catch { /* offline */ }
    setLoading(false);
  }, [filter]);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/threads?per_page=30`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads);
      }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  const fetchDigest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/digest/latest`);
      if (res.ok) setDigest(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/rules`);
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules);
      }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (tab === 'inbox') fetchInbox();
    else if (tab === 'threads') fetchThreads();
    else if (tab === 'digest') fetchDigest();
    else if (tab === 'rules') fetchRules();
  }, [tab, fetchInbox, fetchThreads, fetchDigest, fetchRules]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch(`${API}/emails/sync`, { method: 'POST' });
      await fetchStats();
      if (tab === 'inbox') await fetchInbox();
    } catch { /* offline */ }
    setSyncing(false);
  };

  const handleGenerateDigest = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/digest/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      });
      if (res.ok) setDigest(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'threads', label: 'Hilos' },
    { key: 'digest', label: 'Digest' },
    { key: 'rules', label: 'Reglas' },
    { key: 'smart-review', label: 'Smart Review' },
    { key: 'learning', label: 'Aprendizaje' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Correo</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {conn?.gmail_accounts && conn.gmail_accounts.length > 0 ? (
              conn.gmail_accounts.map((acc, i) => (
                <span key={acc.account_id} className="inline-flex items-center gap-1.5 mr-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-active" />
                  {acc.email || acc.account_id}
                </span>
              ))
            ) : conn?.gmail_connected ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-status-active" />
                {conn.gmail_email}
              </span>
            ) : null}
            {conn?.yahoo_configured && (
              <span className="inline-flex items-center gap-1.5 ml-1">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                Yahoo
              </span>
            )}
            {!conn?.gmail_connected && !conn?.yahoo_configured && (
              <span className="text-text-muted">Sin conexiones configuradas</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-display font-medium hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {syncing ? 'Sincronizando...' : 'Sync'}
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-2xl font-display font-bold text-text-primary">{stats.total}</div>
            <div className="text-xs text-text-muted mt-0.5">Total</div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-2xl font-display font-bold text-accent">{stats.unread}</div>
            <div className="text-xs text-text-muted mt-0.5">No leidos</div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-2xl font-display font-bold text-text-primary">
              {stats.by_urgency?.critical || 0}
            </div>
            <div className="text-xs text-red-400 mt-0.5">Criticos</div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-2xl font-display font-bold text-text-primary">
              {conn?.last_sync ? relativeTime(conn.last_sync) : '--'}
            </div>
            <div className="text-xs text-text-muted mt-0.5">Ultimo sync</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-raised rounded-lg p-1 border border-border w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setSelectedEmail(null); }}
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

      {/* Content */}
      {tab === 'inbox' && (
        <InboxView
          emails={emails}
          loading={loading}
          filter={filter}
          setFilter={setFilter}
          selectedEmail={selectedEmail}
          onSelectEmail={openEmail}
          onClose={() => setSelectedEmail(null)}
          stats={stats}
        />
      )}
      {tab === 'threads' && <ThreadsView threads={threads} loading={loading} />}
      {tab === 'digest' && (
        <DigestView digest={digest} loading={loading} onGenerate={handleGenerateDigest} />
      )}
      {tab === 'rules' && (
        <RulesView rules={rules} loading={loading} onRefresh={fetchRules} />
      )}
      {tab === 'smart-review' && (
        <SmartReviewView review={smartReview} loading={loading} setReview={setSmartReview} setLoading={setLoading} />
      )}
      {tab === 'learning' && <LearningView />}
    </div>
  );
}

/* ─── Smart Review ───────────────────────────────────────────── */

function SmartReviewView({ review, loading, setReview, setLoading }: {
  review: SmartReview | null;
  loading: boolean;
  setReview: (r: SmartReview | null) => void;
  setLoading: (l: boolean) => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [hours, setHours] = useState(24);
  const [expandedDraft, setExpandedDraft] = useState<number | null>(null);
  const [sendingDraft, setSendingDraft] = useState<number | null>(null);
  const [discardedDrafts, setDiscardedDrafts] = useState<Set<number>>(new Set());

  const runReview = async () => {
    setAnalyzing(true);
    setLoading(true);
    try {
      const res = await fetch(`${API}/smart-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours, max_emails: 30 }),
      });
      if (res.ok) setReview(await res.json());
    } catch { /* offline */ }
    setAnalyzing(false);
    setLoading(false);
  };

  const handleSend = async (draftId: number) => {
    if (!confirm('Enviar este borrador?')) return;
    setSendingDraft(draftId);
    try {
      await fetch(`${API}/drafts/${draftId}/send`, { method: 'POST' });
    } catch { /* */ }
    setSendingDraft(null);
  };

  const handleDiscard = async (draftId: number) => {
    try {
      await fetch(`${API}/drafts/${draftId}`, { method: 'DELETE' });
      setDiscardedDrafts(new Set([...discardedDrafts, draftId]));
    } catch { /* */ }
  };

  const importanceBadge: Record<string, string> = {
    alta: 'bg-red-500/15 text-red-400 border-red-500/30',
    media: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    baja: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  };

  const toneBadge: Record<string, string> = {
    formal: 'bg-blue-500/15 text-blue-400',
    'semi-formal': 'bg-violet-500/15 text-violet-400',
    cordial: 'bg-green-500/15 text-green-400',
  };

  // Initial state - no review yet
  if (!review) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="text-5xl mb-4 opacity-60">🧠</div>
          <h3 className="text-lg font-display font-bold text-text-primary mb-2">Smart Review</h3>
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-6">
            Analiza tus correos importantes, genera un resumen ejecutivo y sugiere respuestas inteligentes con contexto y estrategia.
          </p>
          <div className="flex items-center gap-3 justify-center mb-6">
            <label className="text-xs text-text-muted font-display">Analizar ultimas</label>
            <select value={hours} onChange={e => setHours(Number(e.target.value))}
              className="bg-surface-raised border border-border rounded-lg px-3 py-1.5 text-sm text-text-secondary font-display">
              <option value={6}>6 horas</option>
              <option value={12}>12 horas</option>
              <option value={24}>24 horas</option>
              <option value={48}>48 horas</option>
              <option value={72}>72 horas</option>
            </select>
          </div>
          <button type="button" onClick={runReview} disabled={analyzing}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-accent to-violet-500 text-white text-sm font-display font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-accent/25">
            {analyzing ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analizando correos...
              </span>
            ) : '🧠 Analizar Inbox'}
          </button>
        </div>
      </div>
    );
  }

  // Review results
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary flex items-center gap-2">
            🧠 Smart Review
            <span className="text-[10px] bg-surface-overlay text-text-muted rounded-full px-2 py-0.5 font-normal">
              {review.total_analyzed} correos
            </span>
          </h2>
        </div>
        <button type="button" onClick={runReview} disabled={analyzing}
          className="px-4 py-1.5 rounded-lg bg-accent/10 text-accent text-sm font-display font-medium hover:bg-accent/20 transition-colors disabled:opacity-50">
          {analyzing ? 'Analizando...' : '↻ Re-analizar'}
        </button>
      </div>

      {/* Executive summary */}
      <div className="bg-gradient-to-br from-accent/5 to-violet-500/5 rounded-2xl border border-accent/20 p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📊</span>
          <div>
            <h3 className="text-sm font-display font-semibold text-text-primary mb-1">Resumen Ejecutivo</h3>
            <p className="text-sm text-text-secondary leading-relaxed">{review.summary}</p>
            <div className="flex gap-4 mt-3">
              <span className="text-xs text-text-muted">
                <span className="font-semibold text-text-primary">{review.total_analyzed}</span> analizados
              </span>
              <span className="text-xs text-text-muted">
                <span className="font-semibold text-amber-400">{review.important_emails.length}</span> importantes
              </span>
              <span className="text-xs text-text-muted">
                <span className="font-semibold text-green-400">{review.needs_response}</span> con respuesta sugerida
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Important emails */}
      {review.important_emails.length > 0 && (
        <div>
          <h3 className="text-sm font-display font-semibold text-text-muted uppercase tracking-wider mb-3">
            Correos Importantes
          </h3>
          <div className="space-y-2">
            {review.important_emails.map((item, idx) => (
              <div key={idx} className="bg-surface-raised rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${importanceBadge[item.importance] || importanceBadge.baja}`}>
                    {item.importance.toUpperCase()}
                  </span>
                  {item.needs_response && (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-green-500/15 text-green-400 border border-green-500/30 font-medium">
                      Necesita respuesta
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted ml-auto">ID: {item.email_id}</span>
                </div>
                <p className="text-sm text-text-primary leading-relaxed">{item.analysis}</p>
                {item.response_strategy && (
                  <p className="text-xs text-text-secondary mt-2 pl-3 border-l-2 border-accent/30">
                    <span className="font-semibold text-accent">Estrategia:</span> {item.response_strategy}
                  </p>
                )}
                {item.urgency_reason && (
                  <p className="text-[11px] text-text-muted mt-1.5">{item.urgency_reason}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested drafts */}
      {review.suggested_drafts.length > 0 && (
        <div>
          <h3 className="text-sm font-display font-semibold text-text-muted uppercase tracking-wider mb-3">
            Respuestas Sugeridas
          </h3>
          <div className="space-y-3">
            {review.suggested_drafts.filter(d => !discardedDrafts.has(d.draft_id)).map((draft) => {
              const isExpanded = expandedDraft === draft.draft_id;
              return (
                <div key={draft.draft_id} className="bg-surface-raised rounded-xl border border-border overflow-hidden">
                  {/* Draft header */}
                  <button type="button" onClick={() => setExpandedDraft(isExpanded ? null : draft.draft_id)}
                    className="w-full p-4 text-left hover:bg-surface-overlay/50 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg">💬</span>
                        <span className="text-sm font-display font-medium text-text-primary truncate">
                          Re: {draft.subject}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted flex-shrink-0 ml-2">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <span>→ {draft.sender_name || draft.sender}</span>
                      {draft.tone && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${toneBadge[draft.tone] || 'bg-zinc-500/15 text-zinc-400'}`}>
                          {draft.tone}
                        </span>
                      )}
                    </div>
                    {/* Reasoning preview */}
                    {!isExpanded && draft.reasoning && (
                      <p className="text-[11px] text-text-muted mt-2 line-clamp-1">{draft.reasoning}</p>
                    )}
                  </button>

                  {/* Expanded draft content */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {/* Reasoning */}
                      <div className="px-4 py-3 bg-surface-overlay/30">
                        <p className="text-xs text-text-secondary">
                          <span className="font-semibold text-accent">Razonamiento:</span> {draft.reasoning}
                        </p>
                        {draft.key_points.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {draft.key_points.map((kp, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                                {kp}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Draft text */}
                      <div className="px-4 py-4">
                        <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans leading-relaxed bg-surface-overlay/50 rounded-lg p-4 border border-border/50">
                          {draft.draft_text}
                        </pre>
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end gap-2 px-4 pb-4">
                        <button type="button" onClick={() => handleDiscard(draft.draft_id)}
                          className="px-3 py-1.5 rounded-lg border border-border text-sm font-display font-medium text-text-secondary hover:text-red-400 hover:border-red-400/30 transition-colors">
                          Descartar
                        </button>
                        <button type="button" onClick={() => handleSend(draft.draft_id)}
                          disabled={sendingDraft === draft.draft_id}
                          className="px-4 py-1.5 rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 text-sm font-display font-medium hover:bg-green-500/25 transition-colors disabled:opacity-50">
                          {sendingDraft === draft.draft_id ? 'Enviando...' : '📨 Enviar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No important emails */}
      {review.important_emails.length === 0 && (
        <div className="text-center py-8">
          <div className="text-3xl mb-2 opacity-40">✅</div>
          <p className="text-sm text-text-muted">No hay correos que requieran atencion inmediata</p>
        </div>
      )}
    </div>
  );
}

/* ─── Inbox ──────────────────────────────────────────────────── */

function InboxView({
  emails,
  loading,
  filter,
  setFilter,
  selectedEmail,
  onSelectEmail,
  onClose,
  stats,
}: {
  emails: Email[];
  loading: boolean;
  filter: { source?: string; category?: string; urgency?: string };
  setFilter: (f: { source?: string; category?: string; urgency?: string }) => void;
  selectedEmail: Email | null;
  onSelectEmail: (e: Email) => void;
  onClose: () => void;
  stats: Stats | null;
}) {
  const categories = stats ? Object.keys(stats.by_category) : [];
  const [feedbackSent, setFeedbackSent] = useState<Record<number, boolean>>({});

  const handleFeedback = async (emailId: number, type: string) => {
    try {
      await fetch(`${API}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_id: emailId, feedback_type: type }),
      });
      setFeedbackSent(prev => ({ ...prev, [emailId]: true }));
    } catch { /* ignore */ }
  };

  return (
    <div className="flex gap-4">
      {/* Email list */}
      <div className={`flex-1 space-y-2 ${selectedEmail ? 'hidden sm:block sm:max-w-md' : ''}`}>
        {/* Filters */}
        <div className="flex gap-2 flex-wrap mb-3">
          <select
            value={filter.source || ''}
            onChange={(e) => setFilter({ ...filter, source: e.target.value || undefined })}
            className="bg-surface-raised border border-border rounded-lg px-3 py-1.5 text-sm text-text-secondary font-display"
          >
            <option value="">Todas las fuentes</option>
            <option value="gmail">Gmail (principal)</option>
            {stats?.by_source && Object.keys(stats.by_source).filter(s => s.startsWith('gmail:')).map(s => (
              <option key={s} value={s}>Gmail ({s.split(':')[1]})</option>
            ))}
            <option value="yahoo">Yahoo</option>
          </select>
          <select
            value={filter.category || ''}
            onChange={(e) => setFilter({ ...filter, category: e.target.value || undefined })}
            className="bg-surface-raised border border-border rounded-lg px-3 py-1.5 text-sm text-text-secondary font-display"
          >
            <option value="">Todas las categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={filter.urgency || ''}
            onChange={(e) => setFilter({ ...filter, urgency: e.target.value || undefined })}
            className="bg-surface-raised border border-border rounded-lg px-3 py-1.5 text-sm text-text-secondary font-display"
          >
            <option value="">Toda urgencia</option>
            <option value="critical">Critico</option>
            <option value="urgent">Urgente</option>
            <option value="normal">Normal</option>
            <option value="low">Bajo</option>
          </select>
        </div>

        {loading && emails.length === 0 && (
          <div className="text-center py-12 text-text-muted text-sm">Cargando...</div>
        )}
        {!loading && emails.length === 0 && (
          <div className="text-center py-12 text-text-muted text-sm">
            No hay correos. Haz sync para obtener nuevos.
          </div>
        )}

        {emails.map((email) => (
          <button
            key={email.id}
            type="button"
            onClick={() => onSelectEmail(email)}
            className={`w-full text-left p-3 rounded-xl border transition-colors ${
              selectedEmail?.id === email.id
                ? 'bg-accent/10 border-accent/30'
                : 'bg-surface-raised border-border hover:border-border-hover'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {!email.is_read && (
                    <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                  )}
                  <span className="text-[10px] font-bold text-text-muted bg-surface-overlay rounded px-1.5 py-0.5">
                    {sourceIcon[email.source] || email.source}
                  </span>
                  <span className="text-sm font-display font-medium text-text-primary truncate">
                    {email.sender_name || email.sender}
                  </span>
                </div>
                <div className="text-sm text-text-secondary truncate mt-0.5">
                  {email.subject || '(sin asunto)'}
                </div>
              </div>
              <span className="text-xs text-text-muted flex-shrink-0">
                {relativeTime(email.date)}
              </span>
            </div>
            <div className="flex gap-1.5 mt-2">
              {email.category && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${categoryColor[email.category] || 'bg-zinc-500/20 text-zinc-400'}`}>
                  {email.category}
                </span>
              )}
              {email.urgency && email.urgency !== 'normal' && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${urgencyColor[email.urgency] || ''}`}>
                  {email.urgency}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Email detail */}
      {selectedEmail && (
        <div className="flex-1 bg-surface-raised rounded-xl border border-border p-5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="sm:hidden text-xs text-accent mb-3"
          >
            &larr; Volver
          </button>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-text-muted bg-surface-overlay rounded px-1.5 py-0.5">
              {sourceIcon[selectedEmail.source] || selectedEmail.source}
            </span>
            {selectedEmail.category && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${categoryColor[selectedEmail.category] || 'bg-zinc-500/20 text-zinc-400'}`}>
                {selectedEmail.category}
              </span>
            )}
            {selectedEmail.urgency && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${urgencyColor[selectedEmail.urgency] || ''}`}>
                {selectedEmail.urgency}
              </span>
            )}
          </div>
          <h2 className="text-lg font-display font-bold text-text-primary mb-1">
            {selectedEmail.subject || '(sin asunto)'}
          </h2>
          <div className="text-sm text-text-secondary mb-1">
            {selectedEmail.sender_name || selectedEmail.sender}
            {selectedEmail.sender_name && (
              <span className="text-text-muted ml-1">&lt;{selectedEmail.sender}&gt;</span>
            )}
          </div>
          <div className="text-xs text-text-muted mb-4">
            {new Date(selectedEmail.date).toLocaleString('es-MX')}
          </div>
          {/* Feedback */}
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
            <span className="text-xs text-text-muted">Importancia:</span>
            <button
              type="button"
              onClick={() => handleFeedback(selectedEmail.id, 'marked_important')}
              className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-text-muted hover:text-emerald-400 transition-colors"
              title="Importante"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M1 8.998a1 1 0 0 1 1-1h3v10H2a1 1 0 0 1-1-1v-8Zm5 9.236V7.665l3.272-5.927A.5.5 0 0 1 9.71 1.5a2.5 2.5 0 0 1 2.5 2.5c0 .652-.13 1.274-.363 1.84L10.96 8h5.54a2.5 2.5 0 0 1 2.425 3.11l-1.5 6A2.5 2.5 0 0 1 15 19H6.234Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleFeedback(selectedEmail.id, 'marked_unimportant')}
              className="p-1.5 rounded-lg hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
              title="No importante"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M19 11.002a1 1 0 0 1-1 1h-3v-10h2a1 1 0 0 1 1 1v8Zm-5-9.236v10.57l-3.272 5.926a.5.5 0 0 1-.438.238 2.5 2.5 0 0 1-2.5-2.5c0-.652.13-1.274.363-1.84l.887-2.162H3.5A2.5 2.5 0 0 1 1.075 9.89l1.5-6A2.5 2.5 0 0 1 5 1.002h8.766Z" />
              </svg>
            </button>
            {feedbackSent[selectedEmail.id] && (
              <span className="text-xs text-emerald-400 ml-1">Guardado</span>
            )}
          </div>
          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto">
            {selectedEmail.body_text || '(sin contenido)'}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Threads ────────────────────────────────────────────────── */

function ThreadsView({ threads, loading }: { threads: ThreadSummary[]; loading: boolean }) {
  if (loading && threads.length === 0) {
    return <div className="text-center py-12 text-text-muted text-sm">Cargando hilos...</div>;
  }
  if (!loading && threads.length === 0) {
    return <div className="text-center py-12 text-text-muted text-sm">No hay hilos.</div>;
  }

  return (
    <div className="space-y-2">
      {threads.map((t) => (
        <div
          key={t.thread_id}
          className="bg-surface-raised rounded-xl border border-border p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-display font-medium text-text-primary truncate">
                  {t.subject || '(sin asunto)'}
                </span>
                <span className="text-[10px] bg-surface-overlay text-text-muted rounded-full px-2 py-0.5 flex-shrink-0">
                  {t.message_count} msgs
                </span>
              </div>
              <div className="text-xs text-text-muted mt-1 truncate">
                {t.participants.slice(0, 3).join(', ')}
                {t.participants.length > 3 && ` +${t.participants.length - 3}`}
              </div>
              <div className="text-xs text-text-secondary mt-1 truncate">
                {t.latest_snippet}
              </div>
            </div>
            <div className="text-xs text-text-muted flex-shrink-0">
              {relativeTime(t.latest_date)}
            </div>
          </div>
          {t.is_cc_only && (
            <span className="text-[10px] mt-2 inline-block bg-zinc-500/20 text-zinc-400 rounded-full px-2 py-0.5">
              CC only
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Digest ─────────────────────────────────────────────────── */

function DigestView({
  digest,
  loading,
  onGenerate,
}: {
  digest: Digest | null;
  loading: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Resumen de correo</h2>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-accent/10 text-accent text-sm font-display font-medium hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Generando...' : 'Generar digest'}
        </button>
      </div>

      {!digest && !loading && (
        <div className="text-center py-12 text-text-muted text-sm">
          No hay digest disponible. Genera uno para ver el resumen.
        </div>
      )}

      {digest && (
        <div className="space-y-4">
          <div className="bg-surface-raised rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-muted">
                {new Date(digest.generated_at).toLocaleString('es-MX')}
              </span>
              <span className="text-sm font-display font-medium text-text-secondary">
                {digest.email_count} correos en {digest.content.time_window_hours}h
              </span>
            </div>

            {/* Urgent items */}
            {digest.content.urgent_items.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-display font-semibold text-red-400 mb-2">
                  Urgentes ({digest.content.urgent_items.length})
                </h3>
                <div className="space-y-1">
                  {digest.content.urgent_items.map((item, i) => (
                    <div key={i} className="text-sm text-text-secondary bg-red-500/5 rounded-lg p-2">
                      {(item as Record<string, string>).subject || JSON.stringify(item)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Categories */}
            <div className="space-y-3">
              {Object.entries(digest.content.categories).map(([key, cat]) => (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${categoryColor[key] || 'bg-zinc-500/20 text-zinc-400'}`}>
                      {key}
                    </span>
                    <span className="text-xs text-text-muted">{cat.count} correos</span>
                  </div>
                  <div className="space-y-1">
                    {cat.emails.slice(0, 5).map((e, i) => (
                      <div key={i} className="text-xs text-text-secondary pl-3 truncate">
                        {(e as Record<string, string>).subject || (e as Record<string, string>).sender || JSON.stringify(e)}
                      </div>
                    ))}
                    {cat.emails.length > 5 && (
                      <div className="text-xs text-text-muted pl-3">
                        +{cat.emails.length - 5} mas
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Rules ──────────────────────────────────────────────────── */

const FIELD_LABELS: Record<string, string> = {
  sender: 'Remitente', subject: 'Asunto', category: 'Categoria',
  urgency: 'Urgencia', source: 'Fuente', has_attachment: 'Adjunto',
};

const OP_LABELS: Record<string, string> = {
  equals: 'es', contains: 'contiene', starts_with: 'empieza con',
  not_equals: 'no es', above: 'al menos',
};

const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  send_alert: { label: 'Alerta Telegram', icon: '🔔' },
  create_task: { label: 'Crear tarea', icon: '✅' },
  create_calendar_event: { label: 'Crear evento', icon: '📅' },
  tag_email: { label: 'Etiquetar', icon: '🏷' },
  mark_as_read: { label: 'Marcar leido', icon: '📨' },
  run_cotizador: { label: 'Cotizador', icon: '💰' },
};

const FIELDS = ['sender', 'subject', 'category', 'urgency', 'source'];
const OPS_BY_FIELD: Record<string, string[]> = {
  sender: ['contains', 'equals', 'not_equals'],
  subject: ['contains', 'starts_with', 'equals'],
  category: ['equals', 'not_equals'],
  urgency: ['equals', 'above', 'not_equals'],
  source: ['equals', 'not_equals'],
};
const VALUE_OPTIONS: Record<string, string[]> = {
  category: ['cotizacion', 'proveedor', 'cliente', 'interno', 'newsletter', 'urgente', 'personal', 'otro'],
  urgency: ['critical', 'high', 'medium', 'low'],
  source: ['*', 'gmail', 'gmail:sales11', 'yahoo'],
};
const ACTION_TYPES = Object.keys(ACTION_LABELS);

function RulesView({ rules, loading, onRefresh }: { rules: Rule[]; loading: boolean; onRefresh: () => void }) {
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [priority, setPriority] = useState(100);
  const [conditions, setConditions] = useState<RuleCondition[]>([{ field: 'sender', operator: 'contains', value: '' }]);
  const [ruleActions, setRuleActions] = useState<RuleAction[]>([{ type: 'send_alert', params: { message: '' } }]);

  const openCreate = () => {
    setEditingRule(null);
    setName('');
    setPriority(100);
    setConditions([{ field: 'sender', operator: 'contains', value: '' }]);
    setRuleActions([{ type: 'send_alert', params: { message: '' } }]);
    setShowModal(true);
  };

  const openEdit = (rule: Rule) => {
    setEditingRule(rule);
    setName(rule.name);
    setPriority(rule.priority);
    setConditions(rule.conditions.length > 0 ? rule.conditions.map(c => ({ ...c })) : [{ field: 'sender', operator: 'contains', value: '' }]);
    setRuleActions(rule.actions.length > 0 ? rule.actions.map(a => ({ ...a, params: { ...a.params } })) : [{ type: 'send_alert', params: { message: '' } }]);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const body = { name, priority, conditions: conditions.filter(c => c.value.trim() && c.value !== '*'), actions: ruleActions };
    try {
      if (editingRule) {
        await fetch(`${API}/rules/${editingRule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, is_active: true }) });
      } else {
        await fetch(`${API}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      setShowModal(false);
      onRefresh();
    } catch { /* */ }
    setSaving(false);
  };

  const handleToggle = async (rule: Rule) => {
    await fetch(`${API}/rules/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !rule.is_active }) });
    onRefresh();
  };

  const handleDelete = async (rule: Rule) => {
    if (!confirm(`Eliminar "${rule.name}"?`)) return;
    await fetch(`${API}/rules/${rule.id}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleEvaluate = async () => {
    setSaving(true);
    await fetch(`${API}/rules/evaluate`, { method: 'POST' });
    setSaving(false);
  };

  const updateCondField = (idx: number, field: string) => {
    const updated = [...conditions];
    const ops = OPS_BY_FIELD[field] || ['equals'];
    updated[idx] = { field, operator: ops[0], value: '' };
    setConditions(updated);
  };

  const getParamKey = (type: string) => {
    if (type === 'send_alert') return 'message';
    if (type === 'create_task' || type === 'create_calendar_event') return 'title';
    if (type === 'tag_email') return 'category';
    return '';
  };

  if (loading && rules.length === 0) {
    return <div className="text-center py-12 text-text-muted text-sm">Cargando reglas...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-bold text-text-primary">Reglas de correo</h2>
          {rules.length > 0 && (
            <span className="text-[10px] bg-surface-overlay text-text-muted rounded-full px-2 py-0.5">{rules.length}</span>
          )}
        </div>
        <div className="flex gap-2">
          {rules.length > 0 && (
            <button type="button" onClick={handleEvaluate} disabled={saving} className="px-3 py-1.5 rounded-lg border border-border text-sm font-display font-medium text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors disabled:opacity-50">
              {saving ? 'Ejecutando...' : '▶ Ejecutar'}
            </button>
          )}
          <button type="button" onClick={openCreate} className="px-4 py-1.5 rounded-lg bg-accent/10 text-accent text-sm font-display font-medium hover:bg-accent/20 transition-colors">
            + Nueva regla
          </button>
        </div>
      </div>

      {rules.length === 0 && !loading && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3 opacity-40">⚙️</div>
          <h3 className="text-sm font-display font-semibold text-text-secondary mb-1">Sin reglas configuradas</h3>
          <p className="text-xs text-text-muted max-w-sm mx-auto mb-4">
            Las reglas automatizan acciones sobre tus correos. Notifica por Telegram, crea tareas, o etiqueta automaticamente.
          </p>
          <button type="button" onClick={openCreate} className="px-4 py-1.5 rounded-lg bg-accent/10 text-accent text-sm font-display font-medium hover:bg-accent/20 transition-colors">
            + Crear primera regla
          </button>
        </div>
      )}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className={`bg-surface-raised rounded-xl border border-border p-4 transition-opacity ${!rule.is_active ? 'opacity-40' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-text-muted bg-surface-overlay rounded px-1.5 py-0.5 min-w-[24px] text-center">{rule.priority}</span>
              <span className="text-sm font-display font-medium text-text-primary flex-1 truncate">{rule.name}</span>
              <button type="button" onClick={() => handleToggle(rule)} className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${rule.is_active ? 'bg-green-500' : 'bg-zinc-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${rule.is_active ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <button type="button" onClick={() => openEdit(rule)} className="text-text-muted hover:text-text-primary text-xs px-1.5 py-1 rounded transition-colors" title="Editar">✏️</button>
              <button type="button" onClick={() => handleDelete(rule)} className="text-text-muted hover:text-red-400 text-xs px-1.5 py-1 rounded transition-colors" title="Eliminar">🗑</button>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider">SI</span>
              {rule.conditions.map((c, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                  {FIELD_LABELS[c.field] || c.field} <span className="opacity-60">{OP_LABELS[c.operator] || c.operator}</span> {c.value === '*' ? 'Cualquiera' : c.value}
                </span>
              ))}
              {rule.conditions.length === 0 && <span className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">todos</span>}
              <span className="text-text-muted text-xs">→</span>
              <span className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider">ENTONCES</span>
              {rule.actions.map((a, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                  {ACTION_LABELS[a.type]?.icon} {ACTION_LABELS[a.type]?.label || a.type}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface-raised rounded-2xl border border-border w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-display font-bold text-text-primary">{editingRule ? 'Editar regla' : 'Nueva regla'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-text-muted hover:text-text-primary text-lg">✕</button>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <label className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Nombre</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Alertar cotizaciones urgentes"
                  className="w-full bg-surface-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Prioridad <span className="font-normal">(menor = primero)</span></label>
                <input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} min={1} max={999}
                  className="w-20 bg-surface-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary text-center font-mono focus:outline-none focus:border-accent" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">Condiciones <span className="text-[9px] bg-surface-overlay rounded px-1.5 py-0.5 normal-case">AND</span></span>
                  <button type="button" onClick={() => setConditions([...conditions, { field: 'sender', operator: 'contains', value: '' }])} className="text-xs text-accent font-display font-medium">+ Agregar</button>
                </div>
                <div className="space-y-2">
                  {conditions.map((c, idx) => (
                    <div key={idx} className="flex gap-1.5 items-center bg-surface-overlay rounded-lg p-2 border border-border/50">
                      <select value={c.field} onChange={e => updateCondField(idx, e.target.value)} className="bg-transparent border border-border rounded-md px-2 py-1 text-xs text-text-secondary font-display min-w-[90px]">
                        {FIELDS.map(f => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                      </select>
                      <select value={c.operator} onChange={e => { const u = [...conditions]; u[idx] = { ...u[idx], operator: e.target.value }; setConditions(u); }} className="bg-transparent border border-border rounded-md px-2 py-1 text-xs text-text-secondary font-display min-w-[90px]">
                        {(OPS_BY_FIELD[c.field] || ['equals']).map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
                      </select>
                      {VALUE_OPTIONS[c.field] ? (
                        <select value={c.value} onChange={e => { const u = [...conditions]; u[idx] = { ...u[idx], value: e.target.value }; setConditions(u); }} className="bg-transparent border border-border rounded-md px-2 py-1 text-xs text-text-secondary font-display flex-1">
                          <option value="">Seleccionar...</option>
                          {VALUE_OPTIONS[c.field].map(v => <option key={v} value={v}>{v === '*' ? 'Cualquiera' : v}</option>)}
                        </select>
                      ) : (
                        <input type="text" value={c.value} onChange={e => { const u = [...conditions]; u[idx] = { ...u[idx], value: e.target.value }; setConditions(u); }} placeholder="Valor..."
                          className="bg-transparent border border-border rounded-md px-2 py-1 text-xs text-text-primary flex-1 focus:outline-none focus:border-accent" />
                      )}
                      {conditions.length > 1 && <button type="button" onClick={() => setConditions(conditions.filter((_, i) => i !== idx))} className="text-text-muted hover:text-red-400 text-xs px-1">✕</button>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider">Acciones</span>
                  <button type="button" onClick={() => setRuleActions([...ruleActions, { type: 'send_alert', params: { message: '' } }])} className="text-xs text-accent font-display font-medium">+ Agregar</button>
                </div>
                <div className="space-y-2">
                  {ruleActions.map((a, idx) => {
                    const pk = getParamKey(a.type);
                    return (
                      <div key={idx} className="flex gap-1.5 items-center bg-surface-overlay rounded-lg p-2 border border-border/50">
                        <select value={a.type} onChange={e => { const u = [...ruleActions]; const npk = getParamKey(e.target.value); u[idx] = { type: e.target.value, params: npk ? { [npk]: '' } : {} }; setRuleActions(u); }}
                          className="bg-transparent border border-border rounded-md px-2 py-1 text-xs text-text-secondary font-display min-w-[140px]">
                          {ACTION_TYPES.map(t => <option key={t} value={t}>{ACTION_LABELS[t]?.icon} {ACTION_LABELS[t]?.label}</option>)}
                        </select>
                        {pk && <input type="text" value={a.params[pk] || ''} onChange={e => { const u = [...ruleActions]; u[idx] = { ...u[idx], params: { [pk]: e.target.value } }; setRuleActions(u); }}
                          placeholder={pk === 'message' ? 'Mensaje de alerta...' : pk === 'title' ? 'Titulo...' : 'Valor...'}
                          className="bg-transparent border border-border rounded-md px-2 py-1 text-xs text-text-primary flex-1 focus:outline-none focus:border-accent" />}
                        {ruleActions.length > 1 && <button type="button" onClick={() => setRuleActions(ruleActions.filter((_, i) => i !== idx))} className="text-text-muted hover:text-red-400 text-xs px-1">✕</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-1.5 rounded-lg border border-border text-sm font-display font-medium text-text-secondary hover:text-text-primary transition-colors">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="px-5 py-1.5 rounded-lg bg-accent text-white text-sm font-display font-medium hover:bg-accent/90 transition-colors disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- Learning ----------------------------------------------------------- */

function LearningView() {
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
  const [senderScores, setSenderScores] = useState<SenderScore[]>([]);
  const [learnedRules, setLearnedRules] = useState<LearnedRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningLearning, setRunningLearning] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, scoresRes, rulesRes] = await Promise.all([
        fetch(`${API}/learning/stats`),
        fetch(`${API}/learning/sender-scores`),
        fetch(`${API}/learning/rules`),
      ]);
      if (statsRes.ok) setLearningStats(await statsRes.json());
      if (scoresRes.ok) {
        const data = await scoresRes.json();
        setSenderScores(Array.isArray(data) ? data : data.scores || []);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setLearnedRules(Array.isArray(data) ? data : data.rules || []);
      }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runLearning = async () => {
    setRunningLearning(true);
    try {
      await fetch(`${API}/learning/run`, { method: 'POST' });
      await fetchAll();
    } catch { /* offline */ }
    setRunningLearning(false);
  };

  const toggleRule = async (rule: LearnedRule) => {
    try {
      await fetch(`${API}/learning/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      setLearnedRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: !r.is_active } : r));
    } catch { /* offline */ }
  };

  const deleteRule = async (ruleId: number) => {
    try {
      await fetch(`${API}/learning/rules/${ruleId}`, { method: 'DELETE' });
      setLearnedRules(prev => prev.filter(r => r.id !== ruleId));
    } catch { /* offline */ }
  };

  const scoreColor = (score: number) => {
    if (score >= 0.7) return 'bg-emerald-500';
    if (score >= 0.4) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const feedbackTotal = learningStats
    ? Object.values(learningStats.feedback_counts).reduce((a, b) => a + b, 0)
    : 0;

  if (loading) {
    return <div className="text-center py-12 text-text-muted text-sm">Cargando aprendizaje...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Aprendizaje</h2>
        <button
          type="button"
          onClick={runLearning}
          disabled={runningLearning}
          className="px-4 py-1.5 rounded-lg bg-accent/10 text-accent text-sm font-display font-medium hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {runningLearning ? 'Ejecutando...' : 'Ejecutar Aprendizaje'}
        </button>
      </div>

      {/* Stats cards */}
      {learningStats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-2xl font-display font-bold text-text-primary">{learningStats.total_rules}</div>
            <div className="text-xs text-text-muted mt-0.5">{learningStats.active_rules} activas</div>
            <div className="text-xs text-text-secondary mt-1">Reglas aprendidas</div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className={`text-2xl font-display font-bold ${learningStats.avg_confidence >= 0.7 ? 'text-emerald-400' : learningStats.avg_confidence >= 0.4 ? 'text-amber-400' : 'text-red-400'}`}>
              {(learningStats.avg_confidence * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-text-muted mt-0.5">Confianza promedio</div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-2xl font-display font-bold text-text-primary">{feedbackTotal}</div>
            <div className="text-xs text-text-muted mt-0.5">
              {Object.entries(learningStats.feedback_counts).map(([k, v]) => `${k}: ${v}`).join(', ') || 'Sin feedback'}
            </div>
            <div className="text-xs text-text-secondary mt-1">Senales feedback</div>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Sender Scores - left */}
        <div className="lg:col-span-3 space-y-3">
          <h3 className="text-sm font-display font-semibold text-text-muted uppercase tracking-wider">
            Sender Scores
          </h3>
          {senderScores.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-sm">Sin datos de remitentes todavia.</div>
          ) : (
            <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider px-4 py-2.5">Remitente</th>
                    <th className="text-left text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider px-4 py-2.5">Score</th>
                    <th className="text-center text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider px-4 py-2.5">Emails</th>
                    <th className="text-center text-[10px] font-display font-semibold text-text-muted uppercase tracking-wider px-4 py-2.5">Read Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {senderScores.map((s) => (
                    <tr key={s.email} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="text-sm text-text-primary truncate max-w-[200px]">{s.name || s.email}</div>
                        {s.name && <div className="text-[10px] text-text-muted truncate max-w-[200px]">{s.email}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-surface-overlay rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreColor(s.importance_score)}`} style={{ width: `${Math.min(s.importance_score * 100, 100)}%` }} />
                          </div>
                          <span className="text-xs text-text-secondary font-mono">{s.importance_score.toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-text-secondary">{s.email_count}</td>
                      <td className="px-4 py-2.5 text-center text-xs text-text-secondary">{(s.read_rate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Learned Rules - right */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-display font-semibold text-text-muted uppercase tracking-wider">
            Reglas Aprendidas
          </h3>
          {learnedRules.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-sm">Sin reglas aprendidas todavia.</div>
          ) : (
            <div className="space-y-2">
              {learnedRules.map((rule) => (
                <div key={rule.id} className={`bg-surface-raised rounded-xl border border-border p-4 transition-opacity ${!rule.is_active ? 'opacity-40' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${patternTypeColor[rule.pattern_type] || 'bg-zinc-500/20 text-zinc-400'}`}>
                      {rule.pattern_type}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleRule(rule)}
                        title={rule.is_active ? 'Desactivar regla' : 'Activar regla'}
                        className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${rule.is_active ? 'bg-green-500' : 'bg-zinc-600'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${rule.is_active ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRule(rule.id)}
                        className="text-text-muted hover:text-red-400 text-xs px-1.5 py-1 rounded transition-colors"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="text-sm font-display font-medium text-text-primary mb-2">{rule.pattern_key}</div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${scoreColor(rule.confidence)}`} style={{ width: `${Math.min(rule.confidence * 100, 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-text-muted font-mono">{(rule.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="text-[10px] text-text-muted">{rule.sample_count} muestras</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
