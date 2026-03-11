# Autopilot Improve Mode - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "improve" mode to the autopilot that lets users iterate on completed projects, plus an "import" flow for projects built outside the dashboard.

**Architecture:** Two new API endpoints (`POST /projects/{id}/improve` and `POST /projects/import`) feed into the existing autopilot heartbeat loop. The TS autopilot gains a `startImprove()` function that classifies changes as tweak vs restructure and routes accordingly. Dashboard gets two modals (Improve + Import) reusing existing patterns.

**Tech Stack:** FastAPI (Python), TypeScript (autopilot + bot), React/Tailwind (dashboard), SQLite

---

### Task 1: DB Migration - Add `mode` and `improve_request` to autopilot_state

**Files:**
- Modify: `src/db.ts:9-157` (add columns to createSchema)
- Modify: `api/database.py:251-311` (add migration entries)

**Step 1: Add columns to TS bot schema**

In `src/db.ts`, inside `createSchema()`, the `autopilot_state` CREATE TABLE already exists. Add migrations after line 173 (inside the `migrations` array):

```typescript
// In the migrations array at line 168:
'ALTER TABLE autopilot_state ADD COLUMN mode TEXT NOT NULL DEFAULT "build"',
'ALTER TABLE autopilot_state ADD COLUMN improve_request TEXT NOT NULL DEFAULT ""',
```

**Step 2: Add migration to Python API**

In `api/database.py`, add to the `_MIGRATIONS` list:

```python
(
    "autopilot_state_mode",
    'ALTER TABLE autopilot_state ADD COLUMN mode TEXT NOT NULL DEFAULT "build";',
),
(
    "autopilot_state_improve_request",
    'ALTER TABLE autopilot_state ADD COLUMN improve_request TEXT NOT NULL DEFAULT "";',
),
```

**Step 3: Update TS db functions for improve mode**

In `src/db.ts`, add these functions after `markProjectReady()` (line 792):

```typescript
export function setImproveMode(projectId: string, improveRequest: string): void {
  db.prepare(
    `INSERT INTO autopilot_state (project_id, status, mode, improve_request)
     VALUES (?, 'new', 'improve', ?)
     ON CONFLICT(project_id) DO UPDATE SET status = 'new', mode = 'improve', improve_request = ?, qa_context = '', enriched_plan = ''`,
  ).run(projectId, improveRequest, improveRequest);
}

export function getImproveRequest(projectId: string): string {
  const state = getAutopilotState(projectId);
  return (state as any)?.improve_request ?? '';
}

export function getAutopilotMode(projectId: string): string {
  const state = getAutopilotState(projectId);
  return (state as any)?.mode ?? 'build';
}
```

**Step 4: Update AutopilotState interface**

In `src/db.ts`, update the `AutopilotState` interface (line 745):

```typescript
export interface AutopilotState {
  project_id: string;
  status: string;
  current_wave: number;
  qa_context: string;
  enriched_plan: string;
  mode: string;         // 'build' | 'improve'
  improve_request: string;
}
```

**Step 5: Commit**

```bash
git add src/db.ts api/database.py
git commit -m "feat: add mode and improve_request columns to autopilot_state"
```

---

### Task 2: API Endpoint - POST /projects/{id}/improve

**Files:**
- Modify: `api/routers/projects.py` (add endpoint)
- Modify: `api/models.py` (add request model)

**Step 1: Add Pydantic model**

In `api/models.py`, after the `ProjectUpdate` class (line 25):

```python
class ProjectImproveRequest(BaseModel):
    description: str
```

**Step 2: Add the improve endpoint**

In `api/routers/projects.py`, after the `decompose_project` endpoint (after line 292), add:

```python
from models import ProjectImproveRequest

@router.post("/projects/{project_id}/improve")
def improve_project(
    project_id: str,
    body: ProjectImproveRequest,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Start an improve cycle on an existing project."""
    row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")

    now = int(time.time())

    # Reopen the project for improvement
    db.execute(
        "UPDATE projects SET completed = 0, phase = 'in_progress', autopilot = 1, updated_at = ? WHERE id = ?",
        (now, project_id),
    )

    # Set autopilot state to improve mode
    # The TS bot's autopilot_state table lives in store/claudeclaw.db
    # We write to it via the shared DB path
    store_db_path = Path(__file__).parent.parent.parent / "store" / "claudeclaw.db"
    if store_db_path.exists():
        store_conn = sqlite3.connect(str(store_db_path), timeout=10)
        store_conn.execute("PRAGMA journal_mode=WAL;")
        try:
            store_conn.execute(
                """INSERT INTO autopilot_state (project_id, status, mode, improve_request)
                   VALUES (?, 'new', 'improve', ?)
                   ON CONFLICT(project_id) DO UPDATE SET
                     status = 'new', mode = 'improve', improve_request = ?,
                     qa_context = '', enriched_plan = ''""",
                (project_id, body.description, body.description),
            )
            store_conn.commit()
        finally:
            store_conn.close()

    db.commit()

    project = _row_to_dict(db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    return {"ok": True, "project": project}
```

