import { useState, useEffect, useCallback, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { notes, projects } from '../lib/api';
import type { Note, Project } from '../lib/types';

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NotesPage() {
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [pinned, setPinned] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [filterPinned, setFilterPinned] = useState(false);
  const [filterTag, setFilterTag] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadNotes = useCallback(async () => {
    const params: { search?: string; tags?: string; pinned?: boolean } = {};
    if (search) params.search = search;
    if (filterTag) params.tags = filterTag;
    if (filterPinned) params.pinned = true;
    const data = await notes.list(params);
    setNotesList(data);
  }, [search, filterTag, filterPinned]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // Load projects for linking
  useEffect(() => {
    projects.list().then(setProjectsList).catch(() => {});
  }, []);

  const selectNote = (note: Note) => {
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags);
    setPinned(note.pinned);
    setProjectId(note.project_id);
    setPreview(false);
    setShowProjectPicker(false);
  };

  const createNew = async () => {
    const note = await notes.create({ title: 'Nueva nota', content: '' });
    setNotesList((prev) => [note, ...prev]);
    selectNote(note);
  };

  const saveNote = useCallback(async () => {
    if (!activeId) return;
    setSaving(true);
    const updated = await notes.update(activeId, { title, content, tags, pinned, project_id: projectId });
    setNotesList((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    setSaving(false);
  }, [activeId, title, content, tags, pinned, projectId]);

  // Auto-save with debounce
  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveNote(); }, 800);
  }, [saveNote]);

  const deleteNote = async () => {
    if (!activeId) return;
    await notes.delete(activeId);
    setNotesList((prev) => prev.filter((n) => n.id !== activeId));
    setActiveId(null);
    setTitle('');
    setContent('');
    setTags('');
    setPinned(false);
  };

  const activeNote = notesList.find((n) => n.id === activeId);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Left panel — note list */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-surface-raised">
        {/* Search + new + filters */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar notas..."
              className="flex-1 px-3 py-1.5 text-sm bg-surface-base border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={createNew}
              className="px-3 py-1.5 text-sm font-display bg-accent text-black rounded-md hover:opacity-90 transition-opacity"
            >
              +
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setFilterPinned(!filterPinned)}
              className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                filterPinned ? 'border-accent text-accent bg-accent/10 font-bold' : 'border-border/50 text-text-muted hover:text-text-primary'
              }`}
            >
              PIN
            </button>
            {Array.from(new Set(notesList.flatMap((n) => n.tags ? n.tags.split(',').map((t) => t.trim()).filter(Boolean) : []))).slice(0, 6).map((tag) => (
              <button
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? '' : tag)}
                className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                  filterTag === tag ? 'border-accent text-accent bg-accent/10 font-bold' : 'border-border/50 text-text-muted hover:text-text-primary'
                }`}
              >
                {tag}
              </button>
            ))}
            {(filterPinned || filterTag) && (
              <button
                onClick={() => { setFilterPinned(false); setFilterTag(''); }}
                className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-accent transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {notesList.map((note) => (
            <button
              key={note.id}
              onClick={() => selectNote(note)}
              className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${
                note.id === activeId
                  ? 'bg-surface-overlay border-l-2 border-l-accent'
                  : 'hover:bg-surface-overlay/50 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {note.pinned && <span className="text-accent text-xs">PIN</span>}
                <span className="text-sm font-display text-text-primary truncate">
                  {note.title || 'Sin título'}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5 truncate">
                {note.content.slice(0, 80) || 'Nota vacía'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-text-muted">{formatDate(note.updated_at)}</span>
                {note.tags && (
                  <span className="text-xs text-accent/70 truncate">{note.tags}</span>
                )}
              </div>
            </button>
          ))}
          {notesList.length === 0 && (
            <div className="p-6 text-center text-text-muted text-sm">
              {search ? 'Sin resultados' : 'No hay notas. Crea la primera.'}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {activeId ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
              <input
                type="text"
                value={title}
                onChange={(e) => { setTitle(e.target.value); scheduleAutoSave(); }}
                placeholder="Título de la nota"
                className="flex-1 text-lg font-display font-bold bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <button
                onClick={() => { setPinned(!pinned); setTimeout(saveNote, 50); }}
                className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                  pinned ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {pinned ? 'Pinned' : 'Pin'}
              </button>
              <button
                onClick={() => setPreview(!preview)}
                className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                  preview ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {preview ? 'Editar' : 'Preview'}
              </button>
              <button
                onClick={deleteNote}
                className="px-2 py-1 text-xs text-red-400 border border-red-400/30 rounded-md hover:bg-red-400/10 transition-colors"
              >
                Borrar
              </button>
              {saving && <span className="text-xs text-text-muted">Guardando...</span>}
            </div>

            {/* Tags */}
            <div className="px-4 py-1.5 border-b border-border/50">
              <input
                type="text"
                value={tags}
                onChange={(e) => { setTags(e.target.value); scheduleAutoSave(); }}
                placeholder="Tags (separados por coma): flujo, HD, proveedores"
                className="w-full text-xs bg-transparent text-text-secondary placeholder:text-text-muted focus:outline-none"
              />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {preview ? (
                <div className="p-6 prose prose-invert prose-sm max-w-none text-text-primary [&_a]:text-accent [&_code]:bg-surface-overlay [&_code]:px-1 [&_code]:rounded [&_pre]:bg-surface-overlay [&_pre]:p-3 [&_pre]:rounded-lg [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_li]:text-text-primary [&_p]:text-text-primary">
                  <Markdown remarkPlugins={[remarkGfm]}>{content || '*Nota vacía*'}</Markdown>
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => { setContent(e.target.value); scheduleAutoSave(); }}
                  placeholder="Escribe tu nota aquí... (Markdown soportado)"
                  className="w-full h-full p-6 text-sm bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none resize-none font-mono"
                />
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border/50 flex items-center gap-3 text-xs text-text-muted relative">
              {activeNote && (
                <>
                  <span>Creada: {formatDate(activeNote.created_at)}</span>
                  <span>Modificada: {formatDate(activeNote.updated_at)}</span>
                  <div className="ml-auto relative">
                    <button
                      onClick={() => setShowProjectPicker(!showProjectPicker)}
                      className={`px-2 py-0.5 rounded-md border transition-colors ${
                        projectId
                          ? 'border-accent text-accent bg-accent/10'
                          : 'border-border text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {projectId
                        ? projectsList.find((p) => p.id === projectId)?.name || 'Proyecto'
                        : 'Vincular proyecto'}
                    </button>
                    {showProjectPicker && (
                      <div className="absolute bottom-full right-0 mb-1 w-56 bg-surface-raised border border-border rounded-lg shadow-lg overflow-hidden z-10">
                        <button
                          onClick={() => { setProjectId(null); setShowProjectPicker(false); setTimeout(saveNote, 50); }}
                          className="w-full text-left px-3 py-2 text-xs text-text-muted hover:bg-surface-overlay transition-colors border-b border-border/50"
                        >
                          Sin proyecto
                        </button>
                        {projectsList.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setProjectId(p.id); setShowProjectPicker(false); setTimeout(saveNote, 50); }}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-surface-overlay transition-colors flex items-center gap-2 ${
                              projectId === p.id ? 'text-accent' : 'text-text-primary'
                            }`}
                          >
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color || 'var(--color-accent)' }} />
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <div className="text-center">
              <p className="text-lg font-display mb-2">Base de Conocimiento</p>
              <p className="text-sm">Selecciona una nota o crea una nueva</p>
              <button
                onClick={createNew}
                className="mt-4 px-4 py-2 text-sm font-display bg-accent text-black rounded-md hover:opacity-90 transition-opacity"
              >
                Nueva Nota
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
