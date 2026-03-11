# Control Center - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal command center dashboard (React + Vite) that manages projects, ideas, and tasks with Kanban views, served as both a local web app and a Telegram Web App.

**Architecture:** Express API server embedded in the ClaudeClaw process, serving JSON endpoints from the existing SQLite DB (new tables for projects/ideas/tasks). React + Vite frontend with Tailwind CSS, built to `dashboard/dist/` and served as static files by the same Express server. Telegram Web App button opens the dashboard URL.

**Tech Stack:** React 18, Vite, Tailwind CSS, Express.js, better-sqlite3 (existing), @dnd-kit (Kanban drag-and-drop)

**Design Direction:** Dark command-center aesthetic. Matte black backgrounds (#0a0a0a) with warm amber (#f59e0b) as primary accent and cool slate grays for structure. Typography: "JetBrains Mono" for headers/data (monospace authority), "DM Sans" for body text. Subtle grid-pattern background texture. Cards with thin 1px borders that glow on hover. Kanban columns with frosted-glass effect. Status indicators as pulsing dots. Staggered fade-in animations on load.

---

## Phase 1: Database Schema + API Server

### Task 1: Add new tables to SQLite schema

**Files:**
- Modify: `src/db.ts` (add tables inside `createSchema()`)

**Step 1: Add project/idea/task tables to the schema**

Add these tables inside the `createSchema()` function in `src/db.ts`, after the existing `CREATE TABLE` statements:

```typescript
// Add inside createSchema(), after existing tables:

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  color       TEXT DEFAULT '#f59e0b',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ideas (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ideas_project ON ideas(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'backlog',
  priority    INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, position);
```

Valid statuses:
- **projects**: `active`, `paused`, `completed`, `archived`
- **ideas**: `new`, `exploring`, `parked`, `promoted`
- **tasks**: `backlog`, `todo`, `in_progress`, `done`

**Step 2: Add CRUD functions for projects**

Add to `src/db.ts`:

```typescript
import crypto from 'crypto';

// ── Projects ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export function createProject(name: string, description = '', color = '#f59e0b'): Project {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO projects (id, name, description, color, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, name, description, color, now, now);
  return { id, name, description, status: 'active', color, created_at: now, updated_at: now };
}

export function getAllProjects(): Project[] {
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

export function getProject(id: string): Project | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function updateProject(id: string, fields: Partial<Pick<Project, 'name' | 'description' | 'status' | 'color'>>): void {
  const now = Math.floor(Date.now() / 1000);
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) { sets.push(`${key} = ?`); values.push(val); }
  }
  values.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteProject(id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
```

**Step 3: Add CRUD functions for ideas**

```typescript
// ── Ideas ──────────────────────────────────────────────────────

export interface Idea {
  id: string;
  project_id: string | null;
  content: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export function createIdea(content: string, projectId?: string): Idea {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO ideas (id, project_id, content, status, created_at, updated_at)
     VALUES (?, ?, ?, 'new', ?, ?)`
  ).run(id, projectId ?? null, content, now, now);
  return { id, project_id: projectId ?? null, content, status: 'new', created_at: now, updated_at: now };
}

export function getAllIdeas(): Idea[] {
  return db.prepare('SELECT * FROM ideas ORDER BY created_at DESC').all() as Idea[];
}

export function getIdeasByProject(projectId: string): Idea[] {
  return db.prepare('SELECT * FROM ideas WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Idea[];
}

export function updateIdea(id: string, fields: Partial<Pick<Idea, 'content' | 'status' | 'project_id'>>): void {
  const now = Math.floor(Date.now() / 1000);
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) { sets.push(`${key} = ?`); values.push(val); }
  }
  values.push(id);
  db.prepare(`UPDATE ideas SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteIdea(id: string): void {
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
}
```

**Step 4: Add CRUD functions for tasks**

```typescript
// ── Tasks ──────────────────────────────────────────────────────

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export function createTask(title: string, projectId?: string, description = ''): Task {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // Position: get max position in backlog + 1
  const maxPos = db.prepare(
    `SELECT COALESCE(MAX(position), 0) as mp FROM tasks WHERE status = 'backlog'`
  ).get() as { mp: number };
  const position = maxPos.mp + 1;
  db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'backlog', 0, ?, ?, ?)`
  ).run(id, projectId ?? null, title, description, position, now, now);
  return { id, project_id: projectId ?? null, title, description, status: 'backlog', priority: 0, position, created_at: now, updated_at: now };
}

