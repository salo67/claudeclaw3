import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import {
  projects as projectsApi,
  features as featuresApi,
  tasks as tasksApi,
  documents as documentsApi,
} from '../lib/api';
import type { Project, Feature, Task, Document, Phase, Priority } from '../lib/types';
import { PHASE_COLUMNS, PRIORITIES } from '../lib/types';

function getPriorityColor(p: Priority): string {
  return PRIORITIES.find((pr) => pr.key === p)?.color ?? '#525252';
}

// ── Draggable Feature Card ──────────────────────────────────
function FeatureKanbanCard({
  feature,
  tasks,
  isDragOverlay,
  onToggleComplete,
  onDelete,
  onExpand,
  onToggleTask,
}: {
  feature: Feature;
  tasks: Task[];
  isDragOverlay?: boolean;
  onToggleComplete: (f: Feature) => void;
  onDelete: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleTask: (t: Task) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: feature.id });

  const style = isDragOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      };

  const priorityColor = getPriorityColor(feature.priority);
  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={style}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={`
        theme-card bg-surface-raised p-3
        transition-all duration-150 cursor-grab active:cursor-grabbing group
        ${isDragOverlay ? 'rotate-1 shadow-xl shadow-black/40' : ''}
        ${feature.completed ? 'opacity-60' : ''}
      `}
    >
      <div className="flex items-start gap-2 mb-1">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleComplete(feature); }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`shrink-0 w-4 h-4 mt-0.5 rounded border-2 transition-colors flex items-center justify-center ${
            feature.completed
              ? 'bg-status-active border-status-active'
              : 'border-border-bright hover:border-text-secondary'
          }`}
        >
          {feature.completed && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(feature.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`text-text-primary text-sm font-display text-left flex-1 leading-tight hover:text-accent transition-colors ${feature.completed ? 'line-through' : ''}`}
        >
          {feature.description}
        </button>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 ml-6 mb-1">
        {feature.priority !== 'none' && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: priorityColor }}
            title={feature.priority}
          />
        )}
        {feature.autopilot && (
          <span className="text-accent shrink-0" title="AutoPilot">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </span>
        )}
        {totalCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-text-muted text-xs font-display hover:text-accent transition-colors flex items-center gap-1"
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {completedCount}/{totalCount}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(feature.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-auto"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Mini progress bar */}
      {totalCount > 0 && (
        <div className="ml-6 h-1 bg-surface-overlay rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Inline task list */}
      {expanded && totalCount > 0 && (
        <div className="ml-6 mt-2 space-y-0.5 border-t border-border/50 pt-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-1.5 group/task">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleTask(task); }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`shrink-0 w-3 h-3 rounded border transition-colors flex items-center justify-center ${
                  task.completed
                    ? 'bg-status-active border-status-active'
                    : 'border-border-bright hover:border-text-secondary'
                }`}
              >
                {task.completed && (
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              <span className={`text-xs leading-tight ${task.completed ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
                {task.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Kanban Column for Features ──────────────────────────────
function FeatureKanbanColumn({
  phase,
  label,
  features,
  featureTasksMap,
  onToggleComplete,
  onDelete,
  onExpand,
  onToggleTask,
}: {
  phase: Phase;
  label: string;
  features: Feature[];
  featureTasksMap: Record<string, Task[]>;
  onToggleComplete: (f: Feature) => void;
  onDelete: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleTask: (t: Task) => void;
}) {
  const { setNodeRef } = useDroppable({ id: `feature-${phase}` });

  return (
    <div className="theme-card theme-card-column bg-surface-overlay/80 backdrop-blur-sm p-3 flex flex-col min-h-32">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-semibold text-text-secondary">{label}</h3>
        <span className="bg-surface rounded-full px-2 py-0.5 text-xs text-text-muted">
          {features.length}
        </span>
      </div>
      <div ref={setNodeRef} className="flex-1 flex flex-col gap-2 min-h-8">
        <SortableContext items={features.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          {features.map((feat) => (
            <FeatureKanbanCard
              key={feat.id}
              feature={feat}
              tasks={featureTasksMap[feat.id] ?? []}
              onToggleComplete={onToggleComplete}
              onDelete={onDelete}
              onExpand={onExpand}
              onToggleTask={onToggleTask}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

// ── Feature Detail Drawer ───────────────────────────────────
function FeatureDrawer({
  feature,
  tasks,
  onClose,
  onToggleTask,
  onDeleteTask,
  onAddTask,
}: {
  feature: Feature;
  tasks: Task[];
  onClose: () => void;
  onToggleTask: (t: Task) => void;
  onDeleteTask: (t: Task) => void;
  onAddTask: (featureId: string, desc: string) => void;
}) {
  const [input, setInput] = useState('');
  const completed = tasks.filter((t) => t.completed).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-surface border-l border-border h-full overflow-y-auto p-6 animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold text-text-primary">Feature Tasks</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="text-text-secondary text-sm mb-1">{feature.description}</p>
        {feature.objective && (
          <p className="text-text-muted text-xs italic mb-4">{feature.objective}</p>
        )}

        {/* Progress */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>{completed}/{tasks.length} completed</span>
            <span>{tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0}%</span>
          </div>
          <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${tasks.length > 0 ? (completed / tasks.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Tasks */}
        <div className="space-y-1 mb-4">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-1.5 group/task">
              <button
                onClick={() => onToggleTask(task)}
                className={`shrink-0 w-3.5 h-3.5 rounded border transition-colors flex items-center justify-center ${
                  task.completed
                    ? 'bg-status-active border-status-active'
                    : 'border-border-bright hover:border-text-secondary'
                }`}
              >
                {task.completed && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              <span className={`text-text-primary text-xs flex-1 ${task.completed ? 'line-through opacity-50' : ''}`}>
                {task.description}
              </span>
              <button
                onClick={() => onDeleteTask(task)}
                className="shrink-0 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover/task:opacity-100"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              onAddTask(feature.id, input.trim());
              setInput('');
            }
          }}
          placeholder="Add task..."
          className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
        />
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [projectFeatures, setProjectFeatures] = useState<Feature[]>([]);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [projectDocs, setProjectDocs] = useState<Document[]>([]);
  const [allFeatureTasks, setAllFeatureTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [drawerFeature, setDrawerFeature] = useState<Feature | null>(null);
  const [activeFeature, setActiveFeature] = useState<Feature | null>(null);

  const [newFeature, setNewFeature] = useState('');
  const [newTask, setNewTask] = useState('');

  const [newDocName, setNewDocName] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [updating, setUpdating] = useState(false);

  // Tag editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // View toggle
  const [view, setView] = useState<'kanban' | 'list'>('kanban');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [proj, feats, allTasks, docs] = await Promise.all([
        projectsApi.get(id),
        featuresApi.list(id),
        tasksApi.list({ project_id: id }),
        documentsApi.list(id),
      ]);
      setProject(proj);
      setProjectFeatures(feats);
      // Separate project-level tasks vs feature tasks
      setProjectTasks(allTasks.filter((t) => !t.feature_id));
      setAllFeatureTasks(allTasks.filter((t) => t.feature_id));
      setProjectDocs(docs);
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-polling every 5s when autopilot is active
  useEffect(() => {
    if (!project?.autopilot || project?.paused) return;
    const interval = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(interval);
  }, [project?.autopilot, project?.paused, load]);

  // Tasks grouped by feature
  const featureTasksMap = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of allFeatureTasks) {
      if (t.feature_id) {
        (map[t.feature_id] ??= []).push(t);
      }
    }
    return map;
  }, [allFeatureTasks]);

  // Features grouped by phase for Kanban
  const featureColumns = useMemo(() => {
    const grouped: Record<Phase, Feature[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const feat of projectFeatures) {
      const phase = feat.phase ?? 'backlog';
      if (grouped[phase]) {
        grouped[phase].push(feat);
      } else {
        grouped.backlog.push(feat);
      }
    }
    return grouped;
  }, [projectFeatures]);

  // Drawer tasks
  const drawerTasks = useMemo(() => {
    if (!drawerFeature) return [];
    return allFeatureTasks.filter((t) => t.feature_id === drawerFeature.id);
  }, [drawerFeature, allFeatureTasks]);

  // ── Feature Kanban DnD ────────────────────────────────────
  function findFeatureColumn(featureId: string): Phase | null {
    for (const [phase, feats] of Object.entries(featureColumns)) {
      if (feats.some((f) => f.id === featureId)) return phase as Phase;
    }
    return null;
  }

  function handleFeatureDragStart(event: DragStartEvent) {
    const feat = projectFeatures.find((f) => f.id === event.active.id);
    setActiveFeature(feat ?? null);
  }

  function handleFeatureDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = (over.id as string).replace('feature-', '');

    const sourceCol = findFeatureColumn(activeId);
    const destCol = findFeatureColumn(overId) ?? (overId as Phase);

    if (!sourceCol || !destCol || sourceCol === destCol) return;

    setProjectFeatures((prev) =>
      prev.map((f) =>
        f.id === activeId ? { ...f, phase: destCol } : f,
      ),
    );
  }

  async function handleFeatureDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveFeature(null);
    if (!over) return;

    const activeId = active.id as string;
    const feat = projectFeatures.find((f) => f.id === activeId);
    if (!feat) return;

    // Persist the phase change
    try {
      await featuresApi.update(activeId, { phase: feat.phase });
    } catch {
      load(); // revert on error
    }
  }

  // ── CRUD helpers ──────────────────────────────────────────
  async function updateProject(data: Partial<Project>) {
    if (!project || updating) return;
    setUpdating(true);
    try {
      await projectsApi.update(project.id, data);
      setProject((prev) => (prev ? { ...prev, ...data } : prev));
    } catch (err) {
      console.error('Failed to update project:', err);
    } finally {
      setUpdating(false);
    }
  }

  async function deleteProject() {
    if (!project || !confirm('Delete this project?')) return;
    try {
      await projectsApi.delete(project.id);
      window.location.href = '/projects';
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }

  async function addFeature() {
    if (!newFeature.trim() || !id) return;
    try {
      const feat = await featuresApi.create({ project_id: id, description: newFeature.trim() });
      setProjectFeatures((prev) => [...prev, feat]);
      setNewFeature('');
    } catch (err) {
      console.error('Failed to create feature:', err);
    }
  }

  async function toggleFeatureCompleted(feat: Feature) {
    try {
      await featuresApi.update(feat.id, { completed: !feat.completed });
      setProjectFeatures((prev) =>
        prev.map((f) => (f.id === feat.id ? { ...f, completed: !f.completed } : f)),
      );
    } catch (err) {
      console.error('Failed to update feature:', err);
    }
  }

  async function deleteFeature(featId: string) {
    try {
      await featuresApi.delete(featId);
      setProjectFeatures((prev) => prev.filter((f) => f.id !== featId));
    } catch (err) {
      console.error('Failed to delete feature:', err);
    }
  }

  async function addProjectTask() {
    if (!newTask.trim() || !id) return;
    try {
      const task = await tasksApi.create({ description: newTask.trim(), project_id: id });
      setProjectTasks((prev) => [...prev, task]);
      setNewTask('');
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }

  async function toggleTaskCompleted(task: Task) {
    try {
      await tasksApi.update(task.id, { completed: !task.completed });
      if (task.feature_id) {
        setAllFeatureTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)),
        );
      } else {
        setProjectTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)),
        );
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  }

  async function deleteTask(task: Task) {
    try {
      await tasksApi.delete(task.id);
      if (task.feature_id) {
        setAllFeatureTasks((prev) => prev.filter((t) => t.id !== task.id));
      } else {
        setProjectTasks((prev) => prev.filter((t) => t.id !== task.id));
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }

  async function addFeatureTask(featureId: string, desc: string) {
    try {
      const task = await tasksApi.create({ description: desc, feature_id: featureId });
      setAllFeatureTasks((prev) => [...prev, task]);
    } catch (err) {
      console.error('Failed to create feature task:', err);
    }
  }

  // Documents
  async function addDocLink() {
    if (!newDocName.trim() || !id) return;
    try {
      const doc = await documentsApi.create({
        project_id: id,
        name: newDocName.trim(),
        url: newDocUrl.trim() || undefined,
      });
      setProjectDocs((prev) => [...prev, doc]);
      setNewDocName('');
      setNewDocUrl('');
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  }

  async function uploadFile(file: File) {
    if (!id) return;
    try {
      const doc = await documentsApi.upload(id, file);
      setProjectDocs((prev) => [...prev, doc]);
    } catch (err) {
      console.error('Failed to upload file:', err);
    }
  }

  async function deleteDoc(docId: string) {
    try {
      await documentsApi.delete(docId);
      setProjectDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  }

  // Tags
  function parseTags(tagsStr: string): string[] {
    return tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
  }

  function removeTag(tag: string) {
    if (!project) return;
    const tags = parseTags(project.tags).filter((t) => t !== tag);
    updateProject({ tags: tags.join(', ') });
  }

  function addTag() {
    if (!project || !tagInput.trim()) return;
    const current = parseTags(project.tags);
    if (!current.includes(tagInput.trim())) {
      current.push(tagInput.trim());
      updateProject({ tags: current.join(', ') });
    }
    setTagInput('');
    setEditingTags(false);
  }

  if (loading) {
    return (
      <div className="text-text-muted text-center py-20 font-display text-sm animate-fade-in">
        Loading...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-text-muted text-center py-20 font-display text-sm animate-fade-in">
        Project not found.
      </div>
    );
  }

  const tags = parseTags(project.tags);
  const totalTasks = projectTasks.length + allFeatureTasks.length;
  const completedTasks = projectTasks.filter((t) => t.completed).length + allFeatureTasks.filter((t) => t.completed).length;

  return (
    <div className="animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm mb-6">
        <Link to="/projects" className="text-text-muted hover:text-accent transition-colors">
          Projects
        </Link>
        <span className="text-text-muted">/</span>
        <span className="text-text-primary">{project.name}</span>
      </nav>

      {/* Header */}
      <div
        className="mb-8 pl-4"
        style={{ borderLeft: `3px solid ${project.color}` }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-text-primary mb-1">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-text-secondary mb-3">{project.description}</p>
            )}
          </div>
          <button
            onClick={deleteProject}
            className="text-text-muted hover:text-red-400 transition-colors p-1.5 shrink-0"
            title="Delete project"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {/* Phase */}
          <select
            value={project.phase}
            onChange={(e) => updateProject({ phase: e.target.value as Phase })}
            disabled={updating}
            className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-display focus:outline-none focus:border-border-bright transition-colors cursor-pointer"
          >
            {PHASE_COLUMNS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>

          {/* Priority */}
          <select
            value={project.priority}
            onChange={(e) => updateProject({ priority: e.target.value as Priority })}
            disabled={updating}
            className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-display focus:outline-none focus:border-border-bright transition-colors cursor-pointer"
          >
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>

          {/* AutoPilot */}
          <button
            onClick={() => updateProject({ autopilot: !project.autopilot })}
            disabled={updating}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-display border transition-colors ${
              project.autopilot
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-muted hover:text-text-secondary'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            AutoPilot
            {project.autopilot && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            )}
          </button>

          {/* Paused */}
          <button
            onClick={() => updateProject({ paused: !project.paused })}
            disabled={updating}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-display border transition-colors ${
              project.paused
                ? 'border-status-paused bg-status-paused/10 text-status-paused'
                : 'border-border text-text-muted hover:text-text-secondary'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
            Paused
          </button>

          {/* View toggle */}
          <div className="flex items-center border border-border rounded-md overflow-hidden ml-auto">
            <button
              onClick={() => setView('kanban')}
              className={`px-3 py-1.5 text-xs font-display transition-colors ${
                view === 'kanban' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Kanban
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-xs font-display transition-colors ${
                view === 'list' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              List
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-surface-overlay text-text-secondary text-xs px-2 py-0.5 rounded-full font-display"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="text-text-muted hover:text-red-400 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
          {editingTags ? (
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag();
                if (e.key === 'Escape') { setEditingTags(false); setTagInput(''); }
              }}
              onBlur={() => { if (!tagInput.trim()) setEditingTags(false); }}
              autoFocus
              placeholder="tag name"
              className="bg-surface border border-border rounded-md px-2 py-0.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright w-24"
            />
          ) : (
            <button
              onClick={() => setEditingTags(true)}
              className="text-text-muted hover:text-accent text-xs transition-colors"
            >
              + tag
            </button>
          )}
        </div>

        {/* Progress bar */}
        {totalTasks > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>{completedTasks}/{totalTasks} tasks completed</span>
              <span>{Math.round((completedTasks / totalTasks) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content sections */}
      <div className="space-y-6">
        {/* Features Kanban */}
        {view === 'kanban' ? (
          <section className="animate-fade-in" style={{ animationDelay: '100ms' }}>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-display text-lg font-bold text-text-primary">Features</h2>
              <span className="bg-border rounded-full px-2 py-0.5 text-xs font-display text-text-secondary">
                {projectFeatures.length}
              </span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleFeatureDragStart}
              onDragOver={handleFeatureDragOver}
              onDragEnd={handleFeatureDragEnd}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {PHASE_COLUMNS.map((col) => (
                  <FeatureKanbanColumn
                    key={col.key}
                    phase={col.key}
                    label={col.label}
                    features={featureColumns[col.key]}
                    featureTasksMap={featureTasksMap}
                    onToggleComplete={toggleFeatureCompleted}
                    onDelete={deleteFeature}
                    onExpand={(fid) => {
                      const feat = projectFeatures.find((f) => f.id === fid);
                      if (feat) setDrawerFeature(feat);
                    }}
                    onToggleTask={toggleTaskCompleted}
                  />
                ))}
              </div>

              <DragOverlay>
                {activeFeature ? (
                  <FeatureKanbanCard
                    feature={activeFeature}
                    tasks={featureTasksMap[activeFeature.id] ?? []}
                    isDragOverlay
                    onToggleComplete={() => {}}
                    onDelete={() => {}}
                    onExpand={() => {}}
                    onToggleTask={() => {}}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>

            <input
              type="text"
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFeature();
              }}
              placeholder="Add a feature..."
              className="w-full mt-3 bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
          </section>
        ) : (
          /* List view */
          <section className="theme-card bg-surface-raised p-5 animate-fade-in" style={{ animationDelay: '100ms' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-text-primary">Features</h2>
                <span className="bg-border rounded-full px-2 py-0.5 text-xs font-display text-text-secondary">
                  {projectFeatures.length}
                </span>
              </div>
            </div>

            <div className="space-y-1 mb-4">
              {projectFeatures.length === 0 && (
                <p className="text-text-muted text-sm py-4 text-center">No features yet</p>
              )}
              {projectFeatures.map((feat, i) => {
                const fTaskCount = (featureTasksMap[feat.id] ?? []).length;
                return (
                  <div
                    key={feat.id}
                    className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-surface-overlay transition-colors group animate-fade-in"
                    style={{ animationDelay: `${150 + i * 40}ms` }}
                  >
                    <button
                      onClick={() => toggleFeatureCompleted(feat)}
                      className={`shrink-0 w-4 h-4 rounded border-2 transition-colors flex items-center justify-center ${
                        feat.completed
                          ? 'bg-status-active border-status-active'
                          : 'border-border-bright hover:border-text-secondary'
                      }`}
                    >
                      {feat.completed && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>

                    <button
                      onClick={() => setDrawerFeature(feat)}
                      className={`text-text-primary text-sm truncate flex-1 text-left hover:text-accent transition-colors ${feat.completed ? 'line-through opacity-50' : ''}`}
                    >
                      {feat.description}
                    </button>

                    <span className="text-text-muted text-xs font-display bg-surface-overlay px-1.5 py-0.5 rounded">
                      {feat.phase}
                    </span>

                    <span className="text-text-muted text-xs">{fTaskCount} tasks</span>

                    {feat.autopilot && (
                      <span className="text-accent shrink-0" title="AutoPilot">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                      </span>
                    )}

                    {feat.priority !== 'none' && (
                      <span
                        className="shrink-0 w-2 h-2 rounded-full"
                        style={{ backgroundColor: getPriorityColor(feat.priority) }}
                        title={feat.priority}
                      />
                    )}

                    <button
                      onClick={() => deleteFeature(feat.id)}
                      className="shrink-0 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>

            <input
              type="text"
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFeature();
              }}
              placeholder="Add a feature..."
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
          </section>
        )}

        {/* Project Tasks section (tasks not tied to a feature) */}
        <section className="theme-card bg-surface-raised p-5 animate-fade-in" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-bold text-text-primary">Tasks</h2>
              <span className="bg-border rounded-full px-2 py-0.5 text-xs font-display text-text-secondary">
                {projectTasks.length}
              </span>
            </div>
          </div>

          <div className="space-y-1 mb-4">
            {projectTasks.length === 0 && (
              <p className="text-text-muted text-sm py-4 text-center">No tasks yet</p>
            )}
            {projectTasks.map((task, i) => (
              <div
                key={task.id}
                className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-surface-overlay transition-colors group animate-fade-in"
                style={{ animationDelay: `${250 + i * 40}ms` }}
              >
                <button
                  onClick={() => toggleTaskCompleted(task)}
                  className={`shrink-0 w-4 h-4 rounded border-2 transition-colors flex items-center justify-center ${
                    task.completed
                      ? 'bg-status-active border-status-active'
                      : 'border-border-bright hover:border-text-secondary'
                  }`}
                >
                  {task.completed && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <span className={`text-text-primary text-sm truncate flex-1 ${task.completed ? 'line-through opacity-50' : ''}`}>
                  {task.description}
                </span>
                <button
                  onClick={() => deleteTask(task)}
                  className="shrink-0 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addProjectTask();
            }}
            placeholder="Add a task..."
            className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
          />
        </section>

        {/* Documents section */}
        <section className="theme-card bg-surface-raised p-5 animate-fade-in" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-bold text-text-primary">Documents</h2>
              <span className="bg-border rounded-full px-2 py-0.5 text-xs font-display text-text-secondary">
                {projectDocs.length}
              </span>
            </div>
          </div>

          <div className="space-y-1 mb-4">
            {projectDocs.length === 0 && (
              <p className="text-text-muted text-sm py-4 text-center">No documents yet</p>
            )}
            {projectDocs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-surface-overlay transition-colors group"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent text-sm hover:underline truncate flex-1"
                  >
                    {doc.name}
                  </a>
                ) : (
                  <span className="text-text-primary text-sm truncate flex-1">{doc.name}</span>
                )}
                <button
                  onClick={() => deleteDoc(doc.id)}
                  className="shrink-0 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add link form */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
              placeholder="Document name"
              className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
            <input
              type="text"
              value={newDocUrl}
              onChange={(e) => setNewDocUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addDocLink();
              }}
              placeholder="URL (optional)"
              className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
            <button
              onClick={addDocLink}
              disabled={!newDocName.trim()}
              className="bg-accent text-surface font-display font-semibold rounded-md px-3 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              Add
            </button>
          </div>

          {/* Upload file */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-text-muted hover:text-accent text-sm font-display transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload file
          </button>
        </section>
      </div>

      {/* Feature detail drawer */}
      {drawerFeature && (
        <FeatureDrawer
          feature={drawerFeature}
          tasks={drawerTasks}
          onClose={() => setDrawerFeature(null)}
          onToggleTask={toggleTaskCompleted}
          onDeleteTask={deleteTask}
          onAddTask={addFeatureTask}
        />
      )}
    </div>
  );
}
