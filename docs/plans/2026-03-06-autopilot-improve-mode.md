# Autopilot Improve Mode

## Problem

The autopilot has a linear flow: create > enrich > execute > done. Once a project is completed, there's no way to iterate on it. Users need to modify behavior, add features, or change direction as they understand their needs better.

Additionally, projects built before the dashboard existed have no way to enter the system.

## Design

### New Autopilot State: `improving`

The `autopilot_state` table gains two columns:
- `mode` TEXT DEFAULT 'build' -- 'build' | 'improve'
- `improve_request` TEXT DEFAULT '' -- free text describing desired changes

### Flow

1. User clicks "Improve" on a project card (dashboard) and describes what they want to change
2. `POST /api/projects/{id}/improve` reopens the project and sets mode to 'improve'
3. **Analysis**: CLI reads existing codebase + features + improve_request, classifies as:
   - **TWEAK**: simple/clear change. Skips clarification, generates 1-2 features directly. No git branch.
   - **RESTRUCTURE**: ambiguous/large change. Asks 2-3 clarification questions via Telegram. Creates branch `improve/{project}-{short-desc}`.
4. **Feature generation**: can create new features OR mark existing ones for rework
   - Rework features: original marked `phase: 'rework'`, new feature created with `[Rework]` prefix
   - New features: created normally with wave assignment
5. **Plan confirmation**: same as build mode, user confirms before execution
6. **Execution**: each improve feature prompt includes "modify only what's necessary, don't rewrite working code"
7. Project returns to `done` when all improve features complete

### Import Existing Projects

For projects built outside the dashboard:

- `POST /api/projects/import` with `{ name, folder? }`
- Button "Import Project" in dashboard
- Validates folder exists at `PROJECTS_ROOT/{folder}`
- Creates project as `completed: true, phase: 'done'`
- CLI scans codebase and generates retroactive features (all `phase: 'done'`)
- Project appears in dashboard ready for "Improve"

### API Changes

**New endpoints:**
- `POST /api/projects/{id}/improve` -- body: `{ description: string }`
  - Validates project exists
  - Sets `completed: false`, `phase: 'in_progress'`, `autopilot: true`
  - Upserts autopilot_state with `mode: 'improve'`, `improve_request: description`, `status: 'new'`
- `POST /api/projects/import` -- body: `{ name: string, folder?: string }`
  - Creates project + triggers codebase scan for retroactive features

**Modified in autopilot.ts:**
- `scanAndEnqueue()`: checks `state.mode === 'improve'` and routes to `startImprove()` instead of `startClarification()`
- New `startImprove()`: analysis + classification (tweak vs restructure)
- Modified `enrichProject()`: when mode is 'improve', includes existing features and rework instructions in prompt
- Feature execution prompt: when mode is 'improve', adds "this is existing code, modify only what's needed"

### DB Migration

```sql
ALTER TABLE autopilot_state ADD COLUMN mode TEXT NOT NULL DEFAULT 'build';
ALTER TABLE autopilot_state ADD COLUMN improve_request TEXT NOT NULL DEFAULT '';
```

### Dashboard UI

- "Improve" button on project cards (visible when project is done or in_progress)
- Modal: textarea + read-only feature list + submit button
- "Improving" badge (blue) during improve execution
- Rework features show refresh icon
- "Import Project" button next to "New Project"
- Import modal: name field + optional folder field

### Feature Phase Values

Existing: `backlog`, `in_progress`, `done`
New: `rework` (marks a done feature that will be re-executed with updated instructions)
