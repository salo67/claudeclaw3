import { useEffect, useState } from 'react';
import { projects as projectsApi, features as featuresApi, tasks as tasksApi } from '../lib/api';
import type { Project, Feature, Task, Phase, Priority } from '../lib/types';
import { PRIORITIES } from '../lib/types';
import StatCard from '../components/StatCard';
import CreateProjectModal from '../components/CreateProjectModal';
import { Link } from 'react-router-dom';

function timeAgo(unixTimestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - unixTimestamp);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const phaseStyles: Record<Phase, string> = {
  backlog: 'bg-text-muted/20 text-text-muted',
  todo: 'bg-status-done/20 text-status-done',
  in_progress: 'bg-accent/20 text-accent',
  review: 'bg-yellow-500/20 text-yellow-500',
  done: 'bg-status-active/20 text-status-active',
};

const phaseLabels: Record<Phase, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

function getPriorityColor(p: Priority): string {
  return PRIORITIES.find((pr) => pr.key === p)?.color ?? '#525252';
}

export default function OverviewPage() {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [featureList, setFeatureList] = useState<Feature[]>([]);
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchAll = async () => {
    try {
      const [p, f, t] = await Promise.all([
        projectsApi.list(),
        featuresApi.list(),
        tasksApi.list(),
      ]);
      setProjectList(p);
      setFeatureList(f);
      setTaskList(t);
    } catch (err) {
      console.error('Failed to fetch overview data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  function handleCreated(project: Project) {
    setProjectList((prev) => [...prev, project]);
    setModalOpen(false);
  }

  const activeProjects = projectList.filter((p) => p.phase !== 'done' && !p.completed).length;
  const featuresInProgress = featureList.filter((f) => f.phase === 'in_progress').length;
  const openTasks = taskList.filter((t) => !t.completed).length;
  const autopilotQueue = projectList.filter((p) => p.autopilot && !p.completed).length;

  const recentProjects = [...projectList]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);

  const recentFeatures = [...featureList]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-accent mb-1">Overview</h1>
          <p className="text-text-secondary text-sm">System summary and recent activity</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="theme-card bg-surface-raised p-5 h-28 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-accent mb-1">Overview</h1>
        <p className="text-text-secondary text-sm">System summary and recent activity</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5V16a1 1 0 001 1h14a1 1 0 001-1V7a1 1 0 00-1-1h-7L8 4H3a1 1 0 00-1 1z" />
            </svg>
          }
          label="Active Projects"
          value={activeProjects}
          delay={0}
        />
        <StatCard
          icon={
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <path d="M7 7h6M7 10h6M7 13h4" />
            </svg>
          }
          label="Features In Progress"
          value={featuresInProgress}
          delay={50}
        />
        <StatCard
          icon={
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8" />
              <path d="M7 10l2 2 4-4" />
            </svg>
          }
          label="Open Tasks"
          value={openTasks}
          delay={100}
        />
        <StatCard
          icon={
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          }
          label="AutoPilot Queue"
          value={autopilotQueue}
          delay={150}
        />
      </div>

      {/* Two columns: Recent Projects + Recent Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Projects */}
        <div
          className="animate-fade-in bg-surface-raised rounded-lg border border-border p-4"
          style={{ animationDelay: '200ms' }}
        >
          <h2 className="font-display text-lg text-text-primary mb-3">Recent Projects</h2>
          {recentProjects.length === 0 ? (
            <p className="text-text-muted text-sm">No projects yet</p>
          ) : (
            <div className="space-y-2">
              {recentProjects.map((proj) => (
                <Link
                  key={proj.id}
                  to={`/projects/${proj.id}`}
                  className="flex items-center gap-3 py-1.5 hover:bg-surface-overlay rounded px-1 transition-colors"
                >
                  <span
                    className="flex-shrink-0 w-2 h-2 rounded-full"
                    style={{ backgroundColor: proj.color }}
                  />
                  <span className="text-text-primary text-sm truncate flex-1">
                    {proj.name}
                  </span>
                  {proj.priority !== 'none' && (
                    <span
                      className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: getPriorityColor(proj.priority) }}
                    />
                  )}
                  <span
                    className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs font-display ${phaseStyles[proj.phase]}`}
                  >
                    {phaseLabels[proj.phase]}
                  </span>
                  <span className="text-text-muted text-xs flex-shrink-0">
                    {timeAgo(proj.updated_at)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Features */}
        <div
          className="animate-fade-in bg-surface-raised rounded-lg border border-border p-4"
          style={{ animationDelay: '250ms' }}
        >
          <h2 className="font-display text-lg text-text-primary mb-3">Recent Features</h2>
          {recentFeatures.length === 0 ? (
            <p className="text-text-muted text-sm">No features yet</p>
          ) : (
            <div className="space-y-2">
              {recentFeatures.map((feat) => (
                <div
                  key={feat.id}
                  className="flex items-center gap-3 py-1.5"
                >
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${feat.completed ? 'bg-status-active' : 'bg-accent'}`}
                  />
                  <span className={`text-text-primary text-sm truncate flex-1 ${feat.completed ? 'line-through opacity-50' : ''}`}>
                    {feat.description}
                  </span>
                  {feat.priority !== 'none' && (
                    <span
                      className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: getPriorityColor(feat.priority) }}
                    />
                  )}
                  <span className="text-text-muted text-xs flex-shrink-0">
                    {timeAgo(feat.updated_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Project button */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: '300ms' }}
      >
        <button
          onClick={() => setModalOpen(true)}
          className="bg-accent text-surface rounded-md px-4 py-2 font-display font-semibold text-sm hover:bg-accent/90 transition-colors"
        >
          New Project
        </button>
      </div>

      <CreateProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
