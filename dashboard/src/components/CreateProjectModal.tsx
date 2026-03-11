import { useState, useEffect, useRef } from 'react';
import { projects as projectsApi } from '../lib/api';
import type { Project, Phase, Priority } from '../lib/types';
import { PHASE_COLUMNS, PRIORITIES } from '../lib/types';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

const PRESET_COLORS = [
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#f43f5e',
  '#06b6d4',
];

export default function CreateProjectModal({ open, onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [phase, setPhase] = useState<Phase>('backlog');
  const [priority, setPriority] = useState<Priority>('none');
  const [tags, setTags] = useState('');
  const [autopilot, setAutopilot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setColor(PRESET_COLORS[0]);
      setPhase('backlog');
      setPriority('none');
      setTags('');
      setAutopilot(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleCreate() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const project = await projectsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        phase,
        priority,
        tags: tags.trim() || undefined,
        autopilot,
      });
      onCreated(project);
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="theme-card bg-surface-raised p-6 w-full max-w-md animate-fade-in max-h-[90vh] overflow-y-auto">
        <h2 className="font-display text-xl text-accent mb-5">New Project</h2>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-text-secondary text-sm mb-1.5">Name</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="Project name"
              className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-text-secondary text-sm mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors resize-none"
            />
          </div>

          {/* Phase + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-text-secondary text-sm mb-1.5">Phase</label>
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as Phase)}
                className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary font-display focus:outline-none focus:border-border-bright transition-colors cursor-pointer"
              >
                {PHASE_COLUMNS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-text-secondary text-sm mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary font-display focus:outline-none focus:border-border-bright transition-colors cursor-pointer"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-text-secondary text-sm mb-1.5">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma-separated tags"
              className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
          </div>

          {/* AutoPilot toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAutopilot(!autopilot)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                autopilot ? 'bg-accent' : 'bg-border-bright'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-text-primary rounded-full transition-transform ${
                  autopilot ? 'translate-x-5' : ''
                }`}
              />
            </button>
            <span className="text-text-secondary text-sm">AutoPilot</span>
          </div>

          {/* Color */}
          <div>
            <label className="block text-text-secondary text-sm mb-1.5">Color</label>
            <div className="flex gap-3">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-all duration-150 ${
                    color === c
                      ? 'ring-2 ring-offset-2 ring-offset-surface-raised scale-110'
                      : 'hover:scale-110'
                  }`}
                  style={{
                    backgroundColor: c,
                    ...(color === c ? { boxShadow: `0 0 0 2px #141414, 0 0 0 4px ${c}` } : {}),
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || submitting}
            className="bg-accent text-surface font-display font-semibold rounded-md px-4 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
