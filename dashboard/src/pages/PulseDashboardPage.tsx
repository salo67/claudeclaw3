import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

type TabKey = 'pulse' | 'briefing';

const CHECKLIST_KEY = 'pulse-action-items';
const ACTIVE_TAB_KEY = 'pulse-active-tab';

interface BriefingData {
  quote: string;
  weather: { temp: string; condition: string; forecast: string };
  newsletter_highlights: { subject: string; key_points: string[] }[];
}

interface PulseSnapshot {
  generated_at: string;
  cashflow: SectionData;
  stockouts: SectionData;
  kpis_hd: SectionData;
  pending_approvals: SectionData;
  exchange_rate: SectionData;
  email_stats: SectionData;
  // New Hub-sourced sections
  margin_health: SectionData;
  forecast_alerts: SectionData;
  supply_chain: SectionData;
  sales_summary: SectionData;
  cc_alerts: SectionData;
  discovery: SectionData;
}

interface SectionData {
  status: string;
  data?: Record<string, unknown>;
  error?: string;
}

interface AdvisorsOvernight {
  decisions: string[];
  pending_approvals: string[];
  actions_taken: string[];
  summary: string;
  message_count: number;
}

interface ActionItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

interface MetricCard {
  label: string;
  value: string;
  prev?: string;
  change?: number;
  icon: React.ReactNode;
  status: 'up' | 'down' | 'neutral';
  sublabel?: string;
}

function loadChecklist(): ActionItem[] {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChecklist(items: ActionItem[]) {
  localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items));
}

function ArrowIcon({ direction }: { direction: 'up' | 'down' | 'neutral' }) {
  if (direction === 'neutral') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M2 7h10" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {direction === 'up' ? (
        <path d="M7 11V3M3 6l4-4 4 4" />
      ) : (
        <path d="M7 3v8M3 8l4 4 4-4" />
      )}
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function extractCount(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  if (typeof data === 'number') return data;
  if (Array.isArray(data)) return data.length;
  const count = (data.count ?? data.total ?? data.length) as number | undefined;
  if (count != null) return count;
  if (Array.isArray(data.items)) return (data.items as unknown[]).length;
  if (Array.isArray(data.products)) return (data.products as unknown[]).length;
  return null;
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function formatMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pctChange(cur: number | undefined, prev: number | undefined): number | undefined {
  if (cur == null || prev == null || prev === 0) return undefined;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function safeGet(pulse: PulseSnapshot | null | undefined, sectionKey: string, ...keys: string[]): unknown {
  if (!pulse) return undefined;
  const section = (pulse as unknown as Record<string, SectionData>)[sectionKey];
  if (!section || section.status !== 'ok' || !section.data) return undefined;
  let obj: unknown = section.data;
  for (const k of keys) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = (obj as Record<string, unknown>)[k];
  }
  // Hub responses wrap data in {data: {...}, count, endpoint/source} -- unwrap automatically
  if (obj != null && typeof obj === 'object' && !Array.isArray(obj)) {
    const rec = obj as Record<string, unknown>;
    const hasWrapper = ('endpoint' in rec || 'source' in rec) && 'data' in rec;
    if (hasWrapper) {
      const inner = rec.data;
      // Double-wrapped (e.g. margins summary): {data: {data: {...}, count, ...}, ...}
      if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
        const innerRec = inner as Record<string, unknown>;
        if (('endpoint' in innerRec || 'source' in innerRec) && 'data' in innerRec) {
          return innerRec.data;
        }
      }
      return inner;
    }
  }
  return obj;
}

// ── Metric Extraction ───────────────────────────────────────