export function getAllTasks(): Task[] {
  return db.prepare('SELECT * FROM tasks ORDER BY position ASC').all() as Task[];
}

export function getTasksByProject(projectId: string): Task[] {
  return db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY position ASC').all(projectId) as Task[];
}

export function getTasksByStatus(status: string): Task[] {
  return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY position ASC').all(status) as Task[];
}

export function updateTask(id: string, fields: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'position' | 'project_id'>>): void {
  const now = Math.floor(Date.now() / 1000);
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) { sets.push(`${key} = ?`); values.push(val); }
  }
  values.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
```

**Step 5: Commit**

```bash
git add src/db.ts
git commit -m "feat(db): add projects, ideas, tasks tables and CRUD functions"
```

---

### Task 2: Create the API server

**Files:**
- Create: `src/api.ts`
- Modify: `src/config.ts` (add API_PORT)
- Modify: `src/index.ts` (start API server)
- Modify: `package.json` (add express dependency)

**Step 1: Install express**

```bash
npm install express
npm install -D @types/express
```

**Step 2: Add API_PORT to config**

Add to `src/config.ts`:

```typescript
export const API_PORT = parseInt(process.env.API_PORT || envConfig.API_PORT || '3777', 10);
```

Also add `'API_PORT'` to the `readEnvFile()` keys array.

**Step 3: Create `src/api.ts`**

```typescript
import express from 'express';
import path from 'path';
import {
  getAllProjects, getProject, createProject, updateProject, deleteProject,
  getAllIdeas, getIdeasByProject, createIdea, updateIdea, deleteIdea,
  getAllTasks, getTasksByProject, getTasksByStatus, createTask, updateTask, deleteTask,
  getAllScheduledTasks, getRecentMemories, getRecentConversation,
} from './db.js';
import { API_PORT, PROJECT_ROOT, ALLOWED_CHAT_ID } from './config.js';
import { logger } from './logger.js';

export function startApiServer(): void {
  const app = express();
  app.use(express.json());

  // CORS for local dev
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });

  // Serve dashboard static files
  const dashboardDist = path.join(PROJECT_ROOT, 'dashboard', 'dist');
  app.use(express.static(dashboardDist));

  // ── Projects ──
  app.get('/api/projects', (_req, res) => {
    res.json(getAllProjects());
  });

  app.get('/api/projects/:id', (req, res) => {
    const p = getProject(req.params.id);
    if (!p) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({
      ...p,
      ideas: getIdeasByProject(p.id),
      tasks: getTasksByProject(p.id),
    });
  });

  app.post('/api/projects', (req, res) => {
    const { name, description, color } = req.body;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    res.status(201).json(createProject(name, description, color));
  });

  app.patch('/api/projects/:id', (req, res) => {
    updateProject(req.params.id, req.body);
    res.json(getProject(req.params.id));
  });

  app.delete('/api/projects/:id', (req, res) => {
    deleteProject(req.params.id);
    res.sendStatus(204);
  });

  // ── Ideas ──
  app.get('/api/ideas', (_req, res) => {
    res.json(getAllIdeas());
  });

  app.post('/api/ideas', (req, res) => {
    const { content, project_id } = req.body;
    if (!content) { res.status(400).json({ error: 'content required' }); return; }
    res.status(201).json(createIdea(content, project_id));
  });

  app.patch('/api/ideas/:id', (req, res) => {
    updateIdea(req.params.id, req.body);
    res.json({ ok: true });
  });

  app.delete('/api/ideas/:id', (req, res) => {
    deleteIdea(req.params.id);
    res.sendStatus(204);
  });

  // ── Tasks ──
  app.get('/api/tasks', (req, res) => {
    const { status } = req.query;
    if (status && typeof status === 'string') {
      res.json(getTasksByStatus(status));
    } else {
      res.json(getAllTasks());
    }
  });

  app.post('/api/tasks', (req, res) => {
    const { title, project_id, description } = req.body;
    if (!title) { res.status(400).json({ error: 'title required' }); return; }
    res.status(201).json(createTask(title, project_id, description));
  });

  app.patch('/api/tasks/:id', (req, res) => {
    updateTask(req.params.id, req.body);
    res.json({ ok: true });
  });

  app.delete('/api/tasks/:id', (req, res) => {
    deleteTask(req.params.id);
    res.sendStatus(204);
  });

  // ── ClaudeClaw Status ──
  app.get('/api/status', (_req, res) => {
    const scheduledTasks = getAllScheduledTasks();
    const memories = getRecentMemories(ALLOWED_CHAT_ID, 10);
    const conversation = getRecentConversation(ALLOWED_CHAT_ID, 15);

    res.json({
      online: true,
      uptime: process.uptime(),
      scheduled_tasks: scheduledTasks,
      recent_memories: memories,
      recent_conversation: conversation,
    });
  });

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'));
  });

  app.listen(API_PORT, () => {
    logger.info({ port: API_PORT }, 'Control Center API running');
  });
}
```

**Step 4: Wire API server into `src/index.ts`**

Add import and call `startApiServer()` after `initDatabase()`:

```typescript
import { startApiServer } from './api.js';

