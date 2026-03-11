import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../lib/types';

interface TaskCardProps {
  task: Task;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  isDragOverlay?: boolean;
}

export default function TaskCard({ task, onUpdate, onDelete, isDragOverlay }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={isDragOverlay ? undefined : style}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={`
        relative theme-card bg-surface-raised p-3
        transition-all duration-150 cursor-grab active:cursor-grabbing
        ${isDragOverlay ? 'rotate-2 shadow-xl shadow-black/40' : ''}
      `}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUpdate(task.id, { completed: !task.completed });
          }}
          onPointerDown={(e) => e.stopPropagation()}
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
        <p className={`text-text-primary text-sm font-medium flex-1 ${task.completed ? 'line-through opacity-50' : ''}`}>
          {task.description}
        </p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-text-muted hover:text-red-400 transition-colors text-xs opacity-0 group-hover:opacity-100"
          aria-label="Delete task"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