function extractMetrics(current: PulseSnapshot | null, previous: PulseSnapshot | null): MetricCard[] {
  const cards: MetricCard[] = [];

  // 1. Cashflow balance
  const cashCur = current?.cashflow?.data?.balance as Record<string, unknown> | undefined;
  const cashPrev = previous?.cashflow?.data?.balance as Record<string, unknown> | undefined;
  const balCur = (cashCur?.balance ?? cashCur?.total_balance) as number | undefined;
  const balPrev = (cashPrev?.balance ?? cashPrev?.total_balance) as number | undefined;
  const balChange = pctChange(balCur, balPrev);
  cards.push({
    label: 'Cashflow',
    value: balCur != null ? formatMoney(balCur) : '--',
    prev: balPrev != null ? formatMoney(balPrev) : undefined,
    change: balChange,
    icon: <path d="M9 1v16M5 4h6a3 3 0 010 6H4m2 0h7a3 3 0 010 6H5" />,
    status: balChange != null ? (balChange > 0 ? 'up' : balChange < 0 ? 'down' : 'neutral') : 'neutral',
  });

  // 2. Sales summary (from Hub)
  const salesData = safeGet(current, 'sales_summary', 'summary') as Record<string, unknown> | undefined;
  const salesPrevData = safeGet(previous, 'sales_summary', 'summary') as Record<string, unknown> | undefined;
  const salesTotal = (salesData?.sales_ytd ?? salesData?.total_sales ?? salesData?.total ?? salesData?.ventas_totales) as number | undefined;
  const salesYoy = salesData?.sales_yoy_pct as number | undefined;
  const salesPrevTotal = (salesPrevData?.sales_ytd ?? salesPrevData?.total_sales ?? salesPrevData?.total) as number | undefined;
  const salesChange = salesYoy ?? pctChange(salesTotal, salesPrevTotal);
  const profitMargin = salesData?.profit_margin_pct as number | undefined;
  cards.push({
    label: 'Ventas YTD',
    value: salesTotal != null ? formatMoney(salesTotal) : '--',
    prev: salesPrevTotal != null ? formatMoney(salesPrevTotal) : undefined,
    change: salesChange,
    icon: <><path d="M3 15l4-8 4 4 4-10" /><path d="M17 5h-4v4" /></>,
    status: salesChange != null ? (salesChange > 0 ? 'up' : salesChange < 0 ? 'down' : 'neutral') : 'neutral',
    sublabel: profitMargin != null ? `Margen: ${profitMargin.toFixed(1)}%` : undefined,
  });

  // 3. Margin health (from Hub)
  const marginData = safeGet(current, 'margin_health', 'summary') as Record<string, unknown> | undefined;
  const marginPrevData = safeGet(previous, 'margin_health', 'summary') as Record<string, unknown> | undefined;
  const avgMargin = (marginData?.avg_margin ?? marginData?.average_margin ?? marginData?.margen_promedio) as number | undefined;
  const avgMarginPrev = (marginPrevData?.avg_margin ?? marginPrevData?.average_margin ?? marginPrevData?.margen_promedio) as number | undefined;
  const marginChange = pctChange(avgMargin, avgMarginPrev);
  const marginCritical = (marginData?.critical_count ?? marginData?.critical) as number | undefined;
  cards.push({
    label: 'Margen Promedio',
    value: avgMargin != null ? `${avgMargin.toFixed(1)}%` : '--',
    prev: avgMarginPrev != null ? `${avgMarginPrev.toFixed(1)}%` : undefined,
    change: marginChange,
    icon: <><path d="M2 16l5-5 3 3 6-8" /><circle cx="16" cy="6" r="1.5" /></>,
    status: marginChange != null ? (marginChange > 0 ? 'up' : marginChange < 0 ? 'down' : 'neutral') : 'neutral',
    sublabel: marginCritical != null && marginCritical > 0 ? `${marginCritical} criticos` : undefined,
  });

  // 4. Stockouts
  const stCur = current?.stockouts?.data?.stockouts as Record<string, unknown> | undefined;
  const stPrev = previous?.stockouts?.data?.stockouts as Record<string, unknown> | undefined;
  const stCountCur = extractCount(stCur);
  const stCountPrev = extractCount(stPrev);
  const stChange = pctChange(stCountCur ?? undefined, stCountPrev ?? undefined);
  cards.push({
    label: 'Stockouts',
    value: stCountCur != null ? String(stCountCur) : '--',
    prev: stCountPrev != null ? String(stCountPrev) : undefined,
    change: stChange,
    icon: <><path d="M2 5l7-3 7 3v8l-7 3-7-3z" /><path d="M2 5l7 3 7-3M9 8v9" /></>,
    status: stChange != null ? (stChange > 0 ? 'down' : stChange < 0 ? 'up' : 'neutral') : 'neutral',
  });

  // 5. Exchange rate
  const erCur = current?.exchange_rate?.data as Record<string, unknown> | undefined;
  const erPrev = previous?.exchange_rate?.data as Record<string, unknown> | undefined;
  const usdMxnCur = erCur?.usd_mxn as number | undefined;
  const usdMxnPrev = erPrev?.usd_mxn as number | undefined;
  const erChange = pctChange(usdMxnCur, usdMxnPrev);
  cards.push({
    label: 'USD/MXN',
    value: usdMxnCur != null ? `$${usdMxnCur.toFixed(2)}` : '--',
    prev: usdMxnPrev != null ? `$${usdMxnPrev.toFixed(2)}` : undefined,
    change: erChange,
    icon: <><circle cx="9" cy="9" r="7" /><path d="M9 5v8M6 7.5h6M6 10.5h6" /></>,
    status: erChange != null ? (erChange > 0 ? 'up' : erChange < 0 ? 'down' : 'neutral') : 'neutral',
  });

  // 6. Supply chain - overdue payments
  const overdueRaw = safeGet(current, 'supply_chain', 'overdue');
  const overdueData = overdueRaw as Record<string, unknown> | unknown[] | undefined;
  const overdueCount = Array.isArray(overdueData) ? overdueData.length
    : (overdueData as Record<string, unknown> | undefined)?.total_overdue as number | null
    ?? extractCount(overdueData as Record<string, unknown> | undefined);
  cards.push({
    label: 'Pagos Vencidos',
    value: overdueCount != null ? String(overdueCount) : '--',
    icon: <><path d="M12 2v4M12 18v2M4.93 4.93l1.41 1.41M15.66 15.66l1.41 1.41M2 12h4M18 12h2M4.93 19.07l1.41-1.41M15.66 8.34l1.41-1.41" /></>,
    status: overdueCount != null && overdueCount > 0 ? 'down' : 'neutral',
    sublabel: overdueCount != null && overdueCount > 0 ? 'Requiere atencion' : undefined,
  });

  return cards;
}