Note: Import `ProjectImproveRequest` at the top of the file alongside the other model imports.

**Step 3: Commit**

```bash
git add api/routers/projects.py api/models.py
git commit -m "feat: add POST /projects/{id}/improve endpoint"
```

---

### Task 3: API Endpoint - POST /projects/import

**Files:**
- Modify: `api/routers/projects.py` (add endpoint)
- Modify: `api/models.py` (add request model)

**Step 1: Add Pydantic model**

In `api/models.py`, after `ProjectImproveRequest`:

```python
class ProjectImportRequest(BaseModel):
    name: str
    folder: str = ""
```

**Step 2: Add background scan function**

In `api/routers/projects.py`, after `_run_autopilot_decomposition`, add:

```python
def _run_import_scan(project_id: str, project_name: str, folder_path: str) -> None:
    """Background task: scan existing codebase and generate retroactive features."""
    try:
        import subprocess

        prompt = (
            f"You are analyzing an existing, completed project.\n"
            f"Project: {project_name}\n"
            f"Directory: {folder_path}\n\n"
            f"Read the codebase and generate a list of features that describe what is already implemented. "
            f"Each feature should represent a distinct, cohesive piece of functionality.\n\n"
            f"Assign wave numbers based on what logically would have been built first (wave 1 = foundation, wave 2 = core, etc).\n\n"
            f"Respond ONLY with valid JSON, no markdown:\n"
            f'{{"features": [{{"description":"...","objective":"...","wave":1}}]}}'
        )

        claude_cmd = r"C:\Users\salomon.DC0\AppData\Roaming\npm\claude.cmd"
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        result = subprocess.run(
            [claude_cmd, "-p", "--output-format", "text"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
            shell=True,
            cwd=folder_path,
        )

        if result.returncode != 0:
            logger.error("Import scan failed: %s", result.stderr)
            return

        raw = result.stdout.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3].strip()

        parsed = json.loads(raw)
        features = parsed.get("features", [])

        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.row_factory = sqlite3.Row

        now = int(time.time())
        for pos, f in enumerate(features, start=1):
            feature_id = str(uuid4())
            conn.execute(
                """INSERT INTO features (id, project_id, description, objective, acceptance_criteria, phase, priority, completed, position, wave, created_at, updated_at)
                   VALUES (?, ?, ?, ?, '', 'done', 'none', 1, ?, ?, ?, ?)""",
                (feature_id, project_id, f["description"], f.get("objective", ""), pos, f.get("wave", 1), now, now),
            )

        conn.commit()
        conn.close()
        logger.info("Import scan created %d features for project %s", len(features), project_name)

    except Exception as e:
        logger.error("Import scan failed: %s", e)
```

**Step 3: Add the import endpoint**

In `api/routers/projects.py`, add after the improve endpoint:

```python
from models import ProjectImportRequest

@router.post("/projects/import", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def import_project(
    body: ProjectImportRequest,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Import an existing project from disk into the dashboard."""
    folder_name = body.folder or f"Proyecto {body.name}"
    folder_path = PROJECTS_ROOT / folder_name

    if not folder_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Folder not found: {folder_path}",
        )

    now = int(time.time())
    project_id = str(uuid4())

    db.execute(
        """INSERT INTO projects (id, name, description, phase, completed, autopilot, paused, priority, tags, color, created_at, updated_at)
           VALUES (?, ?, ?, 'done', 1, 0, 0, 'none', '', '#f59e0b', ?, ?)""",
        (project_id, body.name, f"Imported from {folder_name}", now, now),
    )
    db.commit()

    bg.add_task(_run_import_scan, project_id, body.name, str(folder_path))

    row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    return _row_to_dict(row)
```

Note: Import `ProjectImportRequest` alongside `ProjectImproveRequest` at the top.

