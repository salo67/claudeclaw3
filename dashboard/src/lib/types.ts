export type Phase = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface Project {
  id: string;
  name: string;
  description: string;
  phase: Phase;
  completed: boolean;
  autopilot: boolean;
  paused: boolean;
  priority: Priority;
  tags: string;
  color: string;
  created_at: number;
  updated_at: number;
  features?: Feature[];
  tasks?: Task[];
  documents?: Document[];
}

export interface Feature {
  id: string;
  project_id: string;
  description: string;
  objective: string;
  acceptance_criteria: string;
  phase: Phase;
  autopilot: boolean;
  priority: Priority;
  completed: boolean;
  position: number;
  wave: number;
  created_at: number;
  updated_at: number;
  tasks?: Task[];
}

export interface Task {
  id: string;
  project_id: string | null;
  feature_id: string | null;
  description: string;
  acceptance_criteria: string;
  completed: boolean;
  verification_status: string;
  verification_output: string;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface Document {
  id: string;
  project_id: string;
  name: string;
  url: string;
  file_path: string;
  created_at: number;
}

export const PHASE_COLUMNS: { key: Phase; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

export const PRIORITIES: { key: Priority; label: string; color: string }[] = [
  { key: 'none', label: 'Ninguna', color: '#525252' },
  { key: 'low', label: 'Baja', color: '#3b82f6' },
  { key: 'medium', label: 'Media', color: '#f59e0b' },
  { key: 'high', label: 'Alta', color: '#f97316' },
  { key: 'critical', label: 'Critica', color: '#ef4444' },
];

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string;
  project_id: string | null;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface JournalEntry {
  id: string;
  date: string;
  content: string;
  mood: string;
  tags: string;
  bot_prompts: string;
  created_at: number;
  updated_at: number;
}

export interface Alert {
  id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  action: string;
  source: string;
  dismissed: boolean;
  executed: boolean;
  created_at: number;
}

export interface StatusData {
  online: boolean;
  uptime_seconds: number;
  scheduled_tasks: Array<{
    id: string;
    prompt: string;
    schedule: string;
    status: string;
    next_run: number;
    last_run: number | null;
  }>;
  recent_memories: Array<{
    id: number;
    content: string;
    sector: string;
    salience: number;
    created_at: number;
  }>;
  recent_conversation: Array<{
    role: string;
    content: string;
    created_at: number;
  }>;
  token_usage_today: {
    turns: number;
    total_input: number;
    total_output: number;
    peak_cache_read: number;
    total_cost: number;
    compactions: number;
  } | null;
}