// ── Severity helpers ────────────────────────────────────────

const severityConfig = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', label: 'Critico' },
  warning: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', label: 'Alerta' },
  insight: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', label: 'Insight' },
  info: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', label: 'Info' },
} as const;

function getSeverity(s: string) {
  return severityConfig[s as keyof typeof severityConfig] || severityConfig.info;
}

// ── Main Component ──────────────────────────────────────────

export default function PulseDashboardPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>(
    () => (localStorage.getItem(ACTIVE_TAB_KEY) as TabKey) || 'pulse'
  );
  const [pulse, setPulse] = useState<PulseSnapshot | null>(null);
  const [prevPulse, setPrevPulse] = useState<PulseSnapshot | null>(null);
  const [advisors, setAdvisors] = useState<AdvisorsOvernight | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>(loadChecklist);
  const [newItemText, setNewItemText] = useState('');
  const [loading, setLoading] = useState(true);
  const [decisionStates, setDecisionStates] = useState<Record<number, 'approved' | 'rejected'>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Briefing state
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingDate, setBriefingDate] = useState<string>(formatDate(new Date()));
  const [briefingRegenerating, setBriefingRegenerating] = useState(false);

  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  };

  const fetchData = useCallback(async () => {
    try {
      const [latestRes, historyRes, advisorsRes] = await Promise.all([
        fetch('/api/pulse/latest'),
        fetch('/api/pulse/history?page=1&page_size=2'),
        fetch('/api/pulse/advisors-overnight'),
      ]);

      const latestData = await latestRes.json();
      const historyData = await historyRes.json();
      const advisorsData = await advisorsRes.json();

      if (latestData.pulse) {
        setPulse(latestData.pulse.snapshot);
      }
      if (historyData.items && historyData.items.length > 1) {
        setPrevPulse(historyData.items[1].snapshot);
      }
      setAdvisors(advisorsData);
    } catch (e) {
      console.error('Failed to fetch pulse data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const res = await fetch('/api/pulse/briefing');
      const data = await res.json();
      setBriefing(data);
    } catch (e) {
      console.error('Failed to fetch briefing', e);
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (activeTab === 'briefing' && !briefing) {
      fetchBriefing();
    }
  }, [activeTab, briefing, fetchBriefing]);

  useEffect(() => { saveChecklist(actionItems); }, [actionItems]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/pulse/generate', { method: 'POST' });
      await fetchData();
    } catch (e) {
      console.error('Failed to generate pulse', e);
    } finally {
      setRefreshing(false);
    }
  };

  const handleBriefingRegenerate = async () => {
    setBriefingRegenerating(true);
    try {
      await fetch('/api/pulse/generate', { method: 'POST' });
      await fetchBriefing();
    } catch (e) {
      console.error('Failed to regenerate briefing', e);
    } finally {
      setBriefingRegenerating(false);
    }
  };

  const navigateBriefingDate = (delta: number) => {
    const d = new Date(briefingDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const today = formatDate(new Date());
    const newDate = formatDate(d);
    if (newDate > today) return;
    setBriefingDate(newDate);
  };

  const isToday = briefingDate === formatDate(new Date());

  const toggleItem = (id: string) => {
    setActionItems(prev => prev.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  const addItem = () => {
    if (!newItemText.trim()) return;
    setActionItems(prev => [...prev, {
      id: Date.now().toString(36),
      text: newItemText.trim(),
      done: false,
      createdAt: new Date().toISOString(),
    }]);
    setNewItemText('');
  };

  const removeItem = (id: string) => {
    setActionItems(prev => prev.filter(item => item.id !== id));
  };

  const handleDecision = (idx: number, action: 'approved' | 'rejected') => {
    setDecisionStates(prev => ({ ...prev, [idx]: action }));
  };

  const metrics = extractMetrics(pulse, prevPulse);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  // Extract data for various sections
  const exchangeRate = pulse?.exchange_rate?.data as Record<string, unknown> | undefined;
  const usdMxn = exchangeRate?.usd_mxn as number | undefined;

  // Margin health details
  const deteriorating = safeGet(pulse, 'margin_health', 'deteriorating') as unknown[] | undefined;
  const blockedProducts = safeGet(pulse, 'margin_health', 'blocked') as unknown[] | undefined;

  // Forecast alerts
  const forecastSummary = safeGet(pulse, 'forecast_alerts', 'summary') as Record<string, unknown> | undefined;
  const forecastAlerts = (forecastSummary?.alerts ?? forecastSummary?.items) as unknown[] | undefined;
  const forecastAbc = safeGet(pulse, 'forecast_alerts', 'abc') as Record<string, unknown> | undefined;

  // Supply chain
  const supplyDashboard = safeGet(pulse, 'supply_chain', 'dashboard') as Record<string, unknown> | undefined;
  const arrivals = safeGet(pulse, 'supply_chain', 'arrivals') as unknown[] | undefined;

  // CC Alerts + Discovery
  const ccAlertsData = pulse?.cc_alerts?.data as Record<string, unknown> | undefined;
  const ccAlerts = ccAlertsData?.alerts as Record<string, unknown>[] | undefined;
  const ccCritical = (ccAlertsData?.critical ?? 0) as number;
  const ccWarning = (ccAlertsData?.warning ?? 0) as number;

  const discoveryData = pulse?.discovery?.data as Record<string, unknown> | undefined;
  const discoveryFindings = discoveryData?.findings as Record<string, unknown>[] | undefined;
  const discoveryCritical = (discoveryData?.critical ?? 0) as number;
  const discoveryWarning = (discoveryData?.warning ?? 0) as number;

  // Combine critical items for attention banner
  const totalCritical = ccCritical + discoveryCritical;
  const totalWarning = ccWarning + discoveryWarning;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4 sm:p-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 border-b border-border" data-testid="tab-nav">
        {([
          { key: 'pulse' as TabKey, label: 'Business Pulse' },
          { key: 'briefing' as TabKey, label: 'Briefing' },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-display font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-accent border-accent'
                : 'text-text-muted border-transparent hover:text-text-primary hover:border-border-bright'
            }`}
            data-testid={`tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => navigate('/pulse-config')}
            className="p-2 text-text-muted hover:text-accent rounded-md transition-colors"
            title="Configurar modulos"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
            </svg>
          </button>
        </div>
      </div>

      {/* ═══ BRIEFING TAB ═══ */}
      {activeTab === 'briefing' && (
        <div className="space-y-6 animate-fade-in" data-testid="briefing-tab">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3" data-testid="date-nav">
              <button
                onClick={() => navigateBriefingDate(-1)}
                className="p-2 rounded-md bg-surface-raised border border-border hover:border-border-bright transition-colors text-text-secondary hover:text-text-primary"
                data-testid="date-prev"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 2L4 7l5 5" />
                </svg>
              </button>
              <span className="text-sm font-display font-semibold text-text-primary min-w-[120px] text-center" data-testid="date-display">
                {isToday ? 'Hoy' : new Date(briefingDate + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
                {!isToday && <span className="text-text-muted ml-1.5 text-xs font-normal">{briefingDate}</span>}
              </span>
              <button
                onClick={() => navigateBriefingDate(1)}
                disabled={isToday}
                className="p-2 rounded-md bg-surface-raised border border-border hover:border-border-bright transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                data-testid="date-next"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 2l5 5-5 5" />
                </svg>
              </button>
            </div>
            <button
              onClick={handleBriefingRegenerate}
              disabled={briefingRegenerating}
              className="flex items-center gap-2 px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40"
              data-testid="briefing-regenerate"
            >
              <svg
                width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                className={briefingRegenerating ? 'animate-spin' : ''}
              >
                <path d="M1 8a7 7 0 0113-3.5M15 8a7 7 0 01-13 3.5" />
                <path d="M14 1v4h-4M2 15v-4h4" />
              </svg>
              {briefingRegenerating ? 'Regenerando...' : 'Regenerar'}
            </button>
          </div>

          {briefingLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
            </div>
          ) : briefing ? (
            <div className="space-y-5">
              <div className="bg-surface-raised border border-accent/20 rounded-lg p-6" data-testid="briefing-quote">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-accent/10 text-accent flex-shrink-0 mt-0.5">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8c-1.5 0-2.5-1-2.5-2.5S2.5 3 4 3c2 0 3 1.5 3 4 0 3-1.5 5-4 6" />
                      <path d="M13 8c-1.5 0-2.5-1-2.5-2.5S11.5 3 13 3c2 0 3 1.5 3 4 0 3-1.5 5-4 6" />
                    </svg>
                  </div>
                  <p className="text-base text-text-primary font-body leading-relaxed italic">
                    {briefing.quote}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-surface-raised border border-border rounded-lg p-5" data-testid="briefing-weather">
                  <h3 className="text-xs font-display font-medium text-accent uppercase tracking-wider mb-3">Clima - Monterrey</h3>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-display font-bold text-text-primary">
                      {briefing.weather.temp ? `${briefing.weather.temp}°C` : '--'}
                    </span>
                    <span className="text-sm text-text-secondary font-body">{briefing.weather.condition}</span>
                  </div>
                  {briefing.weather.forecast && (
                    <p className="text-xs text-text-muted mt-2 font-body">{briefing.weather.forecast}</p>
                  )}
                </div>

                <div className="bg-surface-raised border border-border rounded-lg p-5" data-testid="briefing-exchange">
                  <h3 className="text-xs font-display font-medium text-accent uppercase tracking-wider mb-3">Tipo de Cambio</h3>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-display font-bold text-text-primary">
                      {usdMxn != null ? `$${usdMxn.toFixed(2)}` : '--'}
                    </span>
                    <span className="text-sm text-text-secondary font-body">USD/MXN</span>
                  </div>
                </div>
              </div>

              {briefing.newsletter_highlights.length > 0 && (
                <div className="space-y-3" data-testid="briefing-newsletters">
                  <h3 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Newsletters del dia</h3>
                  {briefing.newsletter_highlights.map((nh, idx) => (
                    <div key={idx} className="bg-surface-raised border border-border rounded-lg p-4">
                      <h4 className="text-sm font-display font-semibold text-text-primary mb-2">{nh.subject}</h4>
                      {nh.key_points.length > 0 && (
                        <ul className="space-y-1">
                          {nh.key_points.map((kp, kpIdx) => (
                            <li key={kpIdx} className="text-sm text-text-secondary font-body flex items-start gap-2">
                              <span className="text-accent mt-1 flex-shrink-0">-</span>
                              {kp}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-text-muted text-sm border border-dashed border-border rounded-lg">
              No hay datos de briefing disponibles
            </div>
          )}
        </div>
      )}

      {/* ═══ BUSINESS PULSE TAB ═══ */}
      {activeTab === 'pulse' && (
        <div className="space-y-6 animate-fade-in" data-testid="pulse-tab">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted mt-1 font-body">
            {pulse ? `Generado: ${new Date(pulse.generated_at).toLocaleString()}` : 'Sin datos'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40"
        >
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={refreshing ? 'animate-spin' : ''}
          >
            <path d="M1 8a7 7 0 0113-3.5M15 8a7 7 0 01-13 3.5" />
            <path d="M14 1v4h-4M2 15v-4h4" />
          </svg>
          {refreshing ? 'Generando...' : 'Refresh Pulse'}
        </button>
      </div>

      {/* Critical attention banner */}
      {totalCritical > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20 text-red-400 flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2L1.5 16h15L9 2zM9 7v4M9 13h.01" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-display font-semibold text-red-400">
              {totalCritical} alerta{totalCritical > 1 ? 's' : ''} critica{totalCritical > 1 ? 's' : ''}
              {totalWarning > 0 && ` + ${totalWarning} warning${totalWarning > 1 ? 's' : ''}`}
            </p>
            <p className="text-xs text-red-400/70 font-body mt-0.5">Revisa los detalles abajo</p>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4" data-testid="metrics-grid">
        {metrics.map((card, i) => (
          <div
            key={card.label}
            className="bg-surface-raised border border-border rounded-lg p-5 hover:border-border-bright transition-all group"
            style={{ animationDelay: `${i * 60}ms` }}
            data-testid="metric-card"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 rounded-lg bg-accent/10 text-accent">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {card.icon}
                </svg>
              </div>
              {card.change != null && (
                <div
                  className={`flex items-center gap-1 text-xs font-display font-medium px-2 py-1 rounded-md ${
                    card.status === 'up'
                      ? 'bg-green-500/15 text-green-400'
                      : card.status === 'down'
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-gray-500/15 text-text-muted'
                  }`}
                  data-testid="change-indicator"
                >
                  <ArrowIcon direction={card.status} />
                  {Math.abs(card.change).toFixed(1)}%
                </div>
              )}
            </div>
            <div className="text-2xl font-display font-bold text-text-primary">{card.value}</div>
            <div className="text-xs text-text-muted font-display uppercase tracking-wider mt-1">{card.label}</div>
            {card.prev && (
              <div className="text-[11px] text-text-muted/60 mt-1.5">Prev: {card.prev}</div>
            )}
            {card.sublabel && (
              <div className="text-[11px] text-yellow-400/80 mt-1.5 font-display">{card.sublabel}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Business Intelligence Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Margin Health */}
        <div className="bg-surface-raised border border-border rounded-lg p-5 space-y-3">
          <h3 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Salud de Margenes</h3>
          {deteriorating && Array.isArray(deteriorating) && deteriorating.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-yellow-400 font-display">{deteriorating.length} producto{deteriorating.length > 1 ? 's' : ''} con margen deteriorandose</p>
              {deteriorating.slice(0, 5).map((item, idx) => {
                const p = item as Record<string, unknown>;
                return (
                  <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-text-primary font-body truncate flex-1 mr-2">{String(p.sku || p.product_name || p.name || `Producto ${idx + 1}`)}</span>
                    <span className="text-red-400 font-display text-xs flex-shrink-0">
                      {p.margin != null ? `${Number(p.margin).toFixed(1)}%` : p.change != null ? `${Number(p.change).toFixed(1)}%` : '--'}
                    </span>
                  </div>
                );
              })}
              {deteriorating.length > 5 && (
                <p className="text-[11px] text-text-muted">+{deteriorating.length - 5} mas</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted font-body">Sin productos con margen deteriorandose</p>
          )}
          {blockedProducts && Array.isArray(blockedProducts) && blockedProducts.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-red-400 font-display">{blockedProducts.length} bloqueado{blockedProducts.length > 1 ? 's' : ''} por margen negativo</p>
            </div>
          )}
        </div>

        {/* Supply Chain */}
        <div className="bg-surface-raised border border-border rounded-lg p-5 space-y-3">
          <h3 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Supply Chain</h3>
          {supplyDashboard ? (
            <div className="space-y-2">
              {(supplyDashboard.total_orders ?? supplyDashboard.active_orders ?? supplyDashboard.open_orders) != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary font-body">Ordenes activas</span>
                  <span className="text-text-primary font-display font-semibold">{String(supplyDashboard.active_orders ?? supplyDashboard.total_orders ?? supplyDashboard.open_orders)}</span>
                </div>
              )}
              {(supplyDashboard.total_value ?? supplyDashboard.total_debt ?? supplyDashboard.deuda_total) != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary font-body">Valor total</span>
                  <span className="text-text-primary font-display font-semibold">{formatMoney(Number(supplyDashboard.total_value ?? supplyDashboard.total_debt ?? supplyDashboard.deuda_total ?? 0))}</span>
                </div>
              )}
              {supplyDashboard.pending_actions != null && Number(supplyDashboard.pending_actions) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary font-body">Acciones pendientes</span>
                  <span className="text-yellow-400 font-display font-semibold">{String(supplyDashboard.pending_actions)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted font-body">Sin datos de supply chain</p>
          )}
          {arrivals && Array.isArray(arrivals) && arrivals.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-accent font-display mb-2">{arrivals.length} envio{arrivals.length > 1 ? 's' : ''} en camino</p>
              {arrivals.slice(0, 3).map((a, idx) => {
                const arr = a as Record<string, unknown>;
                return (
                  <div key={idx} className="text-xs text-text-secondary font-body py-1">
                    {String(arr.supplier_name || arr.description || arr.supplier || arr.proveedor || `Envio ${idx + 1}`)}
                    {(arr.expected_delivery_date || arr.eta) && <span className="text-text-muted ml-2">ETA: {String(arr.expected_delivery_date || arr.eta)}</span>}
                  </div>
                );
              })}
              {arrivals.length > 3 && (
                <p className="text-[11px] text-text-muted">+{arrivals.length - 3} mas</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Forecast Alerts */}
      {(forecastSummary || (forecastAlerts && Array.isArray(forecastAlerts) && forecastAlerts.length > 0)) && (
        <div className="space-y-3">
          <h2 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Forecast / Demanda</h2>
          {/* Summary stats */}
          {forecastSummary && (forecastSummary.total != null || forecastSummary.critical != null) && (
            <div className="bg-surface-raised border border-border rounded-lg p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {forecastSummary.total != null && (
                  <div className="text-center">
                    <div className="text-lg font-display font-bold text-text-primary">{String(forecastSummary.total)}</div>
                    <div className="text-[10px] text-text-muted font-display uppercase">Total alertas</div>
                  </div>
                )}
                {forecastSummary.critical != null && Number(forecastSummary.critical) > 0 && (
                  <div className="text-center">
                    <div className="text-lg font-display font-bold text-red-400">{String(forecastSummary.critical)}</div>
                    <div className="text-[10px] text-text-muted font-display uppercase">Criticas</div>
                  </div>
                )}
                {forecastSummary.warning != null && Number(forecastSummary.warning) > 0 && (
                  <div className="text-center">
                    <div className="text-lg font-display font-bold text-yellow-400">{String(forecastSummary.warning)}</div>
                    <div className="text-[10px] text-text-muted font-display uppercase">Warning</div>
                  </div>
                )}
                {forecastSummary.class_a != null && (
                  <div className="text-center">
                    <div className="text-lg font-display font-bold text-accent">{String(forecastSummary.class_a)}</div>
                    <div className="text-[10px] text-text-muted font-display uppercase">Clase A</div>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* ABC summary if available */}
          {forecastAbc && (
            <div className="bg-surface-raised border border-border rounded-lg p-4">
              <p className="text-xs font-display font-medium text-accent uppercase tracking-wider mb-2">Clasificacion ABC</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                {['A', 'B', 'C'].map(cls => {
                  const key = `class_${cls.toLowerCase()}`;
                  const val = (forecastAbc as Record<string, unknown>)[key] ?? (forecastAbc as Record<string, unknown>)[cls.toLowerCase()];
                  return val != null ? (
                    <div key={cls}>
                      <div className="text-lg font-display font-bold text-text-primary">{String(val)}</div>
                      <div className="text-[10px] text-text-muted font-display uppercase">Clase {cls}</div>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {/* Individual alerts if available as array */}
          {forecastAlerts && Array.isArray(forecastAlerts) && forecastAlerts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {forecastAlerts.slice(0, 6).map((alert, idx) => {
                const a = alert as Record<string, unknown>;
                const sev = getSeverity(String(a.severity || a.type || 'info'));
                return (
                  <div key={idx} className={`${sev.bg} border ${sev.border} rounded-lg p-3 text-sm`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-display font-bold uppercase ${sev.text}`}>{sev.label}</span>
                    </div>
                    <p className="text-text-primary font-body text-xs">{String(a.title || a.message || a.description || JSON.stringify(a))}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Discovery Findings */}
      {discoveryFindings && discoveryFindings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Hallazgos del Discovery Loop</h2>
            <span className="text-[10px] text-text-muted font-display">{discoveryFindings.length} finding{discoveryFindings.length > 1 ? 's' : ''}</span>
          </div>
          {discoveryFindings.slice(0, 6).map((finding, idx) => {
            const f = finding;
            const sev = getSeverity(String(f.severity || 'insight'));
            const advisorName = { ceo: 'Arturo', sales: 'Elena', marketing: 'Valeria', architect: 'Miguel' }[String(f.advisor_key)] || String(f.advisor_key || '');
            return (
              <div key={idx} className={`${sev.bg} border ${sev.border} rounded-lg p-4`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-display font-bold uppercase ${sev.text}`}>{sev.label}</span>
                  {advisorName && <span className="text-[10px] text-text-muted font-display">via {advisorName}</span>}
                </div>
                <p className="text-sm font-display font-semibold text-text-primary">{String(f.title)}</p>
                {f.detail && <p className="text-xs text-text-secondary font-body mt-1 line-clamp-2">{String(f.detail)}</p>}
                {f.recommended_action && (
                  <p className="text-xs text-accent font-body mt-2 flex items-start gap-1.5">
                    <span className="flex-shrink-0 mt-0.5">&#8594;</span>
                    {String(f.recommended_action)}
                  </p>
                )}
              </div>
            );
          })}
          {discoveryFindings.length > 6 && (
            <p className="text-[11px] text-text-muted font-display">+{discoveryFindings.length - 6} hallazgos mas</p>
          )}
        </div>
      )}

      {/* CC Alerts */}
      {ccAlerts && ccAlerts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Alertas Activas</h2>
            <span className="text-[10px] text-text-muted font-display">{ccAlerts.length} alerta{ccAlerts.length > 1 ? 's' : ''}</span>
          </div>
          {ccAlerts.slice(0, 5).map((alert, idx) => {
            const sev = getSeverity(String(alert.severity || 'info'));
            return (
              <div key={idx} className="bg-surface-raised border border-border rounded-lg p-3 flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${sev.text === 'text-red-400' ? 'bg-red-400' : sev.text === 'text-yellow-400' ? 'bg-yellow-400' : 'bg-blue-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-medium text-text-primary">{String(alert.title)}</p>
                  {alert.description && <p className="text-xs text-text-secondary font-body mt-0.5 truncate">{String(alert.description)}</p>}
                </div>
                {alert.source && <span className="text-[10px] text-text-muted font-display flex-shrink-0">{String(alert.source)}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Advisor Decisions */}
      <div className="space-y-3" data-testid="advisor-decisions">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Actividad de Advisors</h2>
          {advisors && (
            <span className="text-[10px] text-text-muted font-display">
              {advisors.message_count} mensajes / 12h
            </span>
          )}
        </div>

        {advisors?.summary && (
          <div className="bg-surface-raised border border-border rounded-lg p-4 text-sm text-text-secondary font-body">
            {advisors.summary}
          </div>
        )}

        {advisors?.pending_approvals && advisors.pending_approvals.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-display font-medium text-status-paused uppercase tracking-wider">
              Pendientes de Aprobacion
            </h3>
            {advisors.pending_approvals.map((item, idx) => (
              <div key={idx} className="bg-surface-raised border border-border rounded-lg p-4 flex items-start gap-3" data-testid="approval-item">
                <div className="flex-1 text-sm text-text-primary font-body">{item}</div>
                {decisionStates[idx] ? (
                  <span
                    className={`px-3 py-1.5 text-xs font-display font-medium rounded-md ${
                      decisionStates[idx] === 'approved'
                        ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                        : 'bg-red-500/15 text-red-400 border border-red-500/30'
                    }`}
                    data-testid="decision-badge"
                  >
                    {decisionStates[idx] === 'approved' ? 'Aprobado' : 'Rechazado'}
                  </span>
                ) : (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleDecision(idx, 'approved')}
                      className="px-3 py-1.5 text-xs font-display font-medium bg-green-500/15 text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/25 transition-colors"
                      data-testid="approve-btn"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => handleDecision(idx, 'rejected')}
                      className="px-3 py-1.5 text-xs font-display font-medium bg-red-500/15 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/25 transition-colors"
                      data-testid="reject-btn"
                    >
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {advisors?.decisions && advisors.decisions.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-display font-medium text-accent uppercase tracking-wider">Decisiones</h3>
            {advisors.decisions.map((d, idx) => (
              <div key={idx} className="bg-surface-raised border border-border rounded-lg p-4 text-sm text-text-primary font-body flex items-start gap-3">
                <div className="p-1 rounded bg-accent/15 text-accent flex-shrink-0 mt-0.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                </div>
                {d}
              </div>
            ))}
          </div>
        )}

        {advisors?.actions_taken && advisors.actions_taken.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-display font-medium text-status-active uppercase tracking-wider">Acciones Ejecutadas</h3>
            {advisors.actions_taken.map((a, idx) => (
              <div key={idx} className="bg-surface-raised border border-border rounded-lg p-4 text-sm text-text-primary font-body flex items-start gap-3">
                <div className="p-1 rounded bg-status-active/15 text-status-active flex-shrink-0 mt-0.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="6" cy="6" r="4" />
                  </svg>
                </div>
                {a}
              </div>
            ))}
          </div>
        )}

        {advisors && advisors.message_count === 0 && (
          <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
            Sin actividad de advisors en las ultimas 12 horas
          </div>
        )}
      </div>

      {/* Action Items Checklist */}
      <div className="space-y-3" data-testid="action-items">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-display font-medium text-accent uppercase tracking-wider">Action Items</h2>
          <span className="text-xs text-text-muted font-display">
            {actionItems.filter(i => i.done).length}/{actionItems.length} completados
          </span>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Agregar action item..."
            className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
            data-testid="new-item-input"
          />
          <button
            onClick={addItem}
            disabled={!newItemText.trim()}
            className="px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40"
            data-testid="add-item-btn"
          >
            Agregar
          </button>
        </div>

        <div className="space-y-1.5">
          {actionItems.length === 0 && (
            <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
              No hay action items
            </div>
          )}
          {actionItems.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 bg-surface-raised border border-border rounded-lg px-4 py-3 group transition-all ${
                item.done ? 'opacity-60' : ''
              }`}
              data-testid="action-item"
            >
              <button
                onClick={() => toggleItem(item.id)}
                className={`flex-shrink-0 w-5 h-5 rounded border-2 transition-colors flex items-center justify-center ${
                  item.done
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'border-border hover:border-accent/50'
                }`}
                data-testid="toggle-item"
              >
                {item.done && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M2 5l2.5 2.5L8 3" />
                  </svg>
                )}
              </button>
              <span className={`flex-1 text-sm font-body ${item.done ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                {item.text}
              </span>
              <button
                onClick={() => removeItem(item.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-red-400 transition-all"
                data-testid="remove-item"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
