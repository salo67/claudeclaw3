# ClaudeClaw Control Center - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full-featured control center dashboard where the user can manage projects, ideas, and tasks with Kanban + hierarchical views, plus monitor ClaudeClaw status — accessible as a web app and Telegram Web App.

**Architecture:** FastAPI backend serving a REST API from the existing ClaudeClaw SQLite DB (with new tables for projects/ideas/tasks). React + Vite + Tailwind frontend with three main views: Overview, Kanban, and Project Hub. The dashboard connects to Telegram as a Web App via bot menu button.

**Tech Stack:** Python 3.11+ / FastAPI / SQLite (existing DB) | React 18 / Vite / Tailwind CSS / @dnd-kit (drag-and-drop for Kanban) / Recharts (charts)

---

## Phase 1: Backend (FastAPI + DB)

### Task 1: Project scaffolding and dependencies

**Files:**
- Create: `dashboard-api/requirements.txt`
- Create: `dashboard-api/app/__init__.py`
- Create: `dashboard-api/app/main.py`
- Create: `dashboard-api/app/config.py`

**Step 1: Create the dashboard-api directory and requirements**

```
dashboard-api/
  requirements.txt
  app/
    __init__.py
    main.py
    config.py
```

`requirements.txt`:
```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
aiosqlite>=0.20.0
pydantic>=2.0.0
```

**Step 2: Create config.py**

```python
import os
from pathlib import Path

# ClaudeClaw store directory — same SQLite DB the bot uses
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STORE_DIR = PROJECT_ROOT / "store"
DB_PATH = STORE_DIR / "claudeclaw.db"
API_PORT = int(os.environ.get("DASHBOARD_PORT", "8420"))
# CORS origin for the React dev server
CORS_ORIGINS = ["http://localhost:5173", "http://localhost:8420"]
```

**Step 3: Create main.py with CORS and health check**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .config import CORS_ORIGINS

