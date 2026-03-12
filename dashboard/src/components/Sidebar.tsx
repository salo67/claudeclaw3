import { NavLink } from 'react-router-dom';
import { useState } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
}

interface ExternalApp {
  url: string;
  label: string;
  windowName: string;
  icon: JSX.Element;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface ExternalGroup {
  title: string;
  external: true;
  items: ExternalApp[];
}

type SidebarGroup = NavGroup | ExternalGroup;

function isExternalGroup(g: SidebarGroup): g is ExternalGroup {
  return 'external' in g && g.external === true;
}

// Reusable icon for external apps (simple window icon)
const extIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="14" height="12" rx="1.5" />
    <path d="M2 6h14" />
    <circle cx="4.5" cy="4.5" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="4.5" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

const sidebarGroups: SidebarGroup[] = [
  {
    title: 'WORKSPACE',
    items: [
      {
        to: '/',
        label: 'Overview',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="11" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="11" width="6" height="6" rx="1" />
            <rect x="11" y="11" width="6" height="6" rx="1" />
          </svg>
        ),
      },
      {
        to: '/kanban',
        label: 'Kanban',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="2" width="4" height="14" rx="1" />
            <rect x="7" y="2" width="4" height="10" rx="1" />
            <rect x="13" y="2" width="4" height="12" rx="1" />
          </svg>
        ),
      },
      {
        to: '/projects',
        label: 'Projects',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5V14a1 1 0 001 1h12a1 1 0 001-1V7a1 1 0 00-1-1H9L7 4H3a1 1 0 00-1 1z" />
          </svg>
        ),
      },
      {
        to: '/autopilot',
        label: 'Autopilot',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 4 10-12h-9l1-4z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'APPS',
    items: [
      {
        to: '/calendar',
        label: 'Calendario',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="14" height="13" rx="1" />
            <path d="M2 7h14" />
            <path d="M6 1v4M12 1v4" />
            <path d="M6 10h1M9 10h1M12 10h1M6 13h1M9 13h1" />
          </svg>
        ),
      },
      {
        to: '/email',
        label: 'Correo',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="14" height="12" rx="1" />
            <path d="M2 5l7 5 7-5" />
          </svg>
        ),
      },
      {
        to: '/newsletter',
        label: 'Newsletter',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="1" width="12" height="16" rx="1" />
            <path d="M6 5h6M6 8h6M6 11h4" />
            <path d="M3 5h1M3 8h1" />
          </svg>
        ),
      },
      {
        to: '/pulse',
        label: 'Business Pulse',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9h3l2-5 3 10 2-7h4" />
          </svg>
        ),
      },
      {
        to: '/research',
        label: 'Research',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M15 15l-3-3" />
            <path d="M8 5.5v5M5.5 8h5" />
          </svg>
        ),
      },
      {
        to: '/journal',
        label: 'Journal',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2h10a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
            <path d="M6 5h6M6 8h4M6 11h5" />
            <path d="M3 5h1M3 8h1M3 11h1" />
          </svg>
        ),
      },
      {
        to: '/notes',
        label: 'Notes',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H4a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V3a1 1 0 00-1-1z" />
            <path d="M6 6h6M6 9h6M6 12h3" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'DASHBOARDS',
    external: true,
    items: [
      { url: 'http://localhost:5195', label: 'HD Cientifico', windowName: 'hd-cientifico', icon: extIcon },
      { url: 'http://localhost:5190', label: 'Monitor Margenes', windowName: 'monitor-margenes', icon: extIcon },
      { url: 'http://localhost:3021', label: 'Stockout', windowName: 'stockout', icon: extIcon },
      { url: 'http://localhost:5181', label: 'PIM', windowName: 'pim', icon: extIcon },
      { url: 'http://localhost:5173', label: 'Cotizador', windowName: 'cotizador', icon: extIcon },
      { url: 'http://localhost:5210', label: 'Cashflow', windowName: 'cashflow', icon: extIcon },
      { url: 'http://localhost:3030', label: 'Reporteador', windowName: 'reporteador', icon: extIcon },
      { url: 'http://localhost:3015', label: 'Forecast', windowName: 'forecast', icon: extIcon },
      { url: 'http://localhost:5000', label: 'Supply Tracker', windowName: 'supply-tracker', icon: extIcon },
      { url: 'http://localhost:5220', label: 'Todos', windowName: 'todos', icon: extIcon },
      { url: 'http://localhost:5230', label: 'Seeking Alpha', windowName: 'seeking-alpha', icon: extIcon },
    ],
  },
  {
    title: 'SISTEMA',
    items: [
      {
        to: '/scheduler',
        label: 'Scheduler',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="7" />
            <path d="M9 5v4l2.5 2.5" />
          </svg>
        ),
      },
      {
        to: '/alerts',
        label: 'Alertas',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 6A5 5 0 004 6c0 5.5-2.5 7-2.5 7h15S14 11.5 14 6z" />
            <path d="M10.5 15a1.5 1.5 0 01-3 0" />
          </svg>
        ),
      },
      {
        to: '/advisor',
        label: 'Equipo Advisor',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
        ),
      },
      {
        to: '/status',
        label: 'Status',
        icon: (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,9 4,9 6,3 9,15 12,6 14,9 17,9" />
          </svg>
        ),
      },
    ],
  },
];

function openExternalApp(url: string, windowName: string) {
  window.open(url, windowName, 'popup,width=1400,height=900,left=100,top=50');
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ DASHBOARDS: true });

  const toggle = (title: string) =>
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-screen w-60 flex flex-col
          bg-surface-raised border-r border-border
          transition-transform duration-200 ease-out
          lg:translate-x-0 lg:static lg:z-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-6">
          <span className="font-display text-lg font-bold text-accent tracking-tight">
            ClaudeClaw
          </span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-active opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-status-active" />
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-4 overflow-y-auto">
          {sidebarGroups.map((group) => (
            <div key={group.title}>
              <button
                onClick={() => toggle(group.title)}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[10px] font-display font-semibold tracking-widest text-text-muted uppercase hover:text-text-secondary transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  {group.title}
                  {isExternalGroup(group) && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="opacity-50">
                      <path d="M4 1h5v5M9 1L4 6" />
                    </svg>
                  )}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={`transition-transform duration-150 ${collapsed[group.title] ? '-rotate-90' : ''}`}
                >
                  <path d="M3 4.5l3 3 3-3" />
                </svg>
              </button>
              {!collapsed[group.title] && (
                <div className="space-y-0.5 mt-0.5">
                  {isExternalGroup(group)
                    ? group.items.map((item) => (
                        <button
                          key={item.windowName}
                          onClick={() => {
                            openExternalApp(item.url, item.windowName);
                            onClose();
                          }}
                          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-display transition-colors text-text-secondary hover:text-text-primary hover:bg-surface-overlay/50 border-l-2 border-transparent w-full text-left"
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      ))
                    : group.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          onClick={onClose}
                          className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-display transition-colors ${
                              isActive
                                ? 'text-accent bg-surface-overlay border-l-2 border-accent'
                                : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay/50 border-l-2 border-transparent'
                            }`
                          }
                        >
                          {item.icon}
                          {item.label}
                        </NavLink>
                      ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4">
          <span className="text-xs text-text-muted font-display">
            Control Center v1
          </span>
        </div>
      </aside>
    </>
  );
}
