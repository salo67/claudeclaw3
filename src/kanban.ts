/**
 * Kanban API client — CRUD for projects, features, tasks via FastAPI.
 * Formatting helpers for Telegram display.
 */

import { API_PORT } from './config.js';

const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

// ── Types ────────────────────────────────────────────────────

export interface KanbanProject {
  id: string;
  name: string;
  description: string;
  phase: string;
  completed: boolean;
  autopilot: boolean;
  paused: boolean;
  priority: string;
  color: string;
  features?: KanbanFeature[];
  tasks?: KanbanTask[];
}

export interface KanbanFeature {
  id: string;
  project_id: string;
  description: string;
  objective: string;
  phase: string;
  autopilot: boolean;
  priority: string;
  completed: boolean;
  position: number;
  tasks?: KanbanTask[];
}

export interface KanbanTask {
  id: string;
  project_id: string | null;
  feature_id: string | null;
  description: string;
  completed: boolean;
  position: number;
}

// ── API calls ────────────────────────────────────────────────

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function listProjects(): Promise<KanbanProject[]> {
  return api<KanbanProject[]>('/projects');
}

export async function getProject(id: string): Promise<KanbanProject> {
  return api<KanbanProject>(`/projects/${id}`);
}

export async function createProject(name: string): Promise<KanbanProject> {
  return api<KanbanProject>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listFeatures(projectId: string): Promise<KanbanFeature[]> {
  return api<KanbanFeature[]>(`/features?project_id=${projectId}`);
}

export async function updateFeature(id: string, data: Partial<KanbanFeature>): Promise<void> {
  await api<void>(`/features/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function createFeature(projectId: string, description: string): Promise<KanbanFeature> {
  return api<KanbanFeature>('/features', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, description }),
  });
}

export async function listTasks(params: { project_id?: string; feature_id?: string }): Promise<KanbanTask[]> {
  const qs = new URLSearchParams();
  if (params.project_id) qs.set('project_id', params.project_id);
  if (params.feature_id) qs.set('feature_id', params.feature_id);
  const q = qs.toString();
  return api<KanbanTask[]>(`/tasks${q ? `?${q}` : ''}`);
}

export async function updateTask(id: string, data: Partial<KanbanTask>): Promise<void> {
  await api<void>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function createTask(description: string, projectId?: string, featureId?: string): Promise<KanbanTask> {
  return api<KanbanTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ description, project_id: projectId, feature_id: featureId }),
  });
}

// ── Phase helpers ────────────────────────────────────────────

const PHASE_ALIASES: Record<string, string> = {
  b: 'backlog',
  t: 'todo',
  ip: 'in_progress',
  d: 'done',
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'in_progress',
  done: 'done',
};

export function resolvePhase(input: string): string | null {
  return PHASE_ALIASES[input.toLowerCase()] ?? null;
}

const PHASE_EMOJI: Record<string, string> = {
  backlog: '📋',
  todo: '📝',
  in_progress: '🔨',
  done: '✅',
};

const PRIORITY_EMOJI: Record<string, string> = {
  none: '',
  low: '🔵',
  medium: '🟡',
  high: '🟠',
  critical: '🔴',
};

// ── Telegram formatting ──────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatProjectList(projects: KanbanProject[]): string {
  if (projects.length === 0) return 'No projects yet.';

  const lines = projects.map((p, i) => {
    const phase = PHASE_EMOJI[p.phase] || p.phase;
    const priority = PRIORITY_EMOJI[p.priority] || '';
    const auto = p.autopilot ? ' ⚡' : '';
    const paused = p.paused ? ' ⏸' : '';
    return `${i + 1}. ${priority}${phase} <b>${escapeHtml(p.name)}</b>${auto}${paused}`;
  });

  return `📊 <b>Projects</b>\n\n${lines.join('\n')}\n\n<i>Send number to open • /projects to close</i>`;
}

export function formatProjectDetail(
  project: KanbanProject,
  features: KanbanFeature[],
  tasksByFeature: Map<string, KanbanTask[]>,
): string {
  const header = `📊 <b>${escapeHtml(project.name)}</b>`;
  const phases = ['backlog', 'todo', 'in_progress', 'done'];
  const sections: string[] = [];
  let featureNum = 1;

  for (const phase of phases) {
    const phaseFeatures = features.filter((f) => f.phase === phase);
    if (phaseFeatures.length === 0) continue;

    const emoji = PHASE_EMOJI[phase] || '';
    const label = phase.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const featureLines = phaseFeatures.map((f) => {
      const tasks = tasksByFeature.get(f.id) || [];
      const done = tasks.filter((t) => t.completed).length;
      const total = tasks.length;
      const progress = total > 0 ? ` (${done}/${total})` : '';
      const pri = PRIORITY_EMOJI[f.priority] || '';
      const line = `  ${featureNum}. ${pri}${escapeHtml(f.description)}${progress}`;
      featureNum++;
      return line;
    });

    sections.push(`${emoji} <b>${label}</b>\n${featureLines.join('\n')}`);
  }

  const body = sections.length > 0 ? sections.join('\n\n') : '<i>No features yet</i>';
  const help = [
    'm &lt;num&gt; &lt;phase&gt; - move feature',
    'd &lt;num&gt; - mark task done',
    'new &lt;text&gt; - add feature',
    'b - back to list',
  ].join('\n');

  return `${header}\n\n${body}\n\n<i>${help}</i>`;
}