app = FastAPI(title="ClaudeClaw Control Center", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

**Step 4: Verify the server starts**

```bash
cd dashboard-api
pip install -r requirements.txt
uvicorn app.main:app --port 8420 --reload
# GET http://localhost:8420/api/health -> {"status": "ok"}
```

**Step 5: Commit**

```bash
git add dashboard-api/
git commit -m "feat(dashboard): scaffold FastAPI backend with health check"
```

---

### Task 2: Database layer — new tables for projects, ideas, tasks

**Files:**
- Create: `dashboard-api/app/database.py`
- Create: `dashboard-api/app/models.py`

**Step 1: Create database.py with connection and schema migration**

```python
import sqlite3
from contextlib import contextmanager
from .config import DB_PATH

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

@contextmanager
def get_db_ctx():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def run_migrations():
    with get_db_ctx() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS cc_projects (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                color       TEXT DEFAULT '#6366f1',
                status      TEXT NOT NULL DEFAULT 'active',
                position    INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cc_ideas (
                id          TEXT PRIMARY KEY,
                project_id  TEXT,
                content     TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'captured',
                position    INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES cc_projects(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS cc_tasks (
                id          TEXT PRIMARY KEY,
                project_id  TEXT,
                title       TEXT NOT NULL,
                description TEXT DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'todo',
                priority    TEXT NOT NULL DEFAULT 'medium',
                position    INTEGER NOT NULL DEFAULT 0,
                due_date    INTEGER,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES cc_projects(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cc_ideas_project ON cc_ideas(project_id);
            CREATE INDEX IF NOT EXISTS idx_cc_tasks_project ON cc_tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_cc_tasks_status ON cc_tasks(status);
        """)
```

Statuses:
- **Projects**: `active`, `paused`, `completed`, `archived`
- **Ideas**: `captured`, `exploring`, `validated`, `discarded`
- **Tasks**: `todo`, `in_progress`, `done`
- **Priority**: `low`, `medium`, `high`, `urgent`

**Step 2: Create Pydantic models in models.py**

```python
from pydantic import BaseModel
from typing import Optional

# --- Projects ---
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    color: str = "#6366f1"

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None
    position: Optional[int] = None

class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    color: str
    status: str
    position: int
    created_at: int
    updated_at: int
    task_count: int = 0
    idea_count: int = 0
    done_count: int = 0

# --- Ideas ---
class IdeaCreate(BaseModel):
    content: str
    project_id: Optional[str] = None

class IdeaUpdate(BaseModel):
    content: Optional[str] = None
    project_id: Optional[str] = None
    status: Optional[str] = None
    position: Optional[int] = None

class IdeaOut(BaseModel):
    id: str
    project_id: Optional[str]
    content: str
    status: str
    position: int
    created_at: int
    updated_at: int

# --- Tasks ---
class TaskCreate(BaseModel):
    title: str
    description: str = ""
    project_id: Optional[str] = None
    priority: str = "medium"
    due_date: Optional[int] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    position: Optional[int] = None
    due_date: Optional[int] = None

class TaskOut(BaseModel):
    id: str
    project_id: Optional[str]
    title: str
    description: str
    status: str
    priority: str
    position: int
    due_date: Optional[int]
    created_at: int
    updated_at: int
```

**Step 3: Wire migrations into app startup**

In `main.py`, add:
```python
from .database import run_migrations

@app.on_event("startup")
def on_startup():
    run_migrations()
```

**Step 4: Commit**

```bash
git add dashboard-api/app/database.py dashboard-api/app/models.py dashboard-api/app/main.py
git commit -m "feat(dashboard): add DB schema for projects, ideas, tasks"
```

---

### Task 3: CRUD API routes — Projects

**Files:**
- Create: `dashboard-api/app/routes/__init__.py`
- Create: `dashboard-api/app/routes/projects.py`

**Step 1: Create projects router**

```python
# dashboard-api/app/routes/projects.py
import uuid
import time
from fastapi import APIRouter, HTTPException
from ..database import get_db_ctx
from ..models import ProjectCreate, ProjectUpdate, ProjectOut

router = APIRouter(prefix="/api/projects", tags=["projects"])

@router.get("/", response_model=list[ProjectOut])
def list_projects():
    with get_db_ctx() as db:
        rows = db.execute("""
            SELECT p.*,
                COUNT(DISTINCT t.id) as task_count,
                COUNT(DISTINCT i.id) as idea_count,
                COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) as done_count
            FROM cc_projects p
            LEFT JOIN cc_tasks t ON t.project_id = p.id
            LEFT JOIN cc_ideas i ON i.project_id = p.id
            GROUP BY p.id
            ORDER BY p.position, p.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]

@router.post("/", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate):
    now = int(time.time())
    pid = uuid.uuid4().hex[:12]
    with get_db_ctx() as db:
        db.execute(
            "INSERT INTO cc_projects (id, name, description, color, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (pid, body.name, body.description, body.color, now, now)
        )
        row = db.execute("SELECT *, 0 as task_count, 0 as idea_count, 0 as done_count FROM cc_projects WHERE id=?", (pid,)).fetchone()
        return dict(row)

@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str):
    with get_db_ctx() as db:
        row = db.execute("""
            SELECT p.*,
                COUNT(DISTINCT t.id) as task_count,
                COUNT(DISTINCT i.id) as idea_count,
                COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) as done_count
            FROM cc_projects p
            LEFT JOIN cc_tasks t ON t.project_id = p.id
            LEFT JOIN cc_ideas i ON i.project_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
        """, (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        return dict(row)

@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, body: ProjectUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = int(time.time())
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [project_id]
    with get_db_ctx() as db:
        db.execute(f"UPDATE cc_projects SET {set_clause} WHERE id=?", values)
        return get_project(project_id)

@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str):
    with get_db_ctx() as db:
        db.execute("DELETE FROM cc_projects WHERE id=?", (project_id,))
```

**Step 2: Register router in main.py**

```python
from .routes.projects import router as projects_router
app.include_router(projects_router)
```

**Step 3: Test manually with curl/httpie**

```bash
# Create project
curl -X POST http://localhost:8420/api/projects -H "Content-Type: application/json" -d '{"name":"ClaudeClaw","description":"Mi asistente personal"}'
# List projects
curl http://localhost:8420/api/projects
```

**Step 4: Commit**

```bash
git add dashboard-api/app/routes/
git commit -m "feat(dashboard): add projects CRUD API"
```

---

### Task 4: CRUD API routes — Ideas and Tasks

**Files:**
- Create: `dashboard-api/app/routes/ideas.py`
- Create: `dashboard-api/app/routes/tasks.py`

Same CRUD pattern as projects. Key endpoints:

**Ideas:**
- `GET /api/ideas?project_id=X` — list all or filter by project
- `POST /api/ideas` — create
- `PATCH /api/ideas/{id}` — update (including status for Kanban moves)
- `DELETE /api/ideas/{id}` — delete

**Tasks:**
- `GET /api/tasks?project_id=X&status=Y` — list with optional filters
- `POST /api/tasks` — create
- `PATCH /api/tasks/{id}` — update (status, position for Kanban drag)
- `DELETE /api/tasks/{id}` — delete

**Kanban-specific:** `PATCH /api/tasks/reorder` — accepts `{task_id, status, position}` to handle drag-and-drop reordering.

**Step N: Commit**

```bash
git add dashboard-api/app/routes/ideas.py dashboard-api/app/routes/tasks.py
git commit -m "feat(dashboard): add ideas and tasks CRUD API"
```

---

### Task 5: ClaudeClaw Status API

**Files:**
- Create: `dashboard-api/app/routes/status.py`

**Step 1: Create status router that reads existing ClaudeClaw tables**

```python
# dashboard-api/app/routes/status.py
from fastapi import APIRouter
from ..database import get_db_ctx

router = APIRouter(prefix="/api/status", tags=["status"])

@router.get("/")
def get_status():
    with get_db_ctx() as db:
        # Bot online check: PID file
        import os
        from ..config import STORE_DIR
        pid_file = STORE_DIR / "claudeclaw.pid"
        bot_online = False
        if pid_file.exists():
            try:
                pid = int(pid_file.read_text().strip())
                os.kill(pid, 0)  # signal 0 = check if alive
                bot_online = True
            except (ValueError, ProcessLookupError, PermissionError):
                pass

        # Session info
        session = db.execute("SELECT * FROM sessions LIMIT 1").fetchone()

        # Token usage summary (last 24h and all-time)
        usage_24h = db.execute("""
            SELECT COUNT(*) as turns,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(cost_usd) as cost_usd
            FROM token_usage
            WHERE created_at > unixepoch() - 86400
        """).fetchone()

        usage_total = db.execute("""
            SELECT COUNT(*) as turns,
                   SUM(cost_usd) as cost_usd,
                   SUM(did_compact) as compactions
            FROM token_usage
        """).fetchone()

        # Recent conversations (last 10)
        recent_convos = db.execute("""
            SELECT role, substr(content, 1, 200) as content, created_at
            FROM conversation_log
            ORDER BY created_at DESC LIMIT 10
        """).fetchall()

        # Scheduled tasks
        scheduled = db.execute("""
            SELECT id, prompt, schedule, next_run, last_run, status
            FROM scheduled_tasks
            ORDER BY next_run
        """).fetchall()

        # Memories count
        memory_count = db.execute("SELECT COUNT(*) as c FROM memories").fetchone()

        # Usage by day (last 7 days)
        daily_usage = db.execute("""
            SELECT date(created_at, 'unixepoch') as day,
                   COUNT(*) as turns,
                   SUM(cost_usd) as cost_usd,
                   SUM(output_tokens) as output_tokens
            FROM token_usage
            WHERE created_at > unixepoch() - 604800
            GROUP BY day
            ORDER BY day
        """).fetchall()

        return {
            "bot_online": bot_online,
            "session": dict(session) if session else None,
            "usage_24h": dict(usage_24h) if usage_24h else None,
            "usage_total": dict(usage_total) if usage_total else None,
            "recent_conversations": [dict(r) for r in recent_convos],
            "scheduled_tasks": [dict(r) for r in scheduled],
            "memory_count": dict(memory_count)["c"] if memory_count else 0,
            "daily_usage": [dict(r) for r in daily_usage],
        }
```

**Step 2: Register in main.py, commit**

```bash
git commit -m "feat(dashboard): add ClaudeClaw status API reading existing tables"
```

---

## Phase 2: Frontend (React + Vite + Tailwind)

### Task 6: Scaffold React app

**Step 1: Create Vite project**

```bash
cd C:\Users\salomon.DC0\documents\python\claudeclaw
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities recharts lucide-react react-router-dom
```

**Step 2: Configure Tailwind via Vite plugin**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:8420' }
  }
})
```

`src/index.css`:
```css
@import "tailwindcss";
```

**Step 3: Verify dev server**

```bash
npm run dev
# Opens http://localhost:5173
```

**Step 4: Commit**

```bash
git add dashboard/
git commit -m "feat(dashboard): scaffold React + Vite + Tailwind frontend"
```

---

### Task 7: API client + Router setup

**Files:**
- Create: `dashboard/src/api.ts`
- Create: `dashboard/src/router.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Create API client**

