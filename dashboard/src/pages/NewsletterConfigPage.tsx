import { useEffect, useState, useCallback, useRef } from 'react';

const CONFIG_API = '/api/newsletter/config';
const SOURCES_API = '/api/newsletter/sources';
const LATEST_API = '/api/newsletter/latest';
const LIST_API = '/api/newsletter/list';
const GENERATE_API = '/api/newsletter/generate';

const DAY_LABELS = ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'];
const SOURCE_TYPES = ['rss', 'atom', 'scraper', 'api'] as const;

interface SectionConfig { enabled: boolean; order: number; }
interface ColumnConfig { enabled: boolean; source: string; days: number[]; label: string; }
interface NewsletterConfig { sections: Record<string, SectionConfig>; columns: Record<string, ColumnConfig>; }
interface NewsSource { name: string; url: string; source_type: string; section: string; active: boolean; }
interface NewsletterEntry { filename: string; date: string; }
interface LatestNewsletter { html: string | null; date: string | null; filename: string | null; stats: any; }

const SOURCE_COLORS: Record<string, string> = {
  reforma: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  universal: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  financiero: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

function SourceBadge({ source }: { source: string }) {
  const colors = SOURCE_COLORS[source] ?? 'bg-surface text-text-muted border-border';
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-display font-semibold uppercase tracking-wider rounded border ${colors}`}>
      {source.charAt(0).toUpperCase() + source.slice(1)}
    </span>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-accent/30' : 'bg-surface'} border ${checked ? 'border-accent/50' : 'border-border'}`}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${checked ? 'left-5 bg-accent' : 'left-0.5 bg-text-muted'}`} />
    </button>
  );
}

function formatDate(d: string) {
  if (!d || d.length !== 8) return d;
  return `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`;
}

export default function NewsletterConfigPage() {
  const [showConfig, setShowConfig] = useState(false);
  const [latest, setLatest] = useState<LatestNewsletter | null>(null);
  const [editions, setEditions] = useState<NewsletterEntry[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<string | null>(null);
  const [displayHtml, setDisplayHtml] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Config state
  const [config, setConfig] = useState<NewsletterConfig | null>(null);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [saving, setSaving] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState<NewsSource>({ name: '', url: '', source_type: 'rss', section: '', active: true });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [latestRes, listRes] = await Promise.all([fetch(LATEST_API), fetch(LIST_API)]);
      if (latestRes.ok) {
        const data = await latestRes.json();
        setLatest(data);
        setDisplayHtml(data.html);
      }
      if (listRes.ok) setEditions(await listRes.json());
    } catch (e) { console.error('Failed to fetch newsletter', e); }
    finally { setLoading(false); }
  }, []);

  const fetchConfig = useCallback(async () => {
    const [configRes, sourcesRes] = await Promise.all([fetch(CONFIG_API), fetch(SOURCES_API)]);
    if (configRes.ok) setConfig(await configRes.json());
    if (sourcesRes.ok) setSources(await sourcesRes.json());
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (showConfig && !config) fetchConfig();
  }, [showConfig, config, fetchConfig]);

  // Write HTML to iframe
  useEffect(() => {
    if (iframeRef.current && displayHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) { doc.open(); doc.write(displayHtml); doc.close(); }
    }
  }, [displayHtml]);

  const handleGenerate = async () => {
    setGenerating(true);
    showToast('Generando newsletter...', 'success');
    try {
      const res = await fetch(GENERATE_API, { method: 'POST' });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error'); }
      showToast('Newsletter generado', 'success');
      fetchAll();
    } catch (e: any) {
      showToast(`Error: ${e.message}`, 'error');
    } finally { setGenerating(false); }
  };

  const handleSelectEdition = async (filename: string) => {
    setSelectedEdition(filename);
    try {
      const res = await fetch(`/api/newsletter/html/${filename}`);
      if (res.ok) setDisplayHtml(await res.text());
    } catch { showToast('Error al cargar edicion', 'error'); }
  };

  // Config handlers
  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch(CONFIG_API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Configuracion guardada', 'success');
    } catch { showToast('Error al guardar', 'error'); }
    finally { setSaving(false); }
  };

  const toggleSection = (key: string) => {
    if (!config) return;
    setConfig({ ...config, sections: { ...config.sections, [key]: { ...config.sections[key], enabled: !config.sections[key].enabled } } });
  };
  const updateSectionOrder = (key: string, order: number) => {
    if (!config) return;
    setConfig({ ...config, sections: { ...config.sections, [key]: { ...config.sections[key], order } } });
  };
  const toggleColumn = (key: string) => {
    if (!config) return;
    setConfig({ ...config, columns: { ...config.columns, [key]: { ...config.columns[key], enabled: !config.columns[key].enabled } } });
  };
  const toggleColumnDay = (key: string, day: number) => {
    if (!config) return;
    const col = config.columns[key];
    const days = col.days.includes(day) ? col.days.filter((d) => d !== day) : [...col.days, day].sort();
    setConfig({ ...config, columns: { ...config.columns, [key]: { ...col, days } } });
  };

  const handleAddSource = async () => {
    if (!newSource.name || !newSource.url) return;
    try {
      const res = await fetch(SOURCES_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSource) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewSource({ name: '', url: '', source_type: 'rss', section: '', active: true });
      setShowAddSource(false);
      showToast('Fuente agregada', 'success');
      const updated = await fetch(SOURCES_API);
      if (updated.ok) setSources(await updated.json());
    } catch { showToast('Error al agregar fuente', 'error'); }
  };

  const handleDeleteSource = async (name: string) => {
    try {
      const res = await fetch(`${SOURCES_API}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSources(sources.filter((s) => s.name !== name));
      showToast('Fuente eliminada', 'success');
    } catch { showToast('Error al eliminar fuente', 'error'); }
  };

  const handleToggleSource = async (src: NewsSource) => {
    try {
      const updated = { ...src, active: !src.active };
      const res = await fetch(`${SOURCES_API}/${encodeURIComponent(src.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSources(sources.map((s) => s.name === src.name ? updated : s));
    } catch { showToast('Error al actualizar fuente', 'error'); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" /></div>;
  }

  const sectionEntries = config ? Object.entries(config.sections).sort(([, a], [, b]) => a.order - b.order) : [];
  const columnEntries = config ? Object.entries(config.columns) : [];
  const sourceOrder = ['reforma', 'universal', 'financiero'];
  const groupedColumns: Record<string, [string, ColumnConfig][]> = {};
  for (const entry of columnEntries) { const s = entry[1].source; if (!groupedColumns[s]) groupedColumns[s] = []; groupedColumns[s].push(entry); }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-display font-bold text-text-primary tracking-tight">Newsletter</h1>
          {latest?.date && (
            <span className="text-xs text-text-muted font-display bg-surface-raised border border-border rounded px-2 py-1">
              {formatDate(latest.date)}
            </span>
          )}
          {editions.length > 1 && (
            <select
              value={selectedEdition || latest?.filename || ''}
              onChange={(e) => handleSelectEdition(e.target.value)}
              aria-label="Seleccionar edicion"
              className="bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent/50"
            >
              {editions.map((e) => (
                <option key={e.filename} value={e.filename}>{formatDate(e.date)}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 text-accent border border-accent/30 rounded-md text-xs font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40"
          >
            {generating ? (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-accent border-t-transparent" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 7h3l1.5-4 3 8 1.5-4H14" />
              </svg>
            )}
            {generating ? 'Generando...' : 'Generar'}
          </button>
          <button
            type="button"
            onClick={() => { setShowConfig(!showConfig); }}
            className={`p-1.5 rounded-md border transition-colors ${showConfig ? 'bg-accent/15 text-accent border-accent/30' : 'text-text-muted border-transparent hover:text-text-primary hover:border-border'}`}
            title="Configuracion"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="9" r="2.5" />
              <path d="M14.7 11.1a1.2 1.2 0 00.2 1.3l.04.04a1.44 1.44 0 11-2.04 2.04l-.04-.04a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.72 1.1v.12a1.44 1.44 0 11-2.88 0v-.06a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.3.2l-.04.04a1.44 1.44 0 11-2.04-2.04l.04-.04a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.72h-.12a1.44 1.44 0 110-2.88h.06a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.2-1.3l-.04-.04a1.44 1.44 0 112.04-2.04l.04.04a1.2 1.2 0 001.3.2h.06a1.2 1.2 0 00.72-1.1v-.12a1.44 1.44 0 112.88 0v.06a1.2 1.2 0 00.78 1.1 1.2 1.2 0 001.3-.2l.04-.04a1.44 1.44 0 112.04 2.04l-.04.04a1.2 1.2 0 00-.2 1.3v.06a1.2 1.2 0 001.1.72h.12a1.44 1.44 0 110 2.88h-.06a1.2 1.2 0 00-1.1.78z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Config panel (slide-over) */}
      {showConfig && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={(e) => { if (e.target === e.currentTarget) setShowConfig(false); }}>
          <div className="w-full max-w-2xl bg-surface border-l border-border shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-display font-bold text-text-primary">Configuracion</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleSaveConfig} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 text-accent border border-accent/30 rounded-md text-xs font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40">
                  {saving ? <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-accent border-t-transparent" /> : null}
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button type="button" onClick={() => setShowConfig(false)} className="p-1 text-text-muted hover:text-text-primary">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 5l8 8M13 5l-8 8" /></svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Sections */}
              <div className="space-y-2">
                <h3 className="text-sm font-display font-semibold text-text-primary">Secciones</h3>
                <div className="bg-surface-raised border border-border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted">Seccion</th>
                      <th className="text-center px-4 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted w-20">Orden</th>
                      <th className="text-center px-4 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted w-20">Activa</th>
                    </tr></thead>
                    <tbody>
                      {sectionEntries.map(([key, section]) => (
                        <tr key={key} className={`border-b border-border/50 last:border-0 hover:bg-surface-overlay/30 ${!section.enabled ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-2"><span className="text-sm font-display font-medium text-text-primary">{key}</span></td>
                          <td className="px-4 py-2 text-center">
                            <input type="number" min={1} value={section.order} onChange={(e) => updateSectionOrder(key, parseInt(e.target.value, 10) || 1)}
                              className="w-12 bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary text-center focus:outline-none focus:border-accent/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                          </td>
                          <td className="px-4 py-2 text-center"><div className="flex justify-center"><Toggle checked={section.enabled} onChange={() => toggleSection(key)} /></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Columns */}
              <div className="space-y-2">
                <h3 className="text-sm font-display font-semibold text-text-primary">Columnas</h3>
                <div className="bg-surface-raised border border-border rounded-lg overflow-hidden overflow-x-auto">
                  <table className="w-full">
                    <thead><tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted">Columna</th>
                      <th className="text-center px-4 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted w-20">Fuente</th>
                      <th className="text-center px-4 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted w-16">Activa</th>
                      {DAY_LABELS.map((d, i) => (
                        <th key={i} className="text-center px-1 py-2 text-[10px] font-display font-semibold uppercase tracking-wider text-text-muted w-8">{d}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {sourceOrder.filter((src) => groupedColumns[src]).map((source) => (
                        <>
                          <tr key={`h-${source}`} className="bg-surface-overlay/20">
                            <td colSpan={3 + DAY_LABELS.length} className="px-4 py-1"><SourceBadge source={source} /></td>
                          </tr>
                          {groupedColumns[source].map(([key, col]) => (
                            <tr key={key} className={`border-b border-border/30 last:border-0 hover:bg-surface-overlay/30 ${!col.enabled ? 'opacity-50' : ''}`}>
                              <td className="px-4 py-1.5"><span className="text-xs font-display font-medium text-text-primary">{col.label}</span></td>
                              <td className="px-4 py-1.5 text-center"><SourceBadge source={col.source} /></td>
                              <td className="px-4 py-1.5 text-center"><div className="flex justify-center"><Toggle checked={col.enabled} onChange={() => toggleColumn(key)} /></div></td>
                              {DAY_LABELS.map((_, dayIndex) => (
                                <td key={dayIndex} className="px-1 py-1.5 text-center">
                                  <button type="button" onClick={() => toggleColumnDay(key, dayIndex)}
                                    className={`w-6 h-6 rounded text-[10px] font-display font-semibold transition-colors ${col.days.includes(dayIndex) ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-surface text-text-muted/40 border border-border hover:border-border-bright'}`}>
                                    {DAY_LABELS[dayIndex]}
                                  </button>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sources */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-display font-semibold text-text-primary">Fuentes</h3>
                  <button type="button" onClick={() => setShowAddSource(!showAddSource)}
                    className="flex items-center gap-1 px-2 py-1 bg-accent/15 text-accent border border-accent/30 rounded text-[10px] font-display font-medium hover:bg-accent/25 transition-colors">
                    + Agregar
                  </button>
                </div>

                {showAddSource && (
                  <div className="bg-surface-raised border border-accent/30 rounded-lg p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="Nombre" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                        className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50" />
                      <input placeholder="URL" value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })}
                        className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50" />
                      <select value={newSource.source_type} onChange={(e) => setNewSource({ ...newSource, source_type: e.target.value })} aria-label="Tipo de fuente"
                        className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/50">
                        {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                      </select>
                      <input placeholder="Seccion" value={newSource.section} onChange={(e) => setNewSource({ ...newSource, section: e.target.value })}
                        className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50" />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setShowAddSource(false)} className="px-2 py-1 text-[10px] text-text-muted hover:text-text-primary">Cancelar</button>
                      <button type="button" onClick={handleAddSource} className="px-2 py-1 bg-accent/20 text-accent border border-accent/30 rounded text-[10px] font-medium hover:bg-accent/30">Agregar</button>
                    </div>
                  </div>
                )}

                <div className="bg-surface-raised border border-border rounded-lg overflow-hidden">
                  {sources.length === 0 ? (
                    <div className="p-6 text-center text-text-muted text-xs">No hay fuentes configuradas</div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {sources.map((src) => (
                        <div key={src.name} className={`flex items-center gap-3 px-4 py-2 hover:bg-surface-overlay/30 ${!src.active ? 'opacity-50' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-display font-medium text-text-primary">{src.name}</div>
                            <div className="text-[10px] text-text-muted font-mono truncate">{src.url}</div>
                          </div>
                          <span className="inline-block px-1.5 py-0.5 text-[9px] font-display font-semibold uppercase rounded border bg-purple-500/20 text-purple-400 border-purple-500/30">{src.source_type}</span>
                          <span className="text-[10px] text-text-muted w-16 text-center">{src.section || '-'}</span>
                          <Toggle checked={src.active} onChange={() => handleToggleSource(src)} />
                          <button type="button" onClick={() => handleDeleteSource(src.name)} className="text-red-400/60 hover:text-red-400" title="Eliminar">
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M2 4h10M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M9 7v4M5 7v4M3 4l.5 7.5a1 1 0 001 .5h5a1 1 0 001-.5L11 4" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Newsletter content */}
      <div className="flex-1 min-h-0">
        {displayHtml ? (
          <iframe
            ref={iframeRef}
            title="Newsletter"
            className="w-full h-full border-0"
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <rect x="8" y="4" width="32" height="40" rx="2" />
              <path d="M16 14h16M16 20h16M16 26h10" />
            </svg>
            <p className="text-sm">No hay newsletters generados</p>
            <button type="button" onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40">
              {generating ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-accent border-t-transparent" /> : null}
              {generating ? 'Generando...' : 'Generar primer newsletter'}
            </button>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg border shadow-lg font-display text-sm transition-all ${
          toast.type === 'success' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'
        }`}>{toast.message}</div>
      )}
    </div>
  );
}
