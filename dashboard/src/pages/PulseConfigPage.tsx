import { useEffect, useState, useCallback } from 'react';

const API = '/api/pulse/modules';

interface PulseModule {
  id: string;
  key: string;
  name: string;
  description: string;
  category: 'business' | 'briefing';
  enabled: boolean;
  config: string;
  icon: string;
  position: number;
  created_at: number;
  updated_at: number;
}

interface ModuleFormData {
  key: string;
  name: string;
  description: string;
  category: 'business' | 'briefing';
  icon: string;
  config: string;
}

const ICON_OPTIONS = [
  { value: 'dollar', label: '$', svg: <path d="M9 1v16M5 4h6a3 3 0 010 6H4m2 0h7a3 3 0 010 6H5" /> },
  { value: 'package', label: 'Pkg', svg: <><path d="M2 5l7-3 7 3v8l-7 3-7-3z" /><path d="M2 5l7 3 7-3M9 8v9" /></> },
  { value: 'alert-triangle', label: 'Alert', svg: <path d="M9 1L1 16h16L9 1zM9 6v4M9 12.5v.5" /> },
  { value: 'trending-up', label: 'Trend', svg: <polyline points="1,12 5,6 9,9 16,2" /> },
  { value: 'bot', label: 'Bot', svg: <><rect x="3" y="5" width="12" height="10" rx="1" /><circle cx="6.5" cy="9" r="1" /><circle cx="11.5" cy="9" r="1" /><path d="M9 2v3M3 9H1M17 9h-2" /></> },
  { value: 'sparkles', label: 'Star', svg: <><path d="M9 1l2 5 5 1-4 3 1 5-4-2-4 2 1-5-4-3 5-1z" /></> },
  { value: 'cloud-sun', label: 'Cloud', svg: <><circle cx="7" cy="7" r="3" /><path d="M4 13a4 4 0 017-2h1a3 3 0 011 5.8H5a4 4 0 01-1-3.8z" /></> },
  { value: 'newspaper', label: 'News', svg: <><rect x="2" y="2" width="14" height="14" rx="1" /><path d="M5 5h8M5 8h5M5 11h8" /></> },
  { value: 'chart', label: 'Chart', svg: <><rect x="2" y="8" width="3" height="8" /><rect x="7" y="4" width="3" height="12" /><rect x="12" y="1" width="3" height="15" /></> },
];

function IconPreview({ icon }: { icon: string }) {
  const found = ICON_OPTIONS.find((o) => o.value === icon);
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {found?.svg ?? <rect x="2" y="2" width="14" height="14" rx="2" />}
    </svg>
  );
}

const emptyForm: ModuleFormData = { key: '', name: '', description: '', category: 'business', icon: 'chart', config: '{}' };