**Step 4: Commit**

```bash
git add api/routers/projects.py api/models.py
git commit -m "feat: add POST /projects/import endpoint with codebase scan"
```

---

### Task 4: Autopilot - startImprove() function

**Files:**
- Modify: `src/autopilot.ts` (add startImprove, modify scanAndEnqueue)

**Step 1: Add startImprove function**

In `src/autopilot.ts`, after the `startClarification` function (after line 232), add:

```typescript
// ── Improve phase ────────────────────────────────────────────

async function startImprove(project: ApiProject): Promise<void> {
  const improveRequest = getImproveRequest(project.id);
  const existingFeatures = await apiGet<ApiFeature[]>(`/features?project_id=${project.id}`);
  const folder = getProjectFolder(project.name);

  const featureList = existingFeatures
    .map((f) => `- [${f.phase}] ${f.description}`)
    .join('\n');

  logger.info({ projectId: project.id, name: project.name }, 'Starting improve analysis');
  upsertAutopilotState(project.id, 'clarifying');

  const prompt = `You are a software architect analyzing an improvement request for an existing project.

Project: ${project.name}
Description: ${project.description || ''}
Working directory: ${folder}

Existing features:
${featureList}

Improvement requested: ${improveRequest}

Analyze whether this is a TWEAK (simple, clear, 1-2 changes) or RESTRUCTURE (complex, ambiguous, needs clarification).

If TWEAK: generate the features directly. They can be new features or rework of existing ones.
For rework, include the original feature description in "rework_of" field.

If RESTRUCTURE: generate 2-3 short clarification questions.

Respond ONLY with JSON, no markdown:
For TWEAK: {"type":"tweak","features":[{"description":"...","objective":"...","acceptance_criteria":"...","wave":1,"rework_of":"original feature description or null"}]}
For RESTRUCTURE: {"type":"restructure","questions":["Q1?","Q2?"]}`;

  const { output, exitCode } = await runClaudeCli(prompt, folder);

  if (exitCode !== 0) {
    logger.error({ projectId: project.id, output: output.slice(0, 300) }, 'Improve analysis failed');
    setAutopilotStatus(project.id, 'new');
    return;
  }

  try {
    const raw = stripMarkdownFences(output);
    const parsed = JSON.parse(raw);

    if (parsed.type === 'tweak') {
      // Skip clarification, go straight to creating features
      await createImproveFeatures(project, parsed.features, existingFeatures);
    } else {
      // Restructure: send clarification questions
      const questions: string[] = parsed.questions;
      for (const q of questions) {
        appendClarificationQA(project.id, q, '');
      }
      await _onClarificationNeeded(project.id, project.name, questions);
      logger.info({ projectId: project.id }, 'Improve restructure: clarification questions sent');
    }
  } catch (err) {
    logger.error({ err, projectId: project.id }, 'Failed to parse improve analysis');
    setAutopilotStatus(project.id, 'new');
  }
}

async function createImproveFeatures(
  project: ApiProject,
  features: Array<{ description: string; objective: string; acceptance_criteria: string; wave: number; rework_of?: string | null }>,
  existingFeatures: ApiFeature[],
): Promise<void> {
  // Mark reworked features
  for (const f of features) {
    if (f.rework_of) {
      const original = existingFeatures.find((ef) => ef.description === f.rework_of);
      if (original) {
        await apiPatch(`/features/${original.id}`, { phase: 'rework' });
      }
    }
    // Create the new/rework feature
    const desc = f.rework_of ? `[Rework] ${f.description}` : f.description;
    await apiPost('/features', {
      project_id: project.id,
      description: desc,
      objective: f.objective || '',
      acceptance_criteria: f.acceptance_criteria || '',
      wave: f.wave,
      priority: 'high',
      phase: 'backlog',
    });
  }

  // Build plan summary
  const waveMap = new Map<number, string[]>();
  for (const f of features) {
    if (!waveMap.has(f.wave)) waveMap.set(f.wave, []);
    const desc = f.rework_of ? `[Rework] ${f.description}` : f.description;
    waveMap.get(f.wave)!.push(desc);
  }

  const planLines: string[] = [`Improve plan for ${project.name}:\n`];
  for (const [wave, descs] of [...waveMap.entries()].sort((a, b) => a[0] - b[0])) {
    planLines.push(`Wave ${wave}:`);
    for (const d of descs) {
      planLines.push(`  - ${d}`);
    }
  }
  planLines.push(`\nTotal: ${features.length} improvement features`);
  planLines.push('\nResponde "ok" o "go" para confirmar y empezar la ejecucion.');

  const planText = planLines.join('\n');
  setEnrichedPlan(project.id, planText);

  await _onEnrichmentReady(project.id, project.name, planText);
  logger.info({ projectId: project.id, featureCount: features.length }, 'Improve plan ready for confirmation');
}
```