```ts
// dashboard/src/api.ts
const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Projects
  listProjects: () => request<Project[]>('/projects'),
  createProject: (data: ProjectCreate) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: Partial<Project>) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  // Tasks
  listTasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Task[]>(`/tasks${qs}`);
  },
  createTask: (data: TaskCreate) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, data: Partial<Task>) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  // Ideas
  listIdeas: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Idea[]>(`/ideas${qs}`);
  },
  createIdea: (data: IdeaCreate) => request<Idea>('/ideas', { method: 'POST', body: JSON.stringify(data) }),
  updateIdea: (id: string, data: Partial<Idea>) => request<Idea>(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteIdea: (id: string) => request<void>(`/ideas/${id}`, { method: 'DELETE' }),

  // Status
  getStatus: () => request<ClawStatus>('/status'),
};
```

**Step 2: Create router with 4 pages**

```ts
// dashboard/src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Kanban from './pages/Kanban';
import ProjectDetail from './pages/ProjectDetail';
import Status from './pages/Status';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'kanban', element: <Kanban /> },
      { path: 'projects/:id', element: <ProjectDetail /> },
      { path: 'status', element: <Status /> },
    ],
  },
]);
```

**Step 3: Commit**

```bash
git commit -m "feat(dashboard): add API client, router, and type definitions"
```

