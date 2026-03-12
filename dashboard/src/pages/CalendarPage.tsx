import { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────

interface CalEvent {
  id: number;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string | null;
  all_day: boolean;
  color: string;
  source: string;
}

type View = 'month' | 'week' | 'agenda';

const SOURCE_COLORS: Record<string, string> = {
  manual: '#3B82F6',
  todo: '#F97316',
  google: '#22C55E',
};

async function fetchJournalDates(year: number, month: number): Promise<Set<string>> {
  try {
    const res = await fetch(`/api/journal/dates?year=${year}&month=${month + 1}`);
    if (!res.ok) return new Set();
    const dates: string[] = await res.json();
    return new Set(dates);
  } catch {
    return new Set();
  }
}

const DAY_NAMES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

// ── API ──────────────────────────────────────────────────────

const CAL_API = '/cal-api';

async function fetchEvents(start: string, end: string): Promise<CalEvent[]> {
  const res = await fetch(`${CAL_API}/events?start=${start}&end=${end}`);
  if (!res.ok) return [];
  return res.json();
}

async function createEvent(data: {
  title: string;
  start_datetime: string;
  end_datetime?: string;
  all_day?: boolean;
  color?: string;
}): Promise<CalEvent | null> {
  const res = await fetch(`${CAL_API}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

async function quickAdd(text: string): Promise<CalEvent | null> {
  const res = await fetch(`${CAL_API}/events/quick-add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────

function getMonthDays(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // Monday=0
  const days: { date: Date; inMonth: boolean }[] = [];

  // Fill previous month
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, inMonth: false });
  }
  // Current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ date: new Date(year, month, i), inMonth: true });
  }
  // Fill next month to complete grid
  while (days.length % 7 !== 0) {
    const d = new Date(year, month + 1, days.length - daysInMonth - startDay + 1);
    days.push({ date: d, inMonth: false });
  }
  return days;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtTime(dt: string): string {
  return dt.slice(11, 16);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getWeekDays(date: Date): Date[] {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const nd = new Date(d);
    nd.setDate(d.getDate() + i);
    return nd;
  });
}

// ── Journal Entry type ───────────────────────────────────────

interface JournalEntry {
  id: string;
  date: string;
  content: string;
  mood: string | null;
  tags: string;
}

// ── Components ───────────────────────────────────────────────

function EventPill({ event }: { event: CalEvent }) {
  const color = SOURCE_COLORS[event.source] || event.color || '#3B82F6';
  return (
    <div
      className="text-[10px] leading-tight px-1.5 py-0.5 rounded truncate cursor-default"
      style={{ backgroundColor: color + '25', color, borderLeft: `2px solid ${color}` }}
      title={`${event.title}${event.all_day ? '' : ' ' + fmtTime(event.start_datetime)}`}
    >
      {!event.all_day && <span className="font-semibold mr-1">{fmtTime(event.start_datetime)}</span>}
      {event.title}
    </div>
  );
}

// ── Month View ───────────────────────────────────────────────