**Step 2: Add imports for new db functions**

In `src/autopilot.ts`, update the import from `./db.js` (line 10-28) to include:

```typescript
import {
  // ... existing imports ...
  setImproveMode,
  getImproveRequest,
  getAutopilotMode,
} from './db.js';
```

**Step 3: Modify scanAndEnqueue to route improve mode**

In `src/autopilot.ts`, in the `scanAndEnqueue` function (line 478), replace the block at lines 486-489:

```typescript
if (!state || state.status === 'new') {
  if (state?.mode === 'improve') {
    await startImprove(project);
  } else {
    await startClarification(project);
  }
  continue;
}
```

**Step 4: Modify enrichProject to handle improve mode**

In `src/autopilot.ts`, in the `enrichProject` function, after line 243 (`const qaSection = ...`), add a check and modify the prompt:

```typescript
const isImprove = getAutopilotMode(projectId) === 'improve';
const improveRequest = isImprove ? getImproveRequest(projectId) : '';
```

Then update the prompt (around line 252) to include improve context when applicable. After the `${existingSection}` in the prompt, add:

```typescript
const improveSection = isImprove
  ? `\nThis is an IMPROVEMENT to an existing project, not a new build.\nImprovement requested: ${improveRequest}\nOnly generate features for the changes needed. You may reference existing features to rework.\nFor rework features, include "rework_of" field with the original feature description.`
  : '';
```

And include `${improveSection}` in the prompt string after `${existingSection}`.

**Step 5: Modify feature execution prompt for improve mode**

In `src/autopilot.ts`, in the `executeFeature` function (line 355), after building the prompt (around line 375), add a check:

```typescript
const mode = getAutopilotMode(item.project_id);
const improveNote = mode === 'improve'
  ? '\n\nIMPORTANT: This is an improvement to an existing, working project. Modify ONLY what is necessary. Do NOT rewrite code that already works. Read the existing code first and make targeted changes.'
  : '';
```

And append `${improveNote}` to the end of the prompt string.

**Step 6: Handle branch creation for restructure**

In `startImprove`, when type is 'restructure', after sending clarification questions, create a branch. Add before the logger.info:

```typescript
// Create branch for restructure changes
try {
  const { execSync } = await import('child_process');
  const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const branchName = `improve/${safeName}`;
  execSync(`git checkout -b ${branchName}`, { cwd: folder, stdio: 'ignore' });
  logger.info({ projectId: project.id, branch: branchName }, 'Created improve branch');
} catch {
  logger.warn({ projectId: project.id }, 'Could not create improve branch (may already exist or not a git repo)');
}
```

**Step 7: Commit**

```bash
git add src/autopilot.ts
git commit -m "feat: add startImprove and improve-aware execution in autopilot"
```

---

### Task 5: Dashboard - Improve Modal Component

**Files:**
- Create: `dashboard/src/components/ImproveProjectModal.tsx`

**Step 1: Create the modal**

