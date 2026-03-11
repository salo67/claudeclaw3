export type ThemeId = 'brutalist' | 'neobrutalist' | 'cyberpunk' | 'minimal' | 'terminal' | 'sumie' | 'aurora' | 'ember';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  preview: { bg: string; accent: string; text: string; border: string };
  vars: Record<string, string>;
}

export const themes: ThemeDefinition[] = [
  // ── 1. Brutalist ──────────────────────────────────────────────
  {
    id: 'brutalist',
    name: 'Brutalist',
    tagline: 'Raw & direct',
    preview: { bg: '#f0f0f0', accent: '#e91e7a', text: '#1a1a1a', border: '#1a1a1a' },
    vars: {
      '--color-surface': '#f0f0f0',
      '--color-surface-raised': '#ffffff',
      '--color-surface-overlay': '#e8e8e8',
      '--color-border': '#1a1a1a',
      '--color-border-bright': '#1a1a1a',
      '--color-accent': '#e91e7a',
      '--color-accent-dim': '#b8155f',
      '--color-text-primary': '#1a1a1a',
      '--color-text-secondary': '#4a4a4a',
      '--color-text-muted': '#8a8a8a',
      '--color-status-active': '#22c55e',
      '--color-status-paused': '#eab308',
      '--color-status-done': '#3b82f6',
      '--font-display': "'Courier New', 'Courier', monospace",
      '--font-body': "'Courier New', 'Courier', monospace",
      '--theme-radius': '0px',
      '--theme-border-width': '2px',
      '--theme-shadow': 'none',
      '--theme-glow': 'none',
      '--theme-bg-pattern': 'none',
      '--theme-scanline': 'none',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': 'none',
      '--theme-card-hover-shadow': 'none',
      '--theme-card-border': '#1a1a1a',
      '--theme-card-hover-border': '#1a1a1a',
    },
  },

  // ── 2. NeoBrutalist ───────────────────────────────────────────
  {
    id: 'neobrutalist',
    name: 'NeoBrutalist',
    tagline: 'Bold & playful',
    preview: { bg: '#f0ecf9', accent: '#6c3ce0', text: '#1a1a2e', border: '#1a1a2e' },
    vars: {
      '--color-surface': '#f0ecf9',
      '--color-surface-raised': '#faf8ff',
      '--color-surface-overlay': '#e4ddf2',
      '--color-border': '#1a1a2e',
      '--color-border-bright': '#1a1a2e',
      '--color-accent': '#6c3ce0',
      '--color-accent-dim': '#5228b5',
      '--color-text-primary': '#1a1a2e',
      '--color-text-secondary': '#4a4a5e',
      '--color-text-muted': '#8a8a9e',
      '--color-status-active': '#22c55e',
      '--color-status-paused': '#f59e0b',
      '--color-status-done': '#3b82f6',
      '--font-display': "'Space Mono', 'Courier New', monospace",
      '--font-body': "'Work Sans', 'Helvetica Neue', sans-serif",
      '--theme-radius': '0px',
      '--theme-border-width': '3px',
      '--theme-shadow': '4px 4px 0px #1a1a2e',
      '--theme-glow': 'none',
      '--theme-bg-pattern': 'none',
      '--theme-scanline': 'none',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': '4px 4px 0px #1a1a2e',
      '--theme-card-hover-shadow': '6px 6px 0px #6c3ce0',
      '--theme-card-border': '#1a1a2e',
      '--theme-card-hover-border': '#6c3ce0',
    },
  },

  // ── 3. CyberPunk Neon ─────────────────────────────────────────
  {
    id: 'cyberpunk',
    name: 'CyberPunk',
    tagline: 'Neon nights',
    preview: { bg: '#0a0014', accent: '#00fff5', text: '#00fff5', border: '#ff0080' },
    vars: {
      '--color-surface': '#0a0014',
      '--color-surface-raised': '#120024',
      '--color-surface-overlay': '#1a0033',
      '--color-border': '#1f0040',
      '--color-border-bright': '#ff008050',
      '--color-accent': '#00fff5',
      '--color-accent-dim': '#008b8b',
      '--color-text-primary': '#e0f7fa',
      '--color-text-secondary': '#80cbc4',
      '--color-text-muted': '#37474f',
      '--color-status-active': '#00ff41',
      '--color-status-paused': '#ff0080',
      '--color-status-done': '#00fff5',
      '--font-display': "'Orbitron', 'Rajdhani', sans-serif",
      '--font-body': "'Rajdhani', 'Exo 2', sans-serif",
      '--theme-radius': '2px',
      '--theme-border-width': '1px',
      '--theme-shadow': '0 0 15px #00fff530, 0 0 30px #00fff510',
      '--theme-glow': '0 0 8px #00fff540',
      '--theme-bg-pattern': 'repeating-linear-gradient(0deg, transparent, transparent 2px, #00fff503 2px, #00fff503 4px)',
      '--theme-scanline': 'repeating-linear-gradient(180deg, transparent 0px, rgba(0,255,245,0.03) 1px, transparent 2px, transparent 4px)',
      '--theme-card-transform': 'skewX(-0.5deg)',
      '--theme-card-shadow': '0 0 8px rgba(0,255,245,0.2), 0 0 20px rgba(0,255,245,0.08), inset 0 0 12px rgba(0,255,245,0.03)',
      '--theme-card-hover-shadow': '0 0 12px rgba(0,255,245,0.4), 0 0 35px rgba(0,255,245,0.15), inset 0 0 18px rgba(0,255,245,0.05)',
      '--theme-card-border': 'rgba(0,255,245,0.3)',
      '--theme-card-hover-border': 'rgba(0,255,245,0.6)',
    },
  },

  // ── 4. Modern Minimal ─────────────────────────────────────────
  {
    id: 'minimal',
    name: 'Minimal',
    tagline: 'Clean & quiet',
    preview: { bg: '#fafafa', accent: '#111111', text: '#111111', border: '#e5e5e5' },
    vars: {
      '--color-surface': '#fafafa',
      '--color-surface-raised': '#ffffff',
      '--color-surface-overlay': '#f5f5f5',
      '--color-border': '#e5e5e5',
      '--color-border-bright': '#d4d4d4',
      '--color-accent': '#111111',
      '--color-accent-dim': '#525252',
      '--color-text-primary': '#171717',
      '--color-text-secondary': '#737373',
      '--color-text-muted': '#a3a3a3',
      '--color-status-active': '#16a34a',
      '--color-status-paused': '#ca8a04',
      '--color-status-done': '#2563eb',
      '--font-display': "'Instrument Sans', 'Helvetica Neue', sans-serif",
      '--font-body': "'Instrument Sans', 'Helvetica Neue', sans-serif",
      '--theme-radius': '8px',
      '--theme-border-width': '1px',
      '--theme-shadow': '0 1px 3px rgba(0,0,0,0.08)',
      '--theme-glow': 'none',
      '--theme-bg-pattern': 'none',
      '--theme-scanline': 'none',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': '0 1px 3px rgba(0,0,0,0.06)',
      '--theme-card-hover-shadow': '0 2px 8px rgba(0,0,0,0.1)',
      '--theme-card-border': '#e5e5e5',
      '--theme-card-hover-border': '#d4d4d4',
    },
  },

  // ── 5. Retro Terminal ─────────────────────────────────────────
  {
    id: 'terminal',
    name: 'Terminal',
    tagline: 'CRT phosphor',
    preview: { bg: '#0a0a0a', accent: '#00ff41', text: '#00ff41', border: '#003300' },
    vars: {
      '--color-surface': '#050505',
      '--color-surface-raised': '#0a0a0a',
      '--color-surface-overlay': '#0f0f0f',
      '--color-border': '#0a3d0a',
      '--color-border-bright': '#00ff4125',
      '--color-accent': '#00ff41',
      '--color-accent-dim': '#00a82a',
      '--color-text-primary': '#00ff41',
      '--color-text-secondary': '#00cc33',
      '--color-text-muted': '#006622',
      '--color-status-active': '#00ff41',
      '--color-status-paused': '#ffaa00',
      '--color-status-done': '#00ccff',
      '--font-display': "'VT323', 'Courier New', monospace",
      '--font-body': "'IBM Plex Mono', 'Courier New', monospace",
      '--theme-radius': '0px',
      '--theme-border-width': '1px',
      '--theme-shadow': '0 0 10px #00ff4115',
      '--theme-glow': '0 0 6px #00ff4130, 0 0 12px #00ff4110',
      '--theme-bg-pattern': 'none',
      '--theme-scanline': 'repeating-linear-gradient(180deg, transparent 0px, rgba(0,255,65,0.04) 1px, transparent 2px, transparent 3px)',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': '0 0 8px rgba(0,255,65,0.1)',
      '--theme-card-hover-shadow': '0 0 12px rgba(0,255,65,0.2), 0 0 25px rgba(0,255,65,0.08)',
      '--theme-card-border': '#0a3d0a',
      '--theme-card-hover-border': 'rgba(0,255,65,0.3)',
    },
  },

  // ── 6. Sumi-e (Japanese Ink) ──────────────────────────────────
  {
    id: 'sumie',
    name: 'Sumi-e',
    tagline: 'Ink & vermillion',
    preview: { bg: '#f5f0e8', accent: '#c23b22', text: '#1a1a1a', border: '#d4cec4' },
    vars: {
      '--color-surface': '#f5f0e8',
      '--color-surface-raised': '#faf7f2',
      '--color-surface-overlay': '#ede8df',
      '--color-border': '#d4cec4',
      '--color-border-bright': '#b8b0a4',
      '--color-accent': '#c23b22',
      '--color-accent-dim': '#8b2515',
      '--color-text-primary': '#1a1a1a',
      '--color-text-secondary': '#5c5c5c',
      '--color-text-muted': '#9a9488',
      '--color-status-active': '#2d6a4f',
      '--color-status-paused': '#c23b22',
      '--color-status-done': '#264653',
      '--font-display': "'Cormorant Garamond', 'Garamond', serif",
      '--font-body': "'Source Serif 4', 'Georgia', serif",
      '--theme-radius': '2px',
      '--theme-border-width': '1px',
      '--theme-shadow': '0 2px 8px rgba(26,26,26,0.06)',
      '--theme-glow': 'none',
      '--theme-bg-pattern': 'none',
      '--theme-scanline': 'none',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': '0 2px 8px rgba(26,26,26,0.06)',
      '--theme-card-hover-shadow': '0 4px 16px rgba(26,26,26,0.1)',
      '--theme-card-border': '#d4cec4',
      '--theme-card-hover-border': '#b8b0a4',
    },
  },
  // ── 7. Aurora (Vivid Dark) ────────────────────────────────
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Vivid & vibrant',
    preview: { bg: '#1a1035', accent: '#7c5cfc', text: '#e8e0ff', border: '#2d2155' },
    vars: {
      '--color-surface': '#130e24',
      '--color-surface-raised': '#1c1438',
      '--color-surface-overlay': '#251c4a',
      '--color-border': '#2d2155',
      '--color-border-bright': '#7c5cfc40',
      '--color-accent': '#7c5cfc',
      '--color-accent-dim': '#5a3ec4',
      '--color-text-primary': '#ede6ff',
      '--color-text-secondary': '#a99bd4',
      '--color-text-muted': '#5c4d80',
      '--color-status-active': '#34d399',
      '--color-status-paused': '#f59e0b',
      '--color-status-done': '#60a5fa',
      '--font-display': "'DM Sans', 'Helvetica Neue', sans-serif",
      '--font-body': "'DM Sans', 'Helvetica Neue', sans-serif",
      '--theme-radius': '12px',
      '--theme-border-width': '1px',
      '--theme-shadow': '0 4px 24px rgba(124,92,252,0.08)',
      '--theme-glow': '0 0 12px rgba(124,92,252,0.15)',
      '--theme-bg-pattern': 'radial-gradient(circle at 20% 80%, rgba(124,92,252,0.06) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(52,211,153,0.04) 0%, transparent 50%)',
      '--theme-scanline': 'none',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': '0 2px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(124,92,252,0.08)',
      '--theme-card-hover-shadow': '0 8px 32px rgba(124,92,252,0.15), 0 0 0 1px rgba(124,92,252,0.2)',
      '--theme-card-border': 'rgba(124,92,252,0.15)',
      '--theme-card-hover-border': 'rgba(124,92,252,0.4)',
    },
  },

  // ── 8. Ember (Dark Red) ──────────────────────────────────
  {
    id: 'ember',
    name: 'Ember',
    tagline: 'Dark & crimson',
    preview: { bg: '#1a1114', accent: '#e53935', text: '#f5e6e8', border: '#3d1f22' },
    vars: {
      '--color-surface': '#141011',
      '--color-surface-raised': '#1e1618',
      '--color-surface-overlay': '#2a1e20',
      '--color-border': '#3d1f22',
      '--color-border-bright': '#e5393540',
      '--color-accent': '#e53935',
      '--color-accent-dim': '#b71c1c',
      '--color-text-primary': '#f5e6e8',
      '--color-text-secondary': '#c9a5aa',
      '--color-text-muted': '#6b4549',
      '--color-status-active': '#4caf50',
      '--color-status-paused': '#ff9800',
      '--color-status-done': '#42a5f5',
      '--font-display': "'Rajdhani', 'Helvetica Neue', sans-serif",
      '--font-body': "'DM Sans', 'Helvetica Neue', sans-serif",
      '--theme-radius': '6px',
      '--theme-border-width': '1px',
      '--theme-shadow': '0 4px 20px rgba(229,57,53,0.06)',
      '--theme-glow': 'none',
      '--theme-bg-pattern': 'none',
      '--theme-scanline': 'none',
      '--theme-card-transform': 'none',
      '--theme-card-shadow': '0 2px 12px rgba(0,0,0,0.4)',
      '--theme-card-hover-shadow': '0 4px 24px rgba(229,57,53,0.12), 0 2px 12px rgba(0,0,0,0.3)',
      '--theme-card-border': 'rgba(229,57,53,0.12)',
      '--theme-card-hover-border': 'rgba(229,57,53,0.35)',
    },
  },
];

export const themeMap = Object.fromEntries(themes.map((t) => [t.id, t])) as Record<ThemeId, ThemeDefinition>;

const STORAGE_KEY = 'cc-theme';

export function getStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (v && themeMap[v]) return v;
  } catch { /* noop */ }
  return 'cyberpunk';
}

export function storeTheme(id: ThemeId) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
}

export function applyTheme(id: ThemeId) {
  const theme = themeMap[id];
  if (!theme) return;
  const root = document.documentElement;
  root.setAttribute('data-theme', id);
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value);
  }
  storeTheme(id);
}