// Inside main(), after initDatabase():
startApiServer();
```

**Step 5: Commit**

```bash
git add src/api.ts src/config.ts src/index.ts package.json package-lock.json
git commit -m "feat(api): add Express API server for control center"
```

---

## Phase 2: React Dashboard Frontend

### Task 3: Scaffold React + Vite + Tailwind project

**Step 1: Create Vite project**

```bash
cd <project_root>
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Step 2: Configure Tailwind**

In `dashboard/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3777',
    },
  },
});
```

In `dashboard/src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-surface: #0a0a0a;
  --color-surface-raised: #141414;
  --color-surface-overlay: #1a1a1a;
  --color-border: #262626;
  --color-border-bright: #404040;
  --color-accent: #f59e0b;
  --color-accent-dim: #b45309;
  --color-text-primary: #fafafa;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #525252;
  --color-status-active: #22c55e;
  --color-status-paused: #f59e0b;
  --color-status-done: #3b82f6;
  --font-display: 'JetBrains Mono', monospace;
  --font-body: 'DM Sans', sans-serif;
}

@layer base {
  body {
    @apply bg-surface text-text-primary font-body antialiased;
    background-image:
      radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0);
    background-size: 24px 24px;
  }
}
```

Add Google Fonts to `dashboard/index.html` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Step 3: Commit**

```bash
git add dashboard/
git commit -m "feat(dashboard): scaffold React + Vite + Tailwind project"
```

---

### Task 4: Create API client and types

**Files:**
- Create: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/lib/types.ts`

**Step 1: Create types**

`dashboard/src/lib/types.ts`:

```typescript
export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  color: string;
  created_at: number;
  updated_at: number;
  ideas?: Idea[];
  tasks?: Task[];
}

