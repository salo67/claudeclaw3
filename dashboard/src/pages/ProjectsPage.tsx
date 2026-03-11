import { useState, useEffect } from 'react';
import { projects as projectsApi, features as featuresApi, tasks as tasksApi } from '../lib/api';
import type { Project, Phase, Feature, Task } from '../lib/types';
import { PHASE_COLUMNS } from '../lib/types';
import ProjectCard from '../components/ProjectCard';
import CreateProjectModal from '../components/CreateProjectModal';

type ProjectWithCounts = Project & { featureCount: number; taskCount: number };

type FilterPhase = Phase | 'all';

const filterTabs: { key: FilterPhase; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PHASE_COLUMNS,
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterPhase>('all');

  async function load() {
    try {
      const [allProjects, allFeatures, allTasks] = await Promise.all([
        projectsApi.list(),
        featuresApi.list(),
        tasksApi.list(),
      ]);

      const enriched: ProjectWithCounts[] = allProjects.map((p: Project) => ({
        ...p,
        featureCount: allFeatures.filter((f: Feature) => f.project_id === p.id).length,
        taskCount: allTasks.filter((t: Task) => t.project_id === p.id).length,
      }));

      setProjects(enriched);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleCreated(project: Project) {
    setProjects((prev) => [...prev, { ...project, featureCount: 0, taskCount: 0 }]);
    setModalOpen(false);
  }

  const phaseCounts = PHASE_COLUMNS.reduce(
    (acc, col) => {
      acc[col.key] = projects.filter((p) => p.phase === col.key).length;
      return acc;
    },
    {} as Record<Phase, number>,
  );

  const filtered = activeFilter === 'all'
    ? projects
    : projects.filter((p) => p.phase === activeFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 animate-fade-in">
        <h1 className="font-display text-2xl text-accent">Projects</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-accent text-surface rounded-md px-4 py-2 font-display font-semibold text-sm hover:bg-accent/90 transition-colors"
        >
          New Project
        </button>
      </div>

      {/* Phase stat cards */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {PHASE_COLUMNS.map((col, i) => (
            <div
              key={col.key}
              className="animate-fade-in theme-card bg-surface-raised p-4 transition-all duration-200"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <p className="text-text-muted text-xs font-display mb-1">{col.label}</p>
              <p className="font-display text-2xl font-bold text-text-primary">{phaseCounts[col.key]}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {!loading && projects.length > 0 && (
        <div className="flex gap-1 mb-5 animate-fade-in" style={{ animationDelay: '200ms' }}>
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-display transition-colors ${
                activeFilter === tab.key
                  ? 'bg-accent text-surface'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-text-muted text-center py-20 font-display text-sm">Loading...</div>
      ) : projects.length === 0 ? (
        <div className="text-text-muted text-center py-20 font-display text-sm">
          No projects yet. Create one to get started.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-text-muted text-center py-12 font-display text-sm">
          No projects in this phase.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((project, i) => (
            <ProjectCard key={project.id} project={project} delay={i * 60} />
          ))}
        </div>
      )}

      <CreateProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