```tsx
import { useState, useEffect, useRef } from 'react';
import { projects as projectsApi, features as featuresApi } from '../lib/api';
import type { Feature } from '../lib/types';

interface ImproveProjectModalProps {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function ImproveProjectModal({
  open,
  projectId,
  projectName,
  onClose,
  onSubmitted,
}: ImproveProjectModalProps) {
  const [description, setDescription] = useState('');
  const [featuresList, setFeaturesList] = useState<Feature[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDescription('');
      setSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
      featuresApi.list(projectId).then(setFeaturesList).catch(console.error);
    }
  }, [open, projectId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit() {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/projects/${projectId}/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      onSubmitted();
      onClose();
    } catch (err) {
      console.error('Failed to start improve:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="theme-card bg-surface-raised p-6 w-full max-w-lg animate-fade-in max-h-[90vh] overflow-y-auto">
        <h2 className="font-display text-xl text-accent mb-1">Improve Project</h2>
        <p className="text-text-muted text-sm mb-5">{projectName}</p>

        {/* Existing features reference */}
        {featuresList.length > 0 && (
          <div className="mb-4">
            <p className="text-text-secondary text-xs font-display mb-2">Existing features:</p>
            <div className="bg-surface border border-border rounded-md p-3 max-h-40 overflow-y-auto">
              {featuresList.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-xs text-text-muted py-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    f.phase === 'done' ? 'bg-status-active' : 'bg-text-muted'
                  }`} />
                  <span className="truncate">{f.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <div className="mb-5">
          <label className="block text-text-secondary text-sm mb-1.5">What do you want to change?</label>
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the improvements you want..."
            rows={4}
            className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors resize-none"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!description.trim() || submitting}
            className="bg-blue-500 text-white font-display font-semibold rounded-md px-4 py-2 text-sm hover:bg-blue-500/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Starting...' : 'Start Improve'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add dashboard/src/components/ImproveProjectModal.tsx
git commit -m "feat: add ImproveProjectModal component"
```

---

### Task 6: Dashboard - Import Project Modal

**Files:**
- Create: `dashboard/src/components/ImportProjectModal.tsx`

**Step 1: Create the modal**

```tsx
import { useState, useEffect, useRef } from 'react';
import type { Project } from '../lib/types';

interface ImportProjectModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (project: Project) => void;
}

export default function ImportProjectModal({ open, onClose, onImported }: ImportProjectModalProps) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setFolder('');
      setError('');
      setSubmitting(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleImport() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), folder: folder.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || 'Import failed');
        return;
      }
      const project = await res.json();
      onImported(project);
      onClose();
    } catch (err) {
      setError('Failed to import project');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="theme-card bg-surface-raised p-6 w-full max-w-md animate-fade-in">
        <h2 className="font-display text-xl text-accent mb-5">Import Project</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-text-secondary text-sm mb-1.5">Project Name</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
              placeholder="Newsletter"
              className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-sm mb-1.5">
              Folder name <span className="text-text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder={name ? `Proyecto ${name}` : 'Proyecto X'}
              className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-bright transition-colors"
            />
            <p className="text-text-muted text-xs mt-1">
              Defaults to "Proyecto {'{'} name {'}'}" if empty. Must exist in C:\Users\salomon.DC0\Documents\Python\
            </p>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!name.trim() || submitting}
            className="bg-accent text-surface font-display font-semibold rounded-md px-4 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add dashboard/src/components/ImportProjectModal.tsx
git commit -m "feat: add ImportProjectModal component"
```

---

### Task 7: Dashboard - Wire up modals in ProjectsPage and ProjectCard

**Files:**
- Modify: `dashboard/src/pages/ProjectsPage.tsx`
- Modify: `dashboard/src/components/ProjectCard.tsx`
- Modify: `dashboard/src/lib/types.ts`

**Step 1: Add 'rework' and 'improving' to Phase type**

In `dashboard/src/lib/types.ts`, update the Phase type (line 1):

```typescript
export type Phase = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'rework';
```

**Step 2: Add Import button and modal to ProjectsPage**

In `dashboard/src/pages/ProjectsPage.tsx`:

Add import at top:
```typescript
import ImportProjectModal from '../components/ImportProjectModal';
```

Add state:
```typescript
const [importModalOpen, setImportModalOpen] = useState(false);
```

Add Import button next to "New Project" button (around line 71):
```tsx
<div className="flex gap-2">
  <button
    onClick={() => setImportModalOpen(true)}
    className="border border-border text-text-secondary rounded-md px-4 py-2 font-display font-semibold text-sm hover:text-text-primary hover:border-border-bright transition-colors"
  >
    Import
  </button>
  <button
    onClick={() => setModalOpen(true)}
    className="bg-accent text-surface rounded-md px-4 py-2 font-display font-semibold text-sm hover:bg-accent/90 transition-colors"
  >
    New Project
  </button>
</div>
```

Add the ImportProjectModal at the bottom, after CreateProjectModal:
```tsx
<ImportProjectModal
  open={importModalOpen}
  onClose={() => setImportModalOpen(false)}
  onImported={(project) => {
    setProjects((prev) => [{ ...project, featureCount: 0, taskCount: 0 }, ...prev]);
    setImportModalOpen(false);
  }}
/>
```

**Step 3: Add Improve button to ProjectCard**

In `dashboard/src/components/ProjectCard.tsx`:

Update the interface to include an onImprove callback:
```typescript
interface ProjectCardProps {
  project: Project & { featureCount: number; taskCount: number };
  delay?: number;
  onImprove?: (project: Project) => void;
}
```

Add the phase style for rework:
```typescript
const phaseStyles: Record<Phase, string> = {
  // ... existing ...
  rework: 'bg-blue-500/20 text-blue-400',
};

