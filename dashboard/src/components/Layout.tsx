import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ThemeSelector from './ThemeSelector';
import { useTheme } from '../lib/ThemeContext';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { fontScale, increaseFontSize, decreaseFontSize } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-text-secondary hover:text-text-primary p-1 mr-3"
              aria-label="Open menu"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="6" x2="19" y2="6" />
                <line x1="3" y1="11" x2="19" y2="11" />
                <line x1="3" y1="16" x2="19" y2="16" />
              </svg>
            </button>
            <span className="lg:hidden font-display text-sm text-accent font-bold">ClaudeClaw</span>
          </div>

          {/* Font size + Theme selector */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <button
                onClick={decreaseFontSize}
                disabled={fontScale <= 0.85}
                className="px-2 py-1 text-xs font-display text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
                title="Reducir texto"
              >
                A-
              </button>
              <span className="px-1.5 py-1 text-[10px] font-display text-text-muted border-x border-border">
                {Math.round(fontScale * 100)}%
              </span>
              <button
                onClick={increaseFontSize}
                disabled={fontScale >= 1.2}
                className="px-2 py-1 text-xs font-display text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
                title="Aumentar texto"
              >
                A+
              </button>
            </div>
            <ThemeSelector />
          </div>
        </div>

        {/* Top accent border */}
        <div className="h-px bg-gradient-to-r from-accent via-accent-dim to-transparent" />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
