import { useState, useEffect, useCallback } from 'react';
import { alerts } from '../lib/api';
import type { Alert } from '../lib/types';

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Critico', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  warning: { label: 'Advertencia', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  info: { label: 'Info', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
};

const CATEGORY_LABELS: Record<string, string> = {
  cash: 'Flujo',
  inventory: 'Inventario',
  project: 'Proyecto',
  cobranza: 'Cobranza',
  system: 'Sistema',
  pulse: 'Business Pulse',
  info: 'General',
};

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export default function AlertsPage() {
  const [alertsList, setAlertsList] = useState<Alert[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await alerts.list(showDismissed);
      setAlertsList(data);
    } catch { /* silent */ }
    setLoading(false);
  }, [showDismissed]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const handleDismiss = async (id: string) => {
    await alerts.dismiss(id);
    setAlertsList((prev) => prev.filter((a) => a.id !== id));
  };

  const handleExecute = async (id: string) => {
    const updated = await alerts.execute(id);
    setAlertsList((prev) => prev.map((a) => (a.id === id ? updated : a)));
  };

  const handleDelete = async (id: string) => {
    await alerts.delete(id);
    setAlertsList((prev) => prev.filter((a) => a.id !== id));
  };

  const criticalCount = alertsList.filter((a) => a.severity === 'critical' && !a.dismissed).length;
  const warningCount = alertsList.filter((a) => a.severity === 'warning' && !a.dismissed).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-text-primary">Alertas</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Notificaciones proactivas del sistema
          </p>
        </div>
        <div className="flex items-center gap-3">
          {criticalCount > 0 && (
            <span className="px-2.5 py-1 text-xs font-display bg-red-500/10 text-red-400 border border-red-500/30 rounded-md">
              {criticalCount} critico{criticalCount !== 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="px-2.5 py-1 text-xs font-display bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-md">
              {warningCount} advertencia{warningCount !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className={`px-3 py-1.5 text-xs font-display rounded-md border transition-colors ${
              showDismissed
                ? 'border-accent text-accent bg-accent/10'
                : 'border-border text-text-muted hover:text-text-primary'
            }`}
          >
            {showDismissed ? 'Mostrando descartadas' : 'Ver descartadas'}
          </button>
        </div>
      </div>

      {/* Alert list */}
      <div className="space-y-3">
        {alertsList.map((alert) => {
          const sev = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
          const catLabel = CATEGORY_LABELS[alert.category] || alert.category;

          return (
            <div
              key={alert.id}
              className={`p-4 rounded-lg border ${sev.bg} ${sev.border} ${
                alert.dismissed ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Severity indicator */}
                <div className="mt-0.5">
                  {alert.severity === 'critical' && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-red-400">
                      <path d="M10 2L2 18h16L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M10 8v4M10 14h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                  {alert.severity === 'warning' && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-amber-400">
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10 7v4M10 13h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                  {alert.severity === 'info' && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-blue-400">
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10 9v4M10 7h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-display font-bold ${sev.color}`}>
                      {alert.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/50 text-text-muted font-display">
                      {catLabel}
                    </span>
                    {alert.executed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30 font-display">
                        Ejecutado
                      </span>
                    )}
                  </div>
                  {alert.description && (
                    <p className="text-sm text-text-secondary leading-relaxed mb-2">
                      {alert.description}
                    </p>
                  )}
                  {alert.action && !alert.executed && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-text-muted">Accion sugerida:</span>
                      <span className="text-xs text-text-primary font-display">{alert.action}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-text-muted">{timeAgo(alert.created_at)}</span>
                    {alert.source && (
                      <span className="text-[10px] text-text-muted">via {alert.source}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {alert.action && !alert.executed && (
                    <button
                      onClick={() => handleExecute(alert.id)}
                      className="px-2.5 py-1 text-[11px] font-display bg-accent text-black rounded-md hover:opacity-90 transition-opacity"
                    >
                      Ejecutar
                    </button>
                  )}
                  {!alert.dismissed && (
                    <button
                      onClick={() => handleDismiss(alert.id)}
                      className="px-2.5 py-1 text-[11px] font-display text-text-muted border border-border rounded-md hover:text-text-primary transition-colors"
                    >
                      Descartar
                    </button>
                  )}
                  {alert.dismissed && (
                    <button
                      onClick={() => handleDelete(alert.id)}
                      className="px-2.5 py-1 text-[11px] font-display text-red-400/60 border border-red-400/20 rounded-md hover:text-red-400 hover:border-red-400/40 transition-colors"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {!loading && alertsList.length === 0 && (
          <div className="text-center py-16">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-text-muted/30 mb-4">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            <p className="text-text-muted font-display">
              {showDismissed ? 'No hay alertas descartadas' : 'Sin alertas activas. Todo tranquilo.'}
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-16">
            <p className="text-text-muted font-display animate-pulse">Cargando...</p>
          </div>
        )}
      </div>
    </div>
  );
}
