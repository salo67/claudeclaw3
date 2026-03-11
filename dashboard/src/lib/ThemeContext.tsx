import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { type ThemeId, applyTheme, getStoredTheme } from './themes';

const FONT_SCALES = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2];
const LS_FONT_KEY = 'cc-font-size';

function getStoredFontScale(): number {
  const stored = localStorage.getItem(LS_FONT_KEY);
  if (stored) {
    const val = parseFloat(stored);
    if (FONT_SCALES.includes(val)) return val;
  }
  return 1.0;
}

function applyFontScale(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

interface ThemeCtx {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  fontScale: number;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'cyberpunk',
  setTheme: () => {},
  fontScale: 1.0,
  increaseFontSize: () => {},
  decreaseFontSize: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(getStoredTheme);
  const [fontScale, setFontScale] = useState<number>(getStoredFontScale);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyFontScale(fontScale);
    localStorage.setItem(LS_FONT_KEY, String(fontScale));
  }, [fontScale]);

  const setTheme = (id: ThemeId) => {
    setThemeState(id);
    applyTheme(id);
  };

  const increaseFontSize = () => {
    setFontScale((prev) => {
      const idx = FONT_SCALES.indexOf(prev);
      return idx < FONT_SCALES.length - 1 ? FONT_SCALES[idx + 1] : prev;
    });
  };

  const decreaseFontSize = () => {
    setFontScale((prev) => {
      const idx = FONT_SCALES.indexOf(prev);
      return idx > 0 ? FONT_SCALES[idx - 1] : prev;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, fontScale, increaseFontSize, decreaseFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