const phaseLabels: Record<Phase, string> = {
  // ... existing ...
  rework: 'Rework',
};
```

Add an "Improve" button inside the card, after the description paragraph. Use `e.preventDefault()` and `e.stopPropagation()` since the card is wrapped in a Link:

```tsx
{(project.phase === 'done' || project.phase === 'in_progress') && onImprove && (
  <button
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onImprove(project);
    }}
    className="mb-3 border border-blue-500/30 text-blue-400 rounded-md px-3 py-1 text-xs font-display hover:bg-blue-500/10 transition-colors"
  >
    Improve
  </button>
)}
```

**Step 4: Wire up in ProjectsPage**

In `dashboard/src/pages/ProjectsPage.tsx`:

Add imports and state:
```typescript
import ImproveProjectModal from '../components/ImproveProjectModal';

// Inside the component:
const [improveTarget, setImproveTarget] = useState<ProjectWithCounts | null>(null);
```

Update ProjectCard usage to pass onImprove:
```tsx
<ProjectCard
  key={project.id}
  project={project}
  delay={i * 60}
  onImprove={(p) => setImproveTarget(p as ProjectWithCounts)}
/>
```

Add ImproveProjectModal at the bottom:
```tsx
{improveTarget && (
  <ImproveProjectModal
    open={!!improveTarget}
    projectId={improveTarget.id}
    projectName={improveTarget.name}
    onClose={() => setImproveTarget(null)}
    onSubmitted={() => {
      setImproveTarget(null);
      load();
    }}
  />
)}
```

**Step 5: Commit**

```bash
git add dashboard/src/lib/types.ts dashboard/src/pages/ProjectsPage.tsx dashboard/src/components/ProjectCard.tsx
git commit -m "feat: wire up Improve and Import modals in dashboard"
```

---

### Task 8: Add API client method for improve and import

**Files:**
- Modify: `dashboard/src/lib/api.ts`

**Step 1: Add methods**

In `dashboard/src/lib/api.ts`, add to the `projects` object:

```typescript
export const projects = {
  // ... existing methods ...
  improve: (id: string, description: string) =>
    request<{ ok: boolean; project: Project }>(`/projects/${id}/improve`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),
  import: (name: string, folder?: string) =>
    request<Project>('/projects/import', {
      method: 'POST',
      body: JSON.stringify({ name, folder }),
    }),
};
```

**Step 2: Update ImproveProjectModal to use the API client instead of raw fetch**

In `dashboard/src/components/ImproveProjectModal.tsx`, replace the raw fetch in handleSubmit with:
```typescript
import { projects as projectsApi } from '../lib/api';
// ...
await projectsApi.improve(projectId, description.trim());
```

**Step 3: Update ImportProjectModal to use the API client instead of raw fetch**

In `dashboard/src/components/ImportProjectModal.tsx`, replace the raw fetch in handleImport with:
```typescript
import { projects as projectsApi } from '../lib/api';
// ...
const project = await projectsApi.import(name.trim(), folder.trim() || undefined);
onImported(project);
```

**Step 4: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/components/ImproveProjectModal.tsx dashboard/src/components/ImportProjectModal.tsx
git commit -m "feat: add improve/import to API client, update modals to use it"
```

---

### Task 9: Build and verify

**Step 1: Build the TypeScript bot**

```bash
cd c:/Users/salomon.DC0/Documents/Python/claudeclaw && npx tsc --noEmit
```

Expected: No type errors.

**Step 2: Build the dashboard**

```bash
cd c:/Users/salomon.DC0/Documents/Python/claudeclaw/dashboard && npx tsc --noEmit
```

Expected: No type errors.

**Step 3: Test the API endpoints**

```bash
# Test improve endpoint
curl -s -X POST http://127.0.0.1:8031/api/projects/f9631332-e925-4de1-85eb-c692fc1c5fc5/improve \
  -H "Content-Type: application/json" \
  -d '{"description":"test"}' | python -m json.tool

# Test import endpoint (will fail if folder doesn't exist, that's ok)
curl -s -X POST http://127.0.0.1:8031/api/projects/import \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","folder":"nonexistent"}' | python -m json.tool
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: autopilot improve mode - iterate on completed projects"
```
