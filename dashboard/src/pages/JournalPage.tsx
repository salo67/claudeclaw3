import { useState, useEffect, useCallback, useRef } from 'react';
import { journal } from '../lib/api';
import type { JournalEntry } from '../lib/types';

const MOODS = [
  { key: '', label: '—', color: '' },
  { key: 'great', label: 'Excelente', color: '#22c55e' },
  { key: 'good', label: 'Bien', color: '#3b82f6' },
  { key: 'neutral', label: 'Neutral', color: '#a3a3a3' },
  { key: 'stressed', label: 'Estresado', color: '#f59e0b' },
  { key: 'bad', label: 'Mal', color: '#ef4444' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(date: string) {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function addDays(date: string, n: number) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function JournalPage() {
  const [date, setDate] = useState(todayStr());
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptOpen, setPromptOpen] = useState(true);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [calDates, setCalDates] = useState<Set<string>>(new Set());
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [recentEntries, setRecentEntries] = useState<JournalEntry[]>([]);
  const [journalSearch, setJournalSearch] = useState('');
  const [filterMood, setFilterMood] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load entry for date
  const loadEntry = useCallback(async () => {
    try {
      const e = await journal.get(date);
      setEntry(e);
      setContent(e.content);
      setMood(e.mood);
      setTags(e.tags);
    } catch {
      setEntry(null);
      setContent('');
      setMood('');
      setTags('');
    }
  }, [date]);

  useEffect(() => { loadEntry(); }, [loadEntry]);

  // Load calendar dates
  useEffect(() => {
    journal.dates(calMonth.year, calMonth.month + 1).then((dates) =>
      setCalDates(new Set(dates))
    );
  }, [calMonth]);

  // Load recent entries
  useEffect(() => {
    journal.list(20, 0).then(setRecentEntries).catch(() => {});
  }, [entry]);

  const filteredEntries = recentEntries.filter((e) => {
    if (journalSearch) {
      const q = journalSearch.toLowerCase();
      if (!e.content.toLowerCase().includes(q) && !e.tags.toLowerCase().includes(q) && !e.date.includes(q)) {
        return false;
      }
    }
    if (filterMood && e.mood !== filterMood) return false;
    return true;
  });

  // Load prompt
  const loadPrompt = useCallback(async () => {
    setPromptLoading(true);
    try {
      const res = await journal.prompt();
      setPrompt(res.prompt);
    } catch {
      setPrompt('¿Qué es lo más importante hoy?');
    }
    setPromptLoading(false);
  }, []);

  useEffect(() => { loadPrompt(); }, [loadPrompt]);

  // Auto-save
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await journal.upsert(date, { content, mood, tags });
      setEntry(updated);
      setCalDates((prev) => new Set([...prev, date]));
    } catch { /* silent */ }
    setSaving(false);
  }, [date, content, mood, tags]);

  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 500);
  }, [save]);

  // Summary
  const loadSummary = async (weeks = 1) => {
    setSummaryLoading(true);
    setSummary('');
    try {
      const res = await journal.summary(weeks);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              if (data.text !== undefined && !line.includes('"event":"done"')) {
                // For delta events, append the chunk
              }
            } catch { /* skip */ }
          }
          if (line.startsWith('event: delta')) {
            // Next data line has the text
          }
          if (line.startsWith('data:') && !line.includes('"error"')) {
            try {
              const parsed = JSON.parse(line.slice(5).trim());
              if (parsed.text) {
                setSummary((prev) => prev + parsed.text);
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* silent */ }
    setSummaryLoading(false);
  };

  // Mini calendar
  const calendarDays = () => {
    const first = new Date(calMonth.year, calMonth.month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
    const cells: { day: number; dateStr: string }[] = [];
    for (let i = 0; i < startDay; i++) cells.push({ day: 0, dateStr: '' });
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, dateStr: ds });
    }
    return cells;
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deleteEntry = async () => {
    try {
      await journal.delete(date);
      setEntry(null);
      setContent('');
      setMood('');
      setTags('');
      setCalDates((prev) => { const next = new Set(prev); next.delete(date); return next; });
      setShowDeleteConfirm(false);
    } catch { /* silent */ }
  };

  const isToday = date === todayStr();

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Left panel — calendar + entries */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-surface-raised">
        {/* Date nav */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setDate(addDays(date, -1))}
              title="Día anterior"
              className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4l-4 4 4 4"/></svg>
            </button>
            <button
              onClick={() => setDate(todayStr())}
              className={`px-3 py-1 text-xs font-display rounded-md transition-colors ${
                isToday ? 'bg-accent text-black' : 'text-text-secondary hover:text-accent border border-border'
              }`}
            >
              Hoy
            </button>
            <button
              onClick={() => setDate(addDays(date, 1))}
              title="Día siguiente"
              className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4l4 4-4 4"/></svg>
            </button>
          </div>
          <p className="text-center text-sm font-display text-text-primary capitalize">
            {formatDateLabel(date)}
          </p>
        </div>

        {/* Mini calendar */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setCalMonth((m) => {
                const d = new Date(m.year, m.month - 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })}
              className="text-text-muted hover:text-text-primary text-xs"
            >
              ‹
            </button>
            <span className="text-xs font-display text-text-secondary capitalize">
              {new Date(calMonth.year, calMonth.month).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            </span>
            <button
              onClick={() => setCalMonth((m) => {
                const d = new Date(m.year, m.month + 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })}
              className="text-text-muted hover:text-text-primary text-xs"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {['D','L','M','X','J','V','S'].map((d) => (
              <span key={d} className="text-[10px] text-text-muted font-display">{d}</span>
            ))}
            {calendarDays().map((cell, i) => (
              <button
                key={i}
                disabled={cell.day === 0}
                onClick={() => cell.dateStr && setDate(cell.dateStr)}
                className={`text-[11px] py-0.5 rounded transition-colors relative ${
                  cell.day === 0
                    ? ''
                    : cell.dateStr === date
                    ? 'bg-accent text-black font-bold'
                    : cell.dateStr === todayStr()
                    ? 'text-accent font-bold hover:bg-surface-overlay'
                    : 'text-text-secondary hover:bg-surface-overlay'
                }`}
              >
                {cell.day || ''}
                {calDates.has(cell.dateStr) && cell.dateStr !== date && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent/80" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Summary section */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-display text-text-secondary">Resumen</span>
            <button
              onClick={() => loadSummary(1)}
              disabled={summaryLoading}
              className="px-2 py-0.5 text-[10px] font-display border border-border rounded text-text-muted hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
            >
              1 sem
            </button>
            <button
              onClick={() => loadSummary(4)}
              disabled={summaryLoading}
              className="px-2 py-0.5 text-[10px] font-display border border-border rounded text-text-muted hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
            >
              1 mes
            </button>
          </div>
          {summary && (
            <div className="text-xs text-text-secondary max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {summary}
            </div>
          )}
          {summaryLoading && !summary && (
            <div className="text-xs text-text-muted animate-pulse">Analizando...</div>
          )}
        </div>

        {/* Mood legend */}
        <div className="p-3">
          <span className="text-xs font-display text-text-muted mb-2 block">Estado de ánimo</span>
          <div className="flex flex-wrap gap-1.5">
            {MOODS.filter((m) => m.key).map((m) => (
              <button
                key={m.key}
                onClick={() => { setMood(m.key); setTimeout(save, 50); }}
                className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                  mood === m.key
                    ? 'border-current font-bold'
                    : 'border-border/50 text-text-muted hover:text-text-primary'
                }`}
                style={mood === m.key ? { color: m.color, borderColor: m.color } : {}}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Recent entries list */}
        <div className="border-t border-border flex flex-col flex-1 min-h-0">
          <div className="p-3 border-b border-border/50 space-y-2">
            <input
              type="text"
              value={journalSearch}
              onChange={(e) => setJournalSearch(e.target.value)}
              placeholder="Buscar entradas..."
              className="w-full px-3 py-1.5 text-xs bg-surface-base border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex flex-wrap gap-1">
              {MOODS.filter((m) => m.key).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setFilterMood(filterMood === m.key ? '' : m.key)}
                  className={`px-1.5 py-0.5 text-[9px] rounded-full border transition-colors ${
                    filterMood === m.key ? 'font-bold' : 'border-border/40 text-text-muted hover:text-text-primary'
                  }`}
                  style={filterMood === m.key ? { color: m.color, borderColor: m.color } : {}}
                >
                  {m.label}
                </button>
              ))}
              {(filterMood || journalSearch) && (
                <button
                  onClick={() => { setFilterMood(''); setJournalSearch(''); }}
                  className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-accent transition-colors"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredEntries.map((e) => (
              <button
                key={e.date}
                onClick={() => setDate(e.date)}
                className={`w-full text-left px-3 py-2 border-b border-border/30 transition-colors ${
                  e.date === date
                    ? 'bg-surface-overlay border-l-2 border-l-accent'
                    : 'hover:bg-surface-overlay/50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                  <span className="text-xs font-display text-text-primary">{e.date}</span>
                  {e.mood && (
                    <span
                      className="text-[10px] px-1.5 rounded-full border"
                      style={{ color: MOODS.find((m) => m.key === e.mood)?.color, borderColor: MOODS.find((m) => m.key === e.mood)?.color + '40' }}
                    >
                      {MOODS.find((m) => m.key === e.mood)?.label}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-muted mt-0.5 truncate pl-3">
                  {e.content.slice(0, 60) || 'Entrada vacía'}
                </p>
                {e.tags && (
                  <span className="text-[10px] text-accent/60 truncate block mt-0.5">{e.tags}</span>
                )}
              </button>
            ))}
            {filteredEntries.length === 0 && (
              <div className="p-3 text-center text-text-muted text-xs">
                {journalSearch ? 'Sin resultados' : 'Sin entradas recientes'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {/* Bot prompt */}
        {promptOpen && (
          <div className="mx-4 mt-4 mb-2 p-3 rounded-lg bg-surface-overlay border border-border/50">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <span className="text-[10px] font-display text-accent uppercase tracking-wider">Reflexión del día</span>
                {promptLoading ? (
                  <p className="text-sm text-text-muted mt-1 animate-pulse">Pensando...</p>
                ) : (
                  <p className="text-sm text-text-primary mt-1 font-display">{prompt}</p>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={loadPrompt}
                  className="p-1 text-text-muted hover:text-accent transition-colors"
                  title="Otra pregunta"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 7a6 6 0 1011 3.2M1 7V3M1 7h4"/>
                  </svg>
                </button>
                <button
                  onClick={() => setPromptOpen(false)}
                  title="Cerrar"
                  className="p-1 text-text-muted hover:text-text-primary transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M3 3l8 8M11 3l-8 8"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
          <span className="text-sm font-display text-text-primary capitalize flex-1">
            {formatDateLabel(date)}
          </span>
          {mood && (
            <span
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{ color: MOODS.find((m) => m.key === mood)?.color, borderColor: MOODS.find((m) => m.key === mood)?.color }}
            >
              {MOODS.find((m) => m.key === mood)?.label}
            </span>
          )}
          {saving && <span className="text-xs text-text-muted">Guardando...</span>}
          {entry && !showDeleteConfirm && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-2 py-0.5 text-xs text-red-400 border border-red-400/30 rounded-md hover:bg-red-400/10 transition-colors"
            >
              Borrar
            </button>
          )}
          {showDeleteConfirm && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-400">¿Seguro?</span>
              <button
                onClick={deleteEntry}
                className="px-2 py-0.5 text-xs text-red-400 border border-red-400 rounded-md bg-red-400/10 hover:bg-red-400/20 transition-colors"
              >
                Sí
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2 py-0.5 text-xs text-text-muted border border-border rounded-md hover:text-text-primary transition-colors"
              >
                No
              </button>
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="px-4 py-1.5 border-b border-border/50">
          <input
            type="text"
            value={tags}
            onChange={(e) => { setTags(e.target.value); scheduleAutoSave(); }}
            placeholder="Tags: reflexion, decision, HD, flujo"
            className="w-full text-xs bg-transparent text-text-secondary placeholder:text-text-muted focus:outline-none"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); scheduleAutoSave(); }}
            placeholder="¿Cómo va el día? Escribe libremente..."
            className="w-full h-full p-6 text-sm bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center gap-3 text-xs text-text-muted">
          {entry && (
            <>
              <span>{content.length} caracteres</span>
              <span>·</span>
              <span>Última edición: {new Date(entry.updated_at * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
            </>
          )}
          {!entry && content.length === 0 && (
            <span>Sin entrada para esta fecha</span>
          )}
          {!promptOpen && (
            <button onClick={() => setPromptOpen(true)} className="ml-auto text-accent hover:underline">
              Ver reflexión
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