export interface Idea {
  id: string;
  project_id: string | null;
  content: string;
  status: 'new' | 'exploring' | 'parked' | 'promoted';
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  priority: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export type TaskStatus = Task['status'];

export const KANBAN_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export interface StatusData {
  online: boolean;
  uptime: number;
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
}
```

**Step 2: Create API client**

`dashboard/src/lib/api.ts`:

```typescript
import type { Project, Idea, Task, StatusData } from './types';

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

// Projects
export const projects = {
  list: () => request<Project[]>('/projects'),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (data: { name: string; description?: string; color?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

// Ideas
export const ideas = {
  list: () => request<Idea[]>('/ideas'),
  create: (data: { content: string; project_id?: string }) =>
    request<Idea>('/ideas', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Idea>) =>
    request<void>(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/ideas/${id}`, { method: 'DELETE' }),
};

// Tasks
export const tasks = {
  list: (status?: string) => request<Task[]>(`/tasks${status ? `?status=${status}` : ''}`),
  create: (data: { title: string; project_id?: string; description?: string }) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Task>) =>
    request<void>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
};

// Status
export const status = {
  get: () => request<StatusData>('/status'),
};
```

**Step 3: Commit**

```bash
git add dashboard/src/lib/
git commit -m "feat(dashboard): add API client and TypeScript types"
```

---

### Task 5: Build the main layout and navigation

**Files:**
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/components/Layout.tsx`
- Create: `dashboard/src/components/Sidebar.tsx`

**Step 1: Create Sidebar**

Navigation with 4 sections: Overview, Kanban, Projects, Status. Use icons (inline SVGs). Active state with amber accent bar on the left. Monospace font for section labels.

**Step 2: Create Layout**

Full-height flex layout. Sidebar on left (240px, collapsible on mobile). Main content area with subtle top border gradient (amber to transparent).

**Step 3: Create App with routing**

Use React Router (install `react-router-dom`). Routes:
- `/` - Overview page
- `/kanban` - Kanban board
- `/projects` - Projects list
- `/projects/:id` - Project detail (hub view)
- `/status` - ClaudeClaw status

**Step 4: Commit**

```bash
git add dashboard/src/
git commit -m "feat(dashboard): add layout, sidebar navigation, routing"
```

---

### Task 6: Build the Overview page

**Files:**
- Create: `dashboard/src/pages/OverviewPage.tsx`
- Create: `dashboard/src/components/StatCard.tsx`
- Create: `dashboard/src/components/QuickAdd.tsx`

**Step 1: Overview layout**

Three-column grid at top showing stat cards:
- Total projects (active count)
- Open tasks (non-done count)
- Ideas (total count)

Below: two-column layout
- Left: Recent tasks (latest 5, with status badges)
- Right: Recent ideas (latest 5, with quick-promote action)

Bottom: Quick-add bar - input field that creates a task or idea with a toggle.

Cards use `bg-surface-raised` with `border-border` and amber glow on hover.

Staggered fade-in animation on page load (each card delayed by 50ms).

**Step 2: Commit**

```bash
git add dashboard/src/pages/OverviewPage.tsx dashboard/src/components/
git commit -m "feat(dashboard): add overview page with stats and quick-add"
```

---

### Task 7: Build the Kanban board

**Files:**
- Create: `dashboard/src/pages/KanbanPage.tsx`
- Create: `dashboard/src/components/KanbanColumn.tsx`
- Create: `dashboard/src/components/TaskCard.tsx`

**Step 1: Kanban layout**

Four columns: Backlog, To Do, In Progress, Done. Each column has:
- Header with column name (JetBrains Mono) + task count badge
- Frosted glass effect: `backdrop-blur-sm bg-surface-overlay/80`
- Droppable area using @dnd-kit
- "Add task" button at bottom of each column

**Step 2: TaskCard component**

Draggable card with:
- Task title
- Project badge (colored dot + name) if assigned
- Priority indicator (colored left border: red=high, amber=medium, gray=low)
- Delete button (appears on hover)
- Edit-in-place for title (click to edit)

**Step 3: Drag and drop**

Use @dnd-kit/core + @dnd-kit/sortable for:
- Drag between columns (updates task status via API)
- Reorder within column (updates position via API)
- Drag overlay with slight rotation and shadow for visual feedback

**Step 4: Commit**

```bash
git add dashboard/src/pages/KanbanPage.tsx dashboard/src/components/Kanban* dashboard/src/components/TaskCard.tsx
git commit -m "feat(dashboard): add kanban board with drag-and-drop"
```

---

### Task 8: Build the Projects page and Project detail (hub view)

**Files:**
- Create: `dashboard/src/pages/ProjectsPage.tsx`
- Create: `dashboard/src/pages/ProjectDetailPage.tsx`
- Create: `dashboard/src/components/ProjectCard.tsx`
- Create: `dashboard/src/components/CreateProjectModal.tsx`

**Step 1: Projects list page**

Grid of project cards. Each card shows:
- Project name (JetBrains Mono, bold)
- Description (DM Sans, muted)
- Status badge (colored pill)
- Stats row: X tasks, Y ideas
- Colored left border matching project color
- Click navigates to project detail

"New Project" button opens a modal with name, description, color picker.

**Step 2: Project detail page (hub view)**

Top section: Project name, description, status dropdown, color.

Two-column layout below:
- Left: Project tasks (mini kanban or list with status badges, add task inline)
- Right: Project ideas (list with status badges, add idea inline)

Breadcrumb navigation: Projects > Project Name

**Step 3: Commit**

```bash
git add dashboard/src/pages/Project* dashboard/src/components/Project* dashboard/src/components/CreateProject*
git commit -m "feat(dashboard): add projects page and project hub detail view"
```

---

### Task 9: Build the Status page

**Files:**
- Create: `dashboard/src/pages/StatusPage.tsx`
- Create: `dashboard/src/components/StatusIndicator.tsx`

**Step 1: Status page layout**

Top: Big status indicator (pulsing green dot + "Online" in JetBrains Mono) and uptime counter.

Grid below with three sections:
1. **Scheduled Tasks**: Table showing prompt, schedule (cron in human-readable), status, next run, last run. Active tasks have green dot, paused have amber.
2. **Recent Memories**: Cards showing content, sector badge, salience bar (visual), created date. Sorted by salience.
3. **Recent Conversation**: Chat-style display. User messages right-aligned (amber bg), assistant messages left-aligned (surface-raised bg). Timestamps shown.

Auto-refresh every 30 seconds via `setInterval` + API call.

**Step 2: Commit**

```bash
git add dashboard/src/pages/StatusPage.tsx dashboard/src/components/StatusIndicator.tsx
git commit -m "feat(dashboard): add ClaudeClaw status page"
```

---

## Phase 3: Telegram Web App Integration

### Task 10: Configure Telegram Web App

**Files:**
- Modify: `src/bot.ts` (add /dashboard command)

**Step 1: Add menu button and /dashboard command**

In the bot setup, add:

```typescript
// Set the menu button to open the dashboard
bot.api.setChatMenuButton({
  menu_button: {
    type: 'web_app',
    text: 'Control Center',
    web_app: { url: `https://<YOUR_DOMAIN_OR_NGROK>/` },
  },
});

// Also add /dashboard command
bot.command('dashboard', async (ctx) => {
  await ctx.reply('Open your Control Center:', {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Open Dashboard', web_app: { url: `https://<YOUR_DOMAIN_OR_NGROK>/` } },
      ]],
    },
  });
});
```

**NOTE:** For Telegram Web Apps, the URL must be HTTPS. Options:
- Use ngrok: `ngrok http 3777` to get a public HTTPS URL
- Or deploy to a VPS with SSL
- Add `DASHBOARD_URL` to `.env` and `config.ts`

**Step 2: Add Telegram Web App script to dashboard**

In `dashboard/index.html`, add:

```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

In the React app, detect if running inside Telegram and adapt:
- Use `window.Telegram.WebApp.themeParams` for color hints
- Call `window.Telegram.WebApp.ready()` on mount
- Expand to full height: `window.Telegram.WebApp.expand()`

**Step 3: Commit**

```bash
git add src/bot.ts dashboard/index.html dashboard/src/
git commit -m "feat(telegram): add Web App integration for control center"
```

---

## Phase 4: Build and Wire Together

### Task 11: Build pipeline and final integration

**Step 1: Add build script to root package.json**

Add to `package.json` scripts:

```json
"build:dashboard": "cd dashboard && npm run build",
"build:all": "npm run build:dashboard && npm run build"
```

**Step 2: Build the dashboard**

```bash
cd dashboard && npm run build
```

This outputs to `dashboard/dist/` which the Express server already serves as static files.

**Step 3: Test the full flow**

1. Start ClaudeClaw: `npm run dev`
2. Open `http://localhost:3777` in browser
3. Verify: Overview loads, can create projects/ideas/tasks, Kanban drag works, Status page shows live data
4. Test via Telegram: /dashboard command opens Web App

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete control center dashboard v1"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | Tasks 1-2 | DB tables + REST API |
| 2 | Tasks 3-9 | Full React dashboard |
| 3 | Task 10 | Telegram Web App |
| 4 | Task 11 | Build pipeline + integration |

**Total estimated tasks:** 11
**Key dependencies:** Phase 1 must complete before Phase 2 can fetch data. Phase 2 must complete before Phase 3 makes sense to test. Phase 4 ties everything together.
