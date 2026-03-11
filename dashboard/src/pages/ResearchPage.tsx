import { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API = '/api/research';

interface ResearchReport {
  id: string;
  query: string;
  model: string;
  status: 'running' | 'done' | 'error';
  content_md: string;
  sources: string[];
  cost_usd: number;
  error: string;
  created_at: number;
  completed_at: number | null;
}

type ListReport = Omit<ResearchReport, 'content_md' | 'sources'>;

export default function ResearchPage() {
  const [reports, setReports] = useState<ListReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [model, setModel] = useState<'sonar' | 'sonar-deep-research'>('sonar');
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ResearchReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(API);
      const data = await res.json();
      setReports(data);
    } catch (e) {
      console.error('Failed to fetch research reports', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Poll for running reports
  useEffect(() => {
    const hasRunning = reports.some((r) => r.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(fetchReports, 3000);
    return () => clearInterval(interval);
  }, [reports, fetchReports]);

  const submit = async () => {
    if (!query.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), model }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || 'Error launching research');
        return;
      }
      setQuery('');
      await fetchReports();
    } catch (e) {
      console.error('Failed to submit research', e);
    } finally {
      setSubmitting(false);
    }
  };

  const openReport = async (id: string) => {
    setSelectedId(id);
    setLoadingReport(true);
    try {
      const res = await fetch(`${API}/${id}`);
      const data = await res.json();
      data.sources = Array.isArray(data.sources) ? data.sources : JSON.parse(data.sources || '[]');
      setSelectedReport(data);
    } catch (e) {
      console.error('Failed to load report', e);
    } finally {
      setLoadingReport(false);
    }
  };

  const closeReport = () => {
    setSelectedId(null);
    setSelectedReport(null);
  };

  const downloadReport = (id: string) => {
    window.open(`${API}/${id}/download`, '_blank');
  };

  const deleteReport = async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    setReports((prev) => prev.filter((r) => r.id !== id));
    setConfirmDelete(null);
    if (selectedId === id) closeReport();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-text-primary tracking-tight">Research</h1>
        <p className="text-sm text-text-muted mt-1 font-body">
          Investigaciones profundas con Perplexity AI
        </p>
      </div>

      {/* Input zone */}
      <div className="bg-surface-raised border border-border rounded-lg p-4 space-y-3">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Que quieres investigar?  (Ctrl+Enter para lanzar)"
          className="w-full bg-surface border border-border rounded-md px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 resize-none font-body"
        />
        <div className="flex items-center justify-between">
          {/* Model toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModel('sonar')}
              className={`px-3 py-1.5 rounded-md text-xs font-display font-medium transition-colors ${
                model === 'sonar'
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-text-muted border border-border hover:text-text-secondary hover:border-border-bright'
              }`}
            >
              Rapido
            </button>
            <button
              onClick={() => setModel('sonar-deep-research')}
              className={`px-3 py-1.5 rounded-md text-xs font-display font-medium transition-colors ${
                model === 'sonar-deep-research'
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-text-muted border border-border hover:text-text-secondary hover:border-border-bright'
              }`}
            >
              Deep Research
            </button>
          </div>

          <button
            onClick={submit}
            disabled={!query.trim() || submitting}
            className="flex items-center gap-2 px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-accent border-t-transparent" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="5" />
                <path d="M14 14l-3.5-3.5" />
              </svg>
            )}
            Investigar
          </button>
        </div>
      </div>

      {/* History */}
      <div className="space-y-2">
        <h2 className="text-sm font-display font-semibold text-text-primary px-1">Historial</h2>
        {reports.length === 0 ? (
          <div className="text-center py-12 text-text-muted text-sm border border-dashed border-border rounded-lg">
            No hay investigaciones todavia
          </div>
        ) : (
          <div className="space-y-1.5">
            {reports.map((r) => (
              <div
                key={r.id}
                className="group bg-surface-raised border border-border rounded-lg hover:border-border-bright transition-all"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    {r.status === 'running' ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent border-t-transparent" />
                    ) : r.status === 'error' ? (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-red-400">
                        <circle cx="10" cy="10" r="8" />
                        <path d="M10 6v4M10 13v.5" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-status-active">
                        <circle cx="10" cy="10" r="8" />
                        <path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* Query text */}
                  <button
                    onClick={() => r.status === 'done' && openReport(r.id)}
                    className={`flex-1 min-w-0 text-left ${r.status === 'done' ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="text-sm font-display font-medium text-text-primary truncate">
                      {r.query}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-text-muted/60 bg-surface px-1.5 py-0.5 rounded">
                        {r.model === 'sonar-deep-research' ? 'deep' : 'rapido'}
                      </span>
                      <span className="text-xs text-text-muted">{formatDate(r.created_at)}</span>
                      {r.status === 'done' && r.cost_usd > 0 && (
                        <span className="text-[10px] text-text-muted/50">${r.cost_usd.toFixed(4)}</span>
                      )}
                      {r.status === 'error' && (
                        <span className="text-[10px] text-red-400 truncate max-w-[200px]">{r.error}</span>
                      )}
                    </div>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {r.status === 'done' && (
                      <button
                        onClick={() => downloadReport(r.id)}
                        className="p-1.5 text-text-muted hover:text-accent rounded transition-colors"
                        title="Descargar .md"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M7 2v8M4 7l3 3 3-3M2 12h10" />
                        </svg>
                      </button>
                    )}
                    {confirmDelete === r.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteReport(r.id)}
                          className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded font-display hover:bg-red-500/30 transition-colors"
                        >
                          Si
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 text-xs text-text-muted rounded hover:text-text-secondary transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(r.id)}
                        className="p-1.5 text-text-muted hover:text-red-400 rounded transition-colors"
                        title="Eliminar"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Report detail modal */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8" onClick={closeReport}>
          <div
            className="bg-surface-raised border border-border rounded-lg w-full max-w-3xl mx-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-display font-bold text-text-primary truncate">
                  {selectedReport?.query || 'Cargando...'}
                </h2>
                {selectedReport && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-text-muted/60 bg-surface px-1.5 py-0.5 rounded">
                      {selectedReport.model === 'sonar-deep-research' ? 'deep research' : 'rapido'}
                    </span>
                    <span className="text-xs text-text-muted">{formatDate(selectedReport.created_at)}</span>
                    {selectedReport.cost_usd > 0 && (
                      <span className="text-[10px] text-text-muted/50">${selectedReport.cost_usd.toFixed(4)}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                {selectedReport && (
                  <button
                    onClick={() => downloadReport(selectedReport.id)}
                    className="p-2 text-text-muted hover:text-accent rounded transition-colors"
                    title="Descargar .md"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M8 2v9M5 8l3 3 3-3M2 14h12" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={closeReport}
                  className="p-2 text-text-muted hover:text-text-secondary rounded transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
              {loadingReport ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
                </div>
              ) : selectedReport ? (
                <div className="prose prose-invert prose-sm max-w-none
                  prose-headings:font-display prose-headings:text-text-primary
                  prose-p:text-text-secondary prose-p:font-body
                  prose-a:text-accent prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-text-primary
                  prose-li:text-text-secondary
                  prose-code:text-accent prose-code:bg-surface prose-code:px-1 prose-code:rounded
                  prose-blockquote:border-accent/30 prose-blockquote:text-text-muted
                ">
                  <Markdown remarkPlugins={[remarkGfm]}>{selectedReport.content_md || '*Sin contenido*'}</Markdown>

                  {selectedReport.sources.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-border">
                      <h4 className="text-xs font-display font-semibold text-text-muted uppercase tracking-wider mb-2">Fuentes</h4>
                      <ul className="space-y-1">
                        {selectedReport.sources.map((url, i) => (
                          <li key={i} className="text-xs">
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate block">
                              {url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