export default function PulseConfigPage() {
  const [modules, setModules] = useState<PulseModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModuleFormData>(emptyForm);
  const [configExpanded, setConfigExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch(API);
      const data = await res.json();
      setModules(data);
    } catch (e) {
      console.error('Failed to fetch pulse modules', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchModules(); }, [fetchModules]);

  const toggleEnabled = async (mod: PulseModule) => {
    await fetch(`${API}/${mod.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !mod.enabled }),
    });
    setModules((prev) => prev.map((m) => m.id === mod.id ? { ...m, enabled: !m.enabled } : m));
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (mod: PulseModule) => {
    setForm({ key: mod.key, name: mod.name, description: mod.description, category: mod.category, icon: mod.icon, config: mod.config });
    setEditingId(mod.id);
    setModalOpen(true);
  };

  const saveModule = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`${API}/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name, description: form.description, category: form.category, icon: form.icon, config: form.config }),
        });
      } else {
        await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      setModalOpen(false);
      await fetchModules();
    } catch (e) {
      console.error('Failed to save module', e);
    } finally {
      setSaving(false);
    }
  };

  const deleteModule = async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    setModules((prev) => prev.filter((m) => m.id !== id));
  };

  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    setModules((prev) => {
      const items = [...prev];
      const fromIdx = items.findIndex((m) => m.id === dragId);
      const toIdx = items.findIndex((m) => m.id === targetId);
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      return items;
    });
  };
  const handleDragEnd = async () => {
    if (!dragId) return;
    setDragId(null);
    const order = modules.map((m) => m.id);
    await fetch(`${API}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
  };

  const businessModules = modules.filter((m) => m.category === 'business');
  const briefingModules = modules.filter((m) => m.category === 'briefing');
  const enabledCount = modules.filter((m) => m.enabled).length;

  const updateConfig = async (modId: string, configStr: string) => {
    await fetch(`${API}/${modId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configStr }),
    });
    setModules((prev) => prev.map((m) => m.id === modId ? { ...m, config: configStr } : m));
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-text-primary tracking-tight">Pulse Config</h1>
          <p className="text-sm text-text-muted mt-1 font-body">
            {enabledCount} de {modules.length} modulos activos
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Agregar Modulo
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-raised border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-display font-bold text-accent">{businessModules.length}</div>
          <div className="text-xs text-text-muted font-display uppercase tracking-wider mt-1">Business</div>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-display font-bold text-status-active">{briefingModules.length}</div>
          <div className="text-xs text-text-muted font-display uppercase tracking-wider mt-1">Briefing</div>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-display font-bold text-status-paused">{modules.length - enabledCount}</div>
          <div className="text-xs text-text-muted font-display uppercase tracking-wider mt-1">Desactivados</div>
        </div>
      </div>

      {/* Business section */}
      <Section
        title="Business Pulse"
        subtitle="Metricas y datos operativos del negocio"
        modules={businessModules}
        onToggle={toggleEnabled}
        onEdit={openEdit}
        onDelete={deleteModule}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        dragId={dragId}
        configExpanded={configExpanded}
        setConfigExpanded={setConfigExpanded}
        updateConfig={updateConfig}
      />

      {/* Briefing section */}
      <Section
        title="Daily Briefing"
        subtitle="Contexto personal y motivacional"
        modules={briefingModules}
        onToggle={toggleEnabled}
        onEdit={openEdit}
        onDelete={deleteModule}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        dragId={dragId}
        configExpanded={configExpanded}
        setConfigExpanded={setConfigExpanded}
        updateConfig={updateConfig}
      />

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="bg-surface-raised border border-border rounded-lg w-full max-w-md mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-display font-bold text-text-primary">
              {editingId ? 'Editar Modulo' : 'Nuevo Modulo'}
            </h2>

            <div className="space-y-3">
              {!editingId && (
                <div>
                  <label className="block text-xs text-text-muted font-display uppercase tracking-wider mb-1">Key (unico)</label>
                  <input
                    type="text"
                    value={form.key}
                    onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                    placeholder="mi_metrica"
                    className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-text-muted font-display uppercase tracking-wider mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Mi Metrica"
                  className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
                />
              </div>

              <div>
                <label className="block text-xs text-text-muted font-display uppercase tracking-wider mb-1">Descripcion</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted font-display uppercase tracking-wider mb-1">Categoria</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as 'business' | 'briefing' })}
                    className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
                  >
                    <option value="business">Business</option>
                    <option value="briefing">Briefing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-muted font-display uppercase tracking-wider mb-1">Icono</label>
                  <div className="flex flex-wrap gap-1">
                    {ICON_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm({ ...form, icon: opt.value })}
                        className={`p-1.5 rounded border transition-colors ${
                          form.icon === opt.value
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-border text-text-muted hover:text-text-secondary hover:border-border-bright'
                        }`}
                        title={opt.label}
                      >
                        <IconPreview icon={opt.value} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-text-muted font-display uppercase tracking-wider mb-1">Config (JSON)</label>
                <textarea
                  value={form.config}
                  onChange={(e) => setForm({ ...form, config: e.target.value })}
                  rows={3}
                  className="w-full bg-surface border border-border rounded-md px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary font-display transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveModule}
                disabled={saving || (!editingId && !form.key) || !form.name}
                className="px-4 py-2 bg-accent/15 text-accent border border-accent/30 rounded-md text-sm font-display font-medium hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Guardando...' : editingId ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Section Component ──────────────────────────────────── */

interface SectionProps {
  title: string;
  subtitle: string;
  modules: PulseModule[];
  onToggle: (m: PulseModule) => void;
  onEdit: (m: PulseModule) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  dragId: string | null;
  configExpanded: string | null;
  setConfigExpanded: (id: string | null) => void;
  updateConfig: (id: string, config: string) => void;
}

function Section({ title, subtitle, modules, onToggle, onEdit, onDelete, onDragStart, onDragOver, onDragEnd, dragId, configExpanded, setConfigExpanded, updateConfig }: SectionProps) {
  return (
    <div className="space-y-2">
      <div className="px-1">
        <h2 className="text-sm font-display font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-muted">{subtitle}</p>
      </div>
      <div className="space-y-1.5">
        {modules.length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
            No hay modulos en esta categoria
          </div>
        )}
        {modules.map((mod) => (
          <ModuleCard
            key={mod.id}
            mod={mod}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            isDragging={dragId === mod.id}
            configExpanded={configExpanded === mod.id}
            onConfigToggle={() => setConfigExpanded(configExpanded === mod.id ? null : mod.id)}
            updateConfig={updateConfig}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Module Card ────────────────────────────────────────── */

interface ModuleCardProps {
  mod: PulseModule;
  onToggle: (m: PulseModule) => void;
  onEdit: (m: PulseModule) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  configExpanded: boolean;
  onConfigToggle: () => void;
  updateConfig: (id: string, config: string) => void;
}

function ModuleCard({ mod, onToggle, onEdit, onDelete, onDragStart, onDragOver, onDragEnd, isDragging, configExpanded, onConfigToggle, updateConfig }: ModuleCardProps) {
  const [localConfig, setLocalConfig] = useState(mod.config);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleConfigSave = () => {
    updateConfig(mod.id, localConfig);
    onConfigToggle();
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(mod.id)}
      onDragOver={(e) => onDragOver(e, mod.id)}
      onDragEnd={onDragEnd}
      className={`group bg-surface-raised border rounded-lg transition-all ${
        isDragging ? 'opacity-50 border-accent scale-[0.98]' : 'border-border hover:border-border-bright'
      } ${!mod.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Drag handle */}
        <div className="cursor-grab active:cursor-grabbing text-text-muted/40 group-hover:text-text-muted transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="4" cy="3" r="1.2" /><circle cx="10" cy="3" r="1.2" />
            <circle cx="4" cy="7" r="1.2" /><circle cx="10" cy="7" r="1.2" />
            <circle cx="4" cy="11" r="1.2" /><circle cx="10" cy="11" r="1.2" />
          </svg>
        </div>

        {/* Icon */}
        <div className={`flex-shrink-0 p-1.5 rounded ${mod.enabled ? 'text-accent' : 'text-text-muted'}`}>
          <IconPreview icon={mod.icon} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-display font-medium text-text-primary truncate">{mod.name}</span>
            <span className="text-[10px] font-mono text-text-muted/60 bg-surface px-1.5 py-0.5 rounded">{mod.key}</span>
          </div>
          <p className="text-xs text-text-muted truncate">{mod.description}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {/* Config toggle */}
          <button
            onClick={onConfigToggle}
            className="p-1.5 text-text-muted hover:text-text-secondary rounded transition-colors"
            title="Configuracion"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="2.5" />
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 1M10.2 10.2l1 1M11.2 2.8l-1 1M3.8 10.2l-1 1" />
            </svg>
          </button>

          {/* Edit */}
          <button
            onClick={() => onEdit(mod)}
            className="p-1.5 text-text-muted hover:text-accent rounded transition-colors"
            title="Editar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M9.5 2.5l2 2L4 12H2v-2l7.5-7.5z" />
            </svg>
          </button>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { onDelete(mod.id); setConfirmDelete(false); }}
                className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded font-display hover:bg-red-500/30 transition-colors"
              >
                Si
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs text-text-muted rounded hover:text-text-secondary transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-text-muted hover:text-red-400 rounded transition-colors"
              title="Eliminar"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
              </svg>
            </button>
          )}

          {/* Toggle */}
          <button
            onClick={() => onToggle(mod)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              mod.enabled ? 'bg-accent/30' : 'bg-surface'
            } border ${mod.enabled ? 'border-accent/50' : 'border-border'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
              mod.enabled ? 'left-5 bg-accent' : 'left-0.5 bg-text-muted'
            }`} />
          </button>
        </div>
      </div>

      {/* Expandable config panel */}
      {configExpanded && (
        <div className="border-t border-border px-4 py-3 space-y-2 bg-surface/50">
          <label className="block text-xs text-text-muted font-display uppercase tracking-wider">Configuracion JSON</label>
          <textarea
            value={localConfig}
            onChange={(e) => setLocalConfig(e.target.value)}
            rows={4}
            className="w-full bg-surface border border-border rounded-md px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50 resize-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={onConfigToggle} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary font-display transition-colors">
              Cancelar
            </button>
            <button onClick={handleConfigSave} className="px-3 py-1.5 text-xs bg-accent/15 text-accent border border-accent/30 rounded text-sm font-display hover:bg-accent/25 transition-colors">
              Guardar Config
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
