import type { Project, Feature, Task, Document, Note, JournalEntry, Alert, StatusData } from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const projects = {
  list: () => request<Project[]>('/projects'),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (data: { name: string; description?: string; color?: string; phase?: string; priority?: string; tags?: string; autopilot?: boolean; paused?: boolean }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

export const features = {
  list: (projectId?: string) => request<Feature[]>(`/features${projectId ? `?project_id=${projectId}` : ''}`),
  get: (id: string) => request<Feature>(`/features/${id}`),
  create: (data: { project_id: string; description: string; objective?: string; autopilot?: boolean; priority?: string }) =>
    request<Feature>('/features', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Feature>) =>
    request<void>(`/features/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/features/${id}`, { method: 'DELETE' }),
};

export const tasks = {
  list: (params?: { project_id?: string; feature_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.project_id) qs.set('project_id', params.project_id);
    if (params?.feature_id) qs.set('feature_id', params.feature_id);
    const q = qs.toString();
    return request<Task[]>(`/tasks${q ? `?${q}` : ''}`);
  },
  create: (data: { description: string; project_id?: string; feature_id?: string }) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Task>) =>
    request<void>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
};

export const documents = {
  list: (projectId: string) => request<Document[]>(`/documents?project_id=${projectId}`),
  create: (data: { project_id: string; name: string; url?: string }) =>
    request<Document>('/documents', { method: 'POST', body: JSON.stringify(data) }),
  upload: async (projectId: string, file: File): Promise<Document> => {
    const formData = new FormData();
    formData.append('project_id', projectId);
    formData.append('file', file);
    const res = await fetch(`${BASE}/documents/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
  delete: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
};

export const notes = {
  list: (params?: { search?: string; tags?: string; project_id?: string; pinned?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.tags) qs.set('tags', params.tags);
    if (params?.project_id) qs.set('project_id', params.project_id);
    if (params?.pinned !== undefined) qs.set('pinned', String(params.pinned));
    const q = qs.toString();
    return request<Note[]>(`/notes${q ? `?${q}` : ''}`);
  },
  get: (id: string) => request<Note>(`/notes/${id}`),
  create: (data: { title?: string; content?: string; tags?: string; project_id?: string; pinned?: boolean }) =>
    request<Note>('/notes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Note>) =>
    request<Note>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/notes/${id}`, { method: 'DELETE' }),
};

export const journal = {
  list: (limit = 30, offset = 0) =>
    request<JournalEntry[]>(`/journal?limit=${limit}&offset=${offset}`),
  dates: (year?: number, month?: number) => {
    const qs = new URLSearchParams();
    if (year) qs.set('year', String(year));
    if (month) qs.set('month', String(month));
    const q = qs.toString();
    return request<string[]>(`/journal/dates${q ? `?${q}` : ''}`);
  },
  get: (date: string) => request<JournalEntry>(`/journal/${date}`),
  upsert: (date: string, data: { content?: string; mood?: string; tags?: string }) =>
    request<JournalEntry>(`/journal/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ date, ...data }),
    }),
  delete: (date: string) => request<void>(`/journal/${date}`, { method: 'DELETE' }),
  prompt: () => request<{ prompt: string }>('/journal/ai/prompt'),
  summary: (weeks = 1) =>
    fetch(`/api/journal/ai/summary?weeks=${weeks}`, { method: 'POST' }),
};

export const alerts = {
  list: (dismissed = false) => request<Alert[]>(`/alerts?dismissed=${dismissed}`),
  create: (data: { category?: string; severity?: string; title: string; description?: string; action?: string; source?: string }) =>
    request<Alert>('/alerts', { method: 'POST', body: JSON.stringify(data) }),
  dismiss: (id: string) => request<Alert>(`/alerts/${id}/dismiss`, { method: 'PATCH' }),
  execute: (id: string) => request<Alert>(`/alerts/${id}/execute`, { method: 'PATCH' }),
  delete: (id: string) => request<void>(`/alerts/${id}`, { method: 'DELETE' }),
};

export const status = {
  get: () => request<StatusData>('/status'),
};

// ── Advisor ─────────────────────────────────────────────────

export interface AdvisorThread {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_message: string;
}

export interface AdvisorMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  agent_role: string;
  created_at: number;
  image_data?: string;
  model_used?: string;
}

export interface AgentInfo {
  key: string;
  label: string;
  color: string;
  avatar: string;
  name: string;
  bg_color: string;
  voice_id: string;
}

export const advisor = {
  agents: () => request<AgentInfo[]>('/advisor/agents'),
  threads: () => request<AdvisorThread[]>('/advisor/threads'),
  createThread: (title?: string) =>
    request<AdvisorThread>('/advisor/threads', { method: 'POST', body: JSON.stringify({ title: title || '' }) }),
  deleteThread: (id: string) =>
    request<void>(`/advisor/threads/${id}`, { method: 'DELETE' }),
  messages: (threadId: string) =>
    request<AdvisorMessage[]>(`/advisor/threads/${threadId}/messages`),
  send: (threadId: string, content: string, agentRole?: string, imageData?: string, model?: string) =>
    fetch(`/api/advisor/threads/${threadId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, agent_role: agentRole || null, image_data: imageData || null, model: model || null }),
    }),
  setThreadModel: (threadId: string, defaultModel: string) =>
    request<{ ok: boolean; default_model: string }>(`/advisor/threads/${threadId}/model`, {
      method: 'PATCH',
      body: JSON.stringify({ default_model: defaultModel }),
    }),
};

export const tts = {
  speak: (text: string, voiceId: string) =>
    fetch(`/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }),
    }),
};
