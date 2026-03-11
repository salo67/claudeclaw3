import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../lib/ThemeContext';
import { themes, type ThemeId } from '../lib/themes';

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = themes.find((t) => t.id === theme)!;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-display
                   border border-border hover:border-border-bright
                   bg-surface-raised hover:bg-surface-overlay
                   text-text-secondary hover:text-text-primary
                   transition-all duration-150"
        style={{ borderRadius: 'var(--theme-radius, 4px)' }}
        aria-label="Select theme"
        aria-expanded={open}
      >
        {/* Mini color swatch */}
        <span className="flex gap-0.5">
          <span
            className="w-2.5 h-2.5 border border-current/20"
            style={{ background: current.preview.bg, borderRadius: 'var(--theme-radius, 2px)' }}
          />
          <span
            className="w-2.5 h-2.5 border border-current/20"
            style={{ background: current.preview.accent, borderRadius: 'var(--theme-radius, 2px)' }}
          />
        </span>
        <span>{current.name}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="2,4 5,7 8,4" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-64 z-50 border border-border bg-surface-raised overflow-hidden"
          style={{
            borderRadius: 'var(--theme-radius, 4px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          <div className="px-3 py-2 border-b border-border">
            <span className="text-[10px] font-display text-text-muted uppercase tracking-widest">
              Theme
            </span>
          </div>

          <div className="py-1">
            {themes.map((t) => (
              <ThemeOption
                key={t.id}
                theme={t}
                active={theme === t.id}
                onSelect={(id) => {
                  setTheme(id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeOption({
  theme: t,
  active,
  onSelect,
}: {
  theme: (typeof themes)[number];
  active: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  return (
    <button
      onClick={() => onSelect(t.id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
        ${active
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-secondary hover:bg-surface-overlay/50 hover:text-text-primary'
        }`}
    >
      {/* 4-color mini palette */}
      <div
        className="flex-shrink-0 w-8 h-8 grid grid-cols-2 grid-rows-2 overflow-hidden border"
        style={{
          borderColor: t.preview.border,
          borderRadius: 'var(--theme-radius, 2px)',
          borderWidth: t.id === 'neobrutalist' ? '2px' : '1px',
        }}
      >
        <span style={{ background: t.preview.bg }} />
        <span style={{ background: t.preview.accent }} />
        <span style={{ background: t.preview.text }} />
        <span style={{ background: t.preview.border }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-display font-bold leading-tight">{t.name}</div>
        <div className="text-[10px] text-text-muted leading-tight">{t.tagline}</div>
      </div>

      {active && (
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-accent flex-shrink-0"
        >
          <polyline points="3,7 6,10 11,4" />
        </svg>
      )}
    </button>
  );
}
