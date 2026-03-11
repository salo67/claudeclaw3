import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, Phase } from '../lib/types';
import TaskCard from './TaskCard';

interface KanbanColumnProps {
  status: Phase;
  label: string;
  tasks: Task[];
  onUpdateTask: (id: string, data: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
}

export default function KanbanColumn({
  status,
  label,
  tasks,
  onUpdateTask,
  onDeleteTask,
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div className="theme-card bg-surface-overlay/80 backdrop-blur-sm p-3 flex flex-col min-h-32">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-semibold text-text-secondary">{label}</h3>
        <span className="bg-surface rounded-full px-2 py-0.5 text-xs text-text-muted">
          {tasks.length}
        </span>
      </div>

      <div ref={setNodeRef} className="flex-1 flex flex-col gap-2 min-h-8">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
