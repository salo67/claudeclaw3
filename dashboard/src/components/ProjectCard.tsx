import { Link } from 'react-router-dom';
import type { Project, Phase, Priority } from '../lib/types';
import { PRIORITIES } from '../lib/types';

interface ProjectCardProps {
  project: Project & { featureCount: number; taskCount: number };
  delay?: number;
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

export default function ProjectCard({ project, delay = 0 }: ProjectCardProps) {
  const tags = project.tags
    ? project.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <Link to={'/projects/' + project.id}>
      <div
        className="animate-fade-in theme-card bg-surface-raised p-5 transition-all duration-200 cursor-pointer"
        style={{
          animationDelay: `${delay}ms`,
          borderLeftWidth: '3px',
          borderLeftColor: project.color,
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-display text-lg font-bold text-text-primary truncate">
              {project.name}
            </h3>
            {project.autopilot && (
              <span className="shrink-0 text-accent" title="AutoPilot">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </span>
            )}
            {project.paused && (
              <span className="shrink-0 text-status-paused" title="Paused">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {project.priority !== 'none' && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: getPriorityColor(project.priority) }}
                title={project.priority}
              />
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-display ${phaseStyles[project.phase]}`}
            >
              {phaseLabels[project.phase]}
            </span>
          </div>
        </div>

        {project.description && (
          <p className="text-text-secondary text-sm line-clamp-2 mb-3">
            {project.description}
          </p>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map((tag) => (
              <span
                key={tag}
                className="bg-surface-overlay text-text-muted text-xs px-2 py-0.5 rounded-full font-display"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="text-text-muted text-xs font-display">
          {project.featureCount} feature{project.featureCount !== 1 ? 's' : ''} &middot;{' '}
          {project.taskCount} task{project.taskCount !== 1 ? 's' : ''}
        </p>
      </div>
    </Link>
  );
}
