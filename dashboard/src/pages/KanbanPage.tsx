import { useState, useEffect, useMemo, useCallback } from 'react';
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
import type { Project, Feature, Task, Phase } from '../lib/types';
import { PHASE_COLUMNS, PRIORITIES } from '../lib/types';
import { projects as projectsApi, features as featuresApi, tasks as tasksApi } from '../lib/api';
import { Link } from 'react-router-dom';

type ViewMode = 'projects' | 'features';
type ProjectWithCounts = Project & { featureCount: number; taskCount: number };

// ── Project Card (draggable) ────────────────────────────────
function KanbanProjectCard({
  project,
  isDragOverlay,
}: {
  project: ProjectWithCounts;
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = isDragOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      };

  const priorityColor = PRIORITIES.find((p) => p.key === project.priority)?.color ?? '#525252';

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={{
        ...style,
        borderLeftWidth: '3px',
        borderLeftColor: project.color,
      }}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={`
        theme-card bg-surface-raised p-3
        transition-all duration-150 cursor-grab active:cursor-grabbing
        ${isDragOverlay ? 'rotate-2 shadow-xl shadow-black/40' : ''}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <Link
          to={`/projects/${project.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-text-primary text-sm font-display font-semibold truncate flex-1 hover:text-accent transition-colors"
        >
          {project.name}
        </Link>
        {project.autopilot && (
          <span className="text-accent shrink-0" title="AutoPilot">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </span>
        )}
        {project.paused && (
          <span className="text-status-paused shrink-0" title="Paused">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {project.priority !== 'none' && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: priorityColor }}
            title={project.priority}
          />
        )}
        <span className="text-text-muted text-xs font-display">
          {project.featureCount} feat &middot; {project.taskCount} task{project.taskCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

// ── Feature Card (draggable) ────────────────────────────────
function KanbanFeatureCard({
  feature,
  projectName,
  projectColor,
  taskCount,
  completedTaskCount,
  isDragOverlay,
}: {
  feature: Feature;
  projectName: string;
  projectColor: string;
  taskCount: number;
  completedTaskCount: number;
  isDragOverlay?: boolean;
}) {
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

  const priorityColor = PRIORITIES.find((p) => p.key === feature.priority)?.color ?? '#525252';
  const progress = taskCount > 0 ? (completedTaskCount / taskCount) * 100 : 0;

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={{
        ...style,
        borderLeftWidth: '3px',
        borderLeftColor: projectColor,
      }}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={`
        theme-card bg-surface-raised p-3
        transition-all duration-150 cursor-grab active:cursor-grabbing
        ${isDragOverlay ? 'rotate-1 shadow-xl shadow-black/40' : ''}
        ${feature.completed ? 'opacity-60' : ''}
      `}
    >
      {/* Project label */}
      <Link
        to={`/projects/${feature.project_id}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-text-muted text-[10px] font-display uppercase tracking-wider hover:text-accent transition-colors"
      >
        {projectName}
      </Link>

      {/* Feature description */}
      <p className={`text-text-primary text-sm font-display leading-tight mt-0.5 mb-1.5 ${feature.completed ? 'line-through' : ''}`}>
        {feature.description}
      </p>

      {/* Meta row */}
      <div className="flex items-center gap-2">
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
        {taskCount > 0 && (
          <span className="text-text-muted text-xs font-display">
            {completedTaskCount}/{taskCount}
          </span>
        )}
      </div>

      {/* Mini progress bar */}
      {taskCount > 0 && (
        <div className="h-1 bg-surface-overlay rounded-full overflow-hidden mt-1.5">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Generic Kanban Column ───────────────────────────────────
function KanbanColumn({
  droppableId,
  label,
  count,
  children,
}: {
  droppableId: string;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: droppableId });

  return (
    <div className="theme-card theme-card-column bg-surface-overlay/80 backdrop-blur-sm p-3 flex flex-col min-h-32">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-semibold text-text-secondary">{label}</h3>
        <span className="bg-surface rounded-full px-2 py-0.5 text-xs text-text-muted">
          {count}
        </span>
      </div>
      <div ref={setNodeRef} className="flex-1 flex flex-col gap-2 min-h-8">
        {children}
      </div>
    </div>
  );
}

// ── Main Kanban Page ────────────────────────────────────────
export default function KanbanPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('features');
  const [allProjects, setAllProjects] = useState<ProjectWithCounts[]>([]);
  const [allFeatures, setAllFeatures] = useState<Feature[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Drag state
  const [activeProject, setActiveProject] = useState<ProjectWithCounts | null>(null);
  const [activeFeature, setActiveFeature] = useState<Feature | null>(null);

  // Project filter for feature view
  const [filterProjectId, setFilterProjectId] = useState<string>('all');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const fetchAll = useCallback(async () => {
    try {
      const [projs, feats, tks] = await Promise.all([
        projectsApi.list(),
        featuresApi.list(),
        tasksApi.list(),
      ]);
      const enriched: ProjectWithCounts[] = projs.map((p) => ({
        ...p,
        featureCount: feats.filter((f) => f.project_id === p.id).length,
        taskCount: tks.filter((t) => t.project_id === p.id).length,
      }));
      setAllProjects(enriched);
      setAllFeatures(feats);
      setAllTasks(tks);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Project name/color lookup
  const projectMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {};
    for (const p of allProjects) {
      map[p.id] = { name: p.name, color: p.color };
    }
    return map;
  }, [allProjects]);

  // Task counts per feature
  const featureTaskInfo = useMemo(() => {
    const info: Record<string, { total: number; completed: number }> = {};
    for (const t of allTasks) {
      if (t.feature_id) {
        if (!info[t.feature_id]) info[t.feature_id] = { total: 0, completed: 0 };
        info[t.feature_id].total++;
        if (t.completed) info[t.feature_id].completed++;
      }
    }
    return info;
  }, [allTasks]);

  // Filtered features
  const visibleFeatures = useMemo(() => {
    if (filterProjectId === 'all') return allFeatures;
    return allFeatures.filter((f) => f.project_id === filterProjectId);
  }, [allFeatures, filterProjectId]);

  // ── Project columns ───────────────────────────────────────
  const projectColumns = useMemo(() => {
    const grouped: Record<Phase, ProjectWithCounts[]> = {
      backlog: [], todo: [], in_progress: [], review: [], done: [],
    };
    for (const p of allProjects) {
      grouped[p.phase]?.push(p);
    }
    return grouped;
  }, [allProjects]);

  // ── Feature columns ───────────────────────────────────────
  const featureColumns = useMemo(() => {
    const grouped: Record<Phase, Feature[]> = {
      backlog: [], todo: [], in_progress: [], review: [], done: [],
    };
    for (const f of visibleFeatures) {
      const phase = f.phase ?? 'backlog';
      (grouped[phase] ?? grouped.backlog).push(f);
    }
    return grouped;
  }, [visibleFeatures]);

  // ── DnD: Projects ────────────────────────────────────────
  function findProjectColumn(projectId: string): Phase | null {
    for (const [phase, projs] of Object.entries(projectColumns)) {
      if (projs.some((p) => p.id === projectId)) return phase as Phase;
    }
    return null;
  }

  function handleProjectDragStart(event: DragStartEvent) {
    setActiveProject(allProjects.find((p) => p.id === event.active.id) ?? null);
  }

  function handleProjectDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const sourceCol = findProjectColumn(activeId);
    const destCol = findProjectColumn(overId) ?? (overId.replace('proj-', '') as Phase);
    if (!sourceCol || !destCol || sourceCol === destCol) return;
    setAllProjects((prev) => prev.map((p) => p.id === activeId ? { ...p, phase: destCol } : p));
  }

  async function handleProjectDragEnd(event: DragEndEvent) {
    setActiveProject(null);
    const { active, over } = event;
    if (!over) return;
    const project = allProjects.find((p) => p.id === (active.id as string));
    if (!project) return;
    try {
      await projectsApi.update(project.id, { phase: project.phase });
    } catch {
      fetchAll();
    }
  }

  // ── DnD: Features ────────────────────────────────────────
  function findFeatureColumn(featureId: string): Phase | null {
    for (const [phase, feats] of Object.entries(featureColumns)) {
      if (feats.some((f) => f.id === featureId)) return phase as Phase;
    }
    return null;
  }

  function handleFeatureDragStart(event: DragStartEvent) {
    setActiveFeature(allFeatures.find((f) => f.id === event.active.id) ?? null);
  }

  function handleFeatureDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = (over.id as string).replace('feat-', '');
    const sourceCol = findFeatureColumn(activeId);
    const destCol = findFeatureColumn(overId) ?? (overId as Phase);
    if (!sourceCol || !destCol || sourceCol === destCol) return;
    setAllFeatures((prev) => prev.map((f) => f.id === activeId ? { ...f, phase: destCol } : f));
  }

  async function handleFeatureDragEnd(event: DragEndEvent) {
    setActiveFeature(null);
    const { active } = event;
    const feat = allFeatures.find((f) => f.id === (active.id as string));
    if (!feat) return;
    try {
      await featuresApi.update(feat.id, { phase: feat.phase });
    } catch {
      fetchAll();
    }
  }

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-accent mb-1">Kanban</h1>
        <p className="text-text-secondary text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-accent mb-1">Kanban</h1>
          <p className="text-text-secondary text-sm">
            {viewMode === 'projects' ? 'Projects by phase' : 'Features by phase'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Project filter (feature view only) */}
          {viewMode === 'features' && (
            <select
              value={filterProjectId}
              onChange={(e) => setFilterProjectId(e.target.value)}
              className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-display focus:outline-none focus:border-border-bright transition-colors cursor-pointer"
            >
              <option value="all">All projects</option>
              {allProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* View toggle */}
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('projects')}
              className={`px-3 py-1.5 text-xs font-display transition-colors ${
                viewMode === 'projects' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Projects
            </button>
            <button
              onClick={() => setViewMode('features')}
              className={`px-3 py-1.5 text-xs font-display transition-colors ${
                viewMode === 'features' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Features
            </button>
          </div>
        </div>
      </div>

      {/* ── Project Kanban ─────────────────────────────────── */}
      {viewMode === 'projects' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleProjectDragStart}
          onDragOver={handleProjectDragOver}
          onDragEnd={handleProjectDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {PHASE_COLUMNS.map((col) => (
              <div key={col.key} className="min-w-[280px]">
                <KanbanColumn
                  droppableId={`proj-${col.key}`}
                  label={col.label}
                  count={projectColumns[col.key].length}
                >
                  <SortableContext items={projectColumns[col.key].map((p) => p.id)} strategy={verticalListSortingStrategy}>
                    {projectColumns[col.key].map((project) => (
                      <KanbanProjectCard key={project.id} project={project} />
                    ))}
                  </SortableContext>
                </KanbanColumn>
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeProject ? (
              <KanbanProjectCard project={activeProject} isDragOverlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* ── Feature Kanban ─────────────────────────────────── */}
      {viewMode === 'features' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleFeatureDragStart}
          onDragOver={handleFeatureDragOver}
          onDragEnd={handleFeatureDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {PHASE_COLUMNS.map((col) => (
              <div key={col.key} className="min-w-[280px]">
                <KanbanColumn
                  droppableId={`feat-${col.key}`}
                  label={col.label}
                  count={featureColumns[col.key].length}
                >
                  <SortableContext items={featureColumns[col.key].map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    {featureColumns[col.key].map((feat) => {
                      const proj = projectMap[feat.project_id];
                      const info = featureTaskInfo[feat.id];
                      return (
                        <KanbanFeatureCard
                          key={feat.id}
                          feature={feat}
                          projectName={proj?.name ?? '?'}
                          projectColor={proj?.color ?? '#525252'}
                          taskCount={info?.total ?? 0}
                          completedTaskCount={info?.completed ?? 0}
                        />
                      );
                    })}
                  </SortableContext>
                </KanbanColumn>
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeFeature ? (
              <KanbanFeatureCard
                feature={activeFeature}
                projectName={projectMap[activeFeature.project_id]?.name ?? '?'}
                projectColor={projectMap[activeFeature.project_id]?.color ?? '#525252'}
                taskCount={featureTaskInfo[activeFeature.id]?.total ?? 0}
                completedTaskCount={featureTaskInfo[activeFeature.id]?.completed ?? 0}
                isDragOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