function JournalPopover({ date, onClose }: { date: string; onClose: () => void }) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/journal/${date}`);
        if (res.ok) setEntry(await res.json());
        else setNotFound(true);
      } catch { setNotFound(true); }
      setLoading(false);
    })();
  }, [date]);

  const moodEmoji: Record<string, string> = {
    great: '😊', good: '🙂', neutral: '😐', bad: '😕', terrible: '😣',
    energized: '⚡', focused: '🎯', stressed: '😤', calm: '🧘',
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] max-h-[420px] bg-surface-raised rounded-2xl border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-amber-400/5">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="text-amber-400">
              <path d="M3 1.5h6a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75v-7.5A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1" />
              <path d="M4.5 4h3M4.5 5.5h2M4.5 7h2.5" stroke="currentColor" strokeWidth=".75" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-display font-semibold text-text-primary">Journal</span>
            <span className="text-xs text-text-muted">{date}</span>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-sm px-1">✕</button>
        </div>
        <div className="px-4 py-3 overflow-y-auto max-h-[340px]">
          {loading && <div className="text-center text-text-muted text-sm py-6">Cargando...</div>}
          {notFound && <div className="text-center text-text-muted text-sm py-6">Sin entrada para este dia.</div>}
          {entry && (
            <div className="space-y-3">
              {entry.mood && (
                <div className="flex items-center gap-2">
                  <span className="text-lg">{moodEmoji[entry.mood] || '📝'}</span>
                  <span className="text-xs text-text-secondary font-display capitalize">{entry.mood}</span>
                </div>
              )}
              <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                {entry.content}
              </div>
              {entry.tags && (
                <div className="flex gap-1.5 flex-wrap pt-1">
                  {entry.tags.split(',').filter(Boolean).map((tag) => (
                    <span key={tag.trim()} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthView({
  year, month, events, today, onDayClick, journalDates, onJournalClick,
}: {
  year: number;
  month: number;
  events: CalEvent[];
  today: Date;
  onDayClick: (date: Date) => void;
  journalDates: Set<string>;
  onJournalClick: (date: string) => void;
}) {
  const days = getMonthDays(year, month);

  function eventsForDay(d: Date): CalEvent[] {
    const ds = fmt(d);
    return events.filter((e) => e.start_datetime.slice(0, 10) === ds);
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-px mb-px">
        {DAY_NAMES.map((n) => (
          <div key={n} className="text-center text-xs font-display text-text-muted py-2">{n}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
        {days.map(({ date: d, inMonth }, i) => {
          const isToday = isSameDay(d, today);
          const dayEvents = eventsForDay(d);
          const hasJournal = journalDates.has(fmt(d));
          return (
            <div
              key={i}
              onClick={() => onDayClick(d)}
              className={`bg-surface min-h-[90px] p-1.5 cursor-pointer transition-colors hover:bg-surface-overlay ${
                !inMonth ? 'opacity-40' : ''
              }`}
            >
              <div className="flex items-center gap-1 mb-1">
                <div className={`text-xs font-display ${
                  isToday
                    ? 'bg-accent text-surface w-5 h-5 rounded-full flex items-center justify-center font-bold'
                    : 'text-text-secondary'
                }`}>
                  {d.getDate()}
                </div>
                {hasJournal && (
                  <button
                    type="button"
                    title="Ver journal"
                    onClick={(e) => { e.stopPropagation(); onJournalClick(fmt(d)); }}
                    className="hover:scale-125 transition-transform"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-amber-400 flex-shrink-0">
                      <path d="M3 1.5h6a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75v-7.5A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1" />
                      <path d="M4.5 4h3M4.5 5.5h2M4.5 7h2.5" stroke="currentColor" strokeWidth=".75" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((ev) => (
                  <EventPill key={`${ev.id}-${ev.source}`} event={ev} />
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-text-muted pl-1">+{dayEvents.length - 3} mas</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week View ────────────────────────────────────────────────

function WeekView({
  weekStart, events, today,
}: {
  weekStart: Date;
  events: CalEvent[];
  today: Date;
}) {
  const days = getWeekDays(weekStart);
  const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7am-22pm

  function timedEventsForDay(d: Date): (CalEvent & { startHour: number; endHour: number })[] {
    const ds = fmt(d);
    return events
      .filter((e) => e.start_datetime.slice(0, 10) === ds && !e.all_day)
      .map((e) => {
        const sh = parseInt(e.start_datetime.slice(11, 13)) + parseInt(e.start_datetime.slice(14, 16)) / 60;
        const eh = e.end_datetime
          ? parseInt(e.end_datetime.slice(11, 13)) + parseInt(e.end_datetime.slice(14, 16)) / 60
          : sh + 1;
        return { ...e, startHour: sh, endHour: eh };
      });
  }

  function allDayForDay(d: Date): CalEvent[] {
    const ds = fmt(d);
    return events.filter((e) => e.start_datetime.slice(0, 10) === ds && e.all_day);
  }

  return (
    <div className="overflow-x-auto">
      {/* Header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px mb-px">
        <div />
        {days.map((d) => (
          <div
            key={fmt(d)}
            className={`text-center py-2 ${isSameDay(d, today) ? 'text-accent font-bold' : 'text-text-secondary'}`}
          >
            <div className="text-xs font-display">{DAY_NAMES[(d.getDay() + 6) % 7]}</div>
            <div className="text-lg font-display">{d.getDate()}</div>
          </div>
        ))}
      </div>

      {/* All-day row */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px bg-border mb-px">
        <div className="bg-surface text-[10px] text-text-muted p-1 text-right">Todo el dia</div>
        {days.map((d) => (
          <div key={fmt(d)} className="bg-surface p-1 min-h-[28px] space-y-0.5">
            {allDayForDay(d).map((ev) => (
              <EventPill key={`${ev.id}-${ev.source}`} event={ev} />
            ))}
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px bg-border rounded-md overflow-hidden relative">
        {hours.map((h) => (
          <div key={h} className="contents">
            <div className="bg-surface text-[10px] text-text-muted text-right pr-2 py-2 h-12">
              {h}:00
            </div>
            {days.map((d) => {
              const dayEvents = timedEventsForDay(d);
              return (
                <div key={fmt(d)} className="bg-surface h-12 relative border-t border-border/30">
                  {dayEvents
                    .filter((e) => Math.floor(e.startHour) === h)
                    .map((e) => {
                      const top = (e.startHour - h) * 48;
                      const height = Math.max((e.endHour - e.startHour) * 48, 20);
                      const color = SOURCE_COLORS[e.source] || e.color || '#3B82F6';
                      return (
                        <div
                          key={`${e.id}-${e.source}`}
                          className="absolute left-0.5 right-0.5 rounded text-[10px] px-1 overflow-hidden z-10"
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            backgroundColor: color + '30',
                            borderLeft: `2px solid ${color}`,
                            color,
                          }}
                          title={`${e.title} ${fmtTime(e.start_datetime)}-${e.end_datetime ? fmtTime(e.end_datetime) : ''}`}
                        >
                          <span className="font-semibold">{fmtTime(e.start_datetime)}</span> {e.title}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agenda View ──────────────────────────────────────────────

function AgendaView({
  fromDate, events, today,
}: {
  fromDate: Date;
  events: CalEvent[];
  today: Date;
}) {
  const days: Date[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const sorted = [...events].sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));

  return (
    <div className="space-y-1">
      {days.map((d) => {
        const ds = fmt(d);
        const dayEvents = sorted.filter((e) => e.start_datetime.slice(0, 10) === ds);
        const isToday = isSameDay(d, today);

        return (
          <div key={ds}>
            <div className={`flex items-center gap-3 py-2 px-3 rounded-md ${isToday ? 'bg-accent/10' : ''}`}>
              <div className={`text-sm font-display font-bold ${isToday ? 'text-accent' : 'text-text-secondary'}`}>
                {d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
              {dayEvents.length === 0 && (
                <span className="text-text-muted text-xs">Sin eventos</span>
              )}
            </div>
            {dayEvents.length > 0 && (
              <div className="ml-4 space-y-1 mb-2">
                {dayEvents.map((ev) => {
                  const color = SOURCE_COLORS[ev.source] || ev.color || '#3B82F6';
                  return (
                    <div
                      key={`${ev.id}-${ev.source}`}
                      className="flex items-start gap-3 p-2 rounded-md bg-surface-raised"
                    >
                      <div
                        className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                        style={{ backgroundColor: color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary font-display">{ev.title}</div>
                        <div className="text-xs text-text-muted">
                          {ev.all_day ? 'Todo el dia' : `${fmtTime(ev.start_datetime)}${ev.end_datetime ? ' - ' + fmtTime(ev.end_datetime) : ''}`}
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
                            style={{ backgroundColor: color + '20', color }}
                          >
                            {ev.source}
                          </span>
                        </div>
                        {ev.description && (
                          <div className="text-xs text-text-muted mt-1 line-clamp-2">{ev.description}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Quick Add Bar ────────────────────────────────────────────

function QuickAddBar({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    const result = await quickAdd(text.trim());
    if (result) {
      setText('');
      onCreated();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Agregar evento... (ej: Junta manana 10am)"
        className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
      />
      <button
        type="submit"
        disabled={!text.trim() || loading}
        className="bg-accent text-surface rounded-md px-4 py-2 font-display font-semibold text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
      >
        {loading ? '...' : 'Agregar'}
      </button>
    </form>
  );
}

// ── Main Page ────────────────────────────────────────────────

export default function CalendarPage() {
  const [view, setView] = useState<View>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [journalDates, setJournalDates] = useState<Set<string>>(new Set());
  const [journalPopoverDate, setJournalPopoverDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const today = new Date();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const loadEvents = useCallback(async () => {
    setLoading(true);
    let start: string, end: string;

    if (view === 'month') {
      const first = new Date(year, month, 1);
      const startDay = (first.getDay() + 6) % 7;
      const s = new Date(year, month, 1 - startDay);
      const e = new Date(year, month + 1, 0);
      const endDay = 6 - ((e.getDay() + 6) % 7);
      const eEnd = new Date(year, month + 1, endDay);
      start = fmt(s) + 'T00:00:00';
      end = fmt(eEnd) + 'T23:59:59';
    } else if (view === 'week') {
      const days = getWeekDays(currentDate);
      start = fmt(days[0]) + 'T00:00:00';
      end = fmt(days[6]) + 'T23:59:59';
    } else {
      start = fmt(currentDate) + 'T00:00:00';
      const e = new Date(currentDate);
      e.setDate(e.getDate() + 14);
      end = fmt(e) + 'T23:59:59';
    }

    const [data, jDates] = await Promise.all([
      fetchEvents(start, end),
      fetchJournalDates(year, month),
    ]);
    setEvents(data);
    setJournalDates(jDates);
    setLoading(false);
  }, [view, year, month, currentDate]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  function navigate(dir: -1 | 1) {
    const d = new Date(currentDate);
    if (view === 'month') {
      d.setMonth(d.getMonth() + dir);
    } else if (view === 'week') {
      d.setDate(d.getDate() + dir * 7);
    } else {
      d.setDate(d.getDate() + dir * 14);
    }
    setCurrentDate(d);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  function getTitle(): string {
    if (view === 'month') return `${monthNames[month]} ${year}`;
    if (view === 'week') {
      const days = getWeekDays(currentDate);
      return `${days[0].getDate()} - ${days[6].getDate()} ${monthNames[days[0].getMonth()]} ${days[0].getFullYear()}`;
    }
    return `Agenda desde ${currentDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 animate-fade-in">
        <h1 className="font-display text-2xl text-accent">Calendario</h1>
        <div className="flex items-center gap-2">
          {/* View switcher */}
          {(['month', 'week', 'agenda'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-display transition-colors ${
                view === v
                  ? 'bg-accent text-surface'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
              }`}
            >
              {v === 'month' ? 'Mes' : v === 'week' ? 'Semana' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      {/* Quick add */}
      <div className="mb-4 animate-fade-in" style={{ animationDelay: '50ms' }}>
        <QuickAddBar onCreated={loadEvents} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mb-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4l-5 5 5 5" />
            </svg>
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1 rounded-md text-xs font-display text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors border border-border"
          >
            Hoy
          </button>
          <button
            onClick={() => navigate(1)}
            className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4l5 5-5 5" />
            </svg>
          </button>
          <h2 className="font-display text-lg text-text-primary ml-2">{getTitle()}</h2>
        </div>

        {/* Source legend */}
        <div className="flex items-center gap-3">
          {Object.entries(SOURCE_COLORS).map(([source, color]) => (
            <div key={source} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-text-muted font-display">{source}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="text-amber-400">
              <path d="M3 1.5h6a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75v-7.5A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1" />
              <path d="M4.5 4h3M4.5 5.5h2M4.5 7h2.5" stroke="currentColor" strokeWidth=".75" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-text-muted font-display">journal</span>
          </div>
        </div>
      </div>

      {/* Calendar content */}
      {loading ? (
        <div className="text-text-muted text-center py-20 font-display text-sm animate-fade-in">Cargando...</div>
      ) : (
        <div className="animate-fade-in" style={{ animationDelay: '150ms' }}>
          {view === 'month' && (
            <MonthView
              year={year}
              month={month}
              events={events}
              today={today}
              journalDates={journalDates}
              onJournalClick={(date) => setJournalPopoverDate(date)}
              onDayClick={(d) => {
                setCurrentDate(d);
                setView('week');
              }}
            />
          )}
          {view === 'week' && (
            <WeekView weekStart={currentDate} events={events} today={today} />
          )}
          {view === 'agenda' && (
            <AgendaView fromDate={currentDate} events={events} today={today} />
          )}
        </div>
      )}

      {journalPopoverDate && (
        <JournalPopover date={journalPopoverDate} onClose={() => setJournalPopoverDate(null)} />
      )}
    </div>
  );
}