---

### Task 8: Layout + Navigation shell

**Files:**
- Create: `dashboard/src/components/Layout.tsx`

Sidebar navigation with 4 links:
- Overview (home icon)
- Kanban (columns icon)
- Status (activity icon)

Top bar with "ClaudeClaw Control Center" title and bot online/offline indicator.

Dark theme by default (slate-900 background, slate-800 cards).

**Commit:** `feat(dashboard): add layout shell with sidebar navigation`

---

### Task 9: Overview page

**Files:**
- Create: `dashboard/src/pages/Overview.tsx`
- Create: `dashboard/src/components/ProjectCard.tsx`
- Create: `dashboard/src/components/QuickAdd.tsx`

Three sections stacked vertically:

1. **Projects grid** — cards showing name, description, color bar, task progress (X/Y done), idea count. Click to go to project detail.
2. **Recent Ideas** — list of latest ideas with status badges. Quick-add input at top.
3. **Pending Tasks** — list of tasks with status=todo or in_progress, sorted by priority. Quick-add input at top.

Each section has a "+" button for quick creation via inline form.

**Commit:** `feat(dashboard): add Overview page with projects, ideas, tasks sections`

---

### Task 10: Kanban board page

**Files:**
- Create: `dashboard/src/pages/Kanban.tsx`
- Create: `dashboard/src/components/KanbanColumn.tsx`
- Create: `dashboard/src/components/KanbanCard.tsx`

Three columns: **Todo** | **In Progress** | **Done**

- Uses `@dnd-kit` for drag-and-drop between columns
- Dragging a card to a different column updates its `status` via API
- Cards show: title, project color dot, priority badge
- Filter bar at top: filter by project, priority
- Quick-add button at bottom of each column

**Commit:** `feat(dashboard): add Kanban board with drag-and-drop`

---

### Task 11: Project Detail (Hub) page

**Files:**
- Create: `dashboard/src/pages/ProjectDetail.tsx`

Shows a single project as a hub:
- Header: project name, description, color, status, edit button
- **Ideas tab**: all ideas for this project with status management
- **Tasks tab**: all tasks for this project in a mini-kanban or list view
- Progress bar showing completion %

**Commit:** `feat(dashboard): add Project Detail hub page`

---

### Task 12: Status page

**Files:**
- Create: `dashboard/src/pages/Status.tsx`

Sections:
1. **Bot Status** — online/offline indicator, session info, uptime
2. **Token Usage** — today's turns, tokens, cost. Recharts line chart for last 7 days.
3. **Scheduled Tasks** — table of all scheduled tasks with next run time
4. **Recent Conversations** — last 10 messages in/out
5. **Memories** — count and link to browse

**Commit:** `feat(dashboard): add Status page with charts and ClaudeClaw metrics`

---

## Phase 3: Integration

### Task 13: Serve frontend from FastAPI in production

**Files:**
- Modify: `dashboard-api/app/main.py`

```python
# After all API routes, serve the built React app
static_dir = Path(__file__).parent.parent.parent / "dashboard" / "dist"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="spa")
```

Build script:
```bash
cd dashboard && npm run build
cd ../dashboard-api && uvicorn app.main:app --port 8420
# Now http://localhost:8420 serves the full app
```

**Commit:** `feat(dashboard): serve built frontend from FastAPI`

---

### Task 14: Telegram Web App integration

**Files:**
- Modify: `dashboard/src/App.tsx` (detect Telegram WebApp context)
- Add bot command to open the web app

```python
# In the bot or via BotFather:
# Set menu button URL to http://localhost:8420 (or your tunnel URL)
```

For Telegram Web App:
- Detect `window.Telegram.WebApp` and apply compact styles
- Use Telegram theme colors when running inside Telegram
- Add `/dashboard` command to bot that sends inline button opening the web app

**Commit:** `feat(dashboard): add Telegram Web App support`

---

### Task 15: Start script and docs

**Files:**
- Create: `dashboard-api/start.sh`
- Modify: `README.md` (add dashboard section)

```bash
#!/bin/bash
# start.sh - Start the Control Center
cd "$(dirname "$0")"
cd ../dashboard && npm run build
cd ../dashboard-api
uvicorn app.main:app --host 0.0.0.0 --port 8420
```

**Commit:** `feat(dashboard): add start script and documentation`

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Backend | Tasks 1-5 | FastAPI with full CRUD + status API |
| 2: Frontend | Tasks 6-12 | React app with Overview, Kanban, Project Hub, Status |
| 3: Integration | Tasks 13-15 | Production build, Telegram Web App, start script |

**Total: 15 tasks, ~3-4 hours estimated.**
