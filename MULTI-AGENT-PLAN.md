# ClaudeClaw Multi-Agent System -- Implementation Plan

## Background

ClaudeClaw is a Telegram bot that spawns the real `claude` CLI on a Mac/Linux machine and pipes results back to Telegram. It currently runs as a single bot with one Telegram token, one `CLAUDE.md` personality, one SQLite database, and one process.

Over the course of a design session, we decided to extend ClaudeClaw into a **multi-agent system** where:

- The **main bot stays untouched**. Zero breaking changes. `npm start` with no flags = current behavior.
- **Specialist agents** run alongside it as separate Telegram bots, each with a focused role, its own CLAUDE.md, its own Claude Code session, and its own Telegram chat.
- All agents share the same machine, the same SQLite database, the same global skills (`~/.claude/skills/`), and the same `.env` secrets.
- A **hive mind** table lets agents log what they did so any agent (or the main bot) can see cross-agent activity.
- Each agent gets **Obsidian vault folders** assigned to it, auto-injected as lightweight context before every message.
- **Scheduled tasks are agent-scoped** -- a cron job created in one agent fires in that agent's process, not the main bot.
- The existing **web dashboard** (served via Cloudflare tunnel at `/dashboard`) gets upgraded to show all agents: their status, their hive mind activity, their cron jobs, and their conversations.
- The whole system is **template-based** so anyone cloning the repo can spin up their own agents or ignore them entirely.

### Key design decisions

1. **Separate Telegram bots, not one bot with routing.** Each agent is its own BotFather bot with its own chat. You open the right chat like you'd open the right app. No router overhead, no classification tokens, no latency.

2. **Same process code, different config.** `npm start -- --agent comms` runs the exact same `index.ts` but loads a different bot token and CLAUDE.md. No code duplication.

3. **Agents are roles, not skill buckets.** All global skills are available to every agent. The CLAUDE.md shapes what the agent *thinks about*, not what tools it can access. A "comms" agent handles email, Slack, WhatsApp, YouTube comments, Skool DMs, LinkedIn -- anything that involves responding to people.

4. **Token-conscious by default.** Specialist agents use Sonnet as their default model (cheaper, fast, good enough for routine work). Users can `/model opus` when needed. Obsidian injection is titles + open tasks only, not full note contents. Hive mind is query-on-demand.

---

## Phase 0: Codebase exploration (DO THIS FIRST)

Before writing any code, you MUST understand the existing codebase. Use sub-agents to read these files in parallel and build a mental model of the architecture.

### Step 0.1 -- Read every source file

Use sub-agents (Agent tool with subagent_type=Explore or parallel Read calls) to read all of these. Do not skip any.

**Core pipeline (read in this order to understand the flow):**
1. `src/index.ts` (~95 lines) -- Entrypoint. Creates bot, inits DB, starts dashboard, starts scheduler. Understand the startup sequence.
2. `src/config.ts` (~70 lines) -- All config loaded from `.env`. Exports constants. You'll modify this to load agent-specific tokens.
3. `src/bot.ts` (~1150 lines) -- The Telegram bot. `createBot()` registers all commands. `handleMessage()` is the core message pipeline. Understand how `runAgent()` is called, how sessions are managed, how typing/progress/voice/media all flow.
4. `src/agent.ts` (~268 lines) -- The Claude Code SDK wrapper. `runAgent()` spawns a subprocess. Understand `cwd`, `settingSources`, `env`, the event loop, `AbortController`, `onProgress`.
5. `src/db.ts` (~762 lines) -- SQLite schema, all DB functions. Understand `createSchema()`, `runMigrations()`, every table, every query. You'll add columns and a new table here.
6. `src/scheduler.ts` (~115 lines) -- Cron loop. `initScheduler()` starts a 60s interval. `getDueTasks()` fires them. Understand the dedup guard, `advanceTaskNextRun`, `runningTaskIds` pattern.
7. `src/memory.ts` -- Memory context builder. `buildMemoryContext()` is called before every message. You'll add Obsidian injection here.
8. `src/state.ts` (~82 lines) -- SSE event bus, processing state, abort controller. The dashboard's real-time features depend on this.
9. `src/dashboard.ts` (~212 lines) -- Hono web server. All API endpoints. Understand how auth works (token query param), how endpoints query the DB.
10. `src/dashboard-html.ts` (~820 lines) -- Single function that returns a massive HTML string with inline CSS/JS. Uses Tailwind CDN + Chart.js. Understand the panel structure, the polling JS, the SSE chat overlay. This is the hardest file to modify.

**Supporting files (read for context):**
- `src/voice.ts` -- TTS cascade (ElevenLabs -> Gradium -> macOS say). You won't modify this.
- `src/media.ts` -- Photo/document/video download helpers. You won't modify this.
- `src/slack.ts`, `src/whatsapp.ts` -- Integration modules. You won't modify these.
- `src/env.ts` -- Reads `.env` file without polluting `process.env`. Understand this pattern -- agent config will use it.
- `src/schedule-cli.ts` (~115 lines) -- CLI for managing scheduled tasks. You'll add `--agent` flag.

**Tests (read to understand patterns):**
- `src/bot.test.ts` -- How bot tests mock grammY context
- `src/db.test.ts` -- Uses `_initTestDatabase()` for in-memory SQLite
- `src/memory.test.ts` -- How memory tests work
- `src/voice.test.ts` -- Integration test patterns

**Config files:**
- `package.json` -- Dependencies, scripts, TypeScript config
- `tsconfig.json` -- Compiler options
- `.env` (DO NOT read the actual file -- it has secrets. Read `.env.example` instead)
- `CLAUDE.md` (project root) -- The main bot's personality. Do not modify this.

### Step 0.2 -- Understand the key patterns

After reading, confirm you understand:

1. **How `runAgent()` uses `cwd`:** The `cwd` option tells the Claude Code subprocess where to find `CLAUDE.md`. Currently it's always `PROJECT_ROOT`. For agents, it'll be `agents/{id}/`.

2. **How `settingSources: ['project', 'user']` works:** `'project'` loads CLAUDE.md from `cwd`. `'user'` loads `~/.claude/skills/` and user settings. Both are always enabled.

3. **How sessions are keyed:** `sessions` table uses `chat_id` as primary key. For multi-agent, this needs to also consider `agent_id` because the same user (same chat_id) will have different sessions per agent.

4. **How the scheduler fires:** `initScheduler(send)` is called once in `index.ts`. The `send` function uses `bot.api.sendMessage()` to send results to the user's Telegram chat. For agents, the same pattern works -- just with the agent's bot token.

5. **How the dashboard is served:** Only the main process runs `startDashboard()`. It serves on `DASHBOARD_PORT` (default 3141). The Cloudflare tunnel points to this port. Agent processes do NOT serve a dashboard.

6. **How `.env` is read:** `src/env.ts` reads the `.env` file and returns a key-value object. It does NOT set `process.env`. This is important -- the agent's bot token will be a different env var name (e.g., `COMMS_BOT_TOKEN`) read from the same `.env` file.

7. **How the SSE chat overlay works:** `src/state.ts` has an EventEmitter. `bot.ts` emits events (user_message, assistant_message, processing, progress). `dashboard.ts` has a `/api/chat/stream` endpoint that streams these via SSE. The dashboard HTML JS listens to the stream.

8. **How `dashboard-html.ts` is structured:** It's a single `getDashboardHtml()` function returning a template literal. The HTML has sections for: tasks, memories, health, tokens. Each section has a card with class `.card`. JavaScript at the bottom polls `/api/*` endpoints every 60 seconds and updates the DOM. The chat overlay is a floating button that opens a slide-up panel.

### Step 0.3 -- Verify you can build and test

Before any changes:
```bash
npm run build   # must succeed
npm test         # must pass all 108+ tests
```

If either fails, fix the issue before proceeding. Do not proceed with a broken baseline.

---

## New dependency

Only one new package is needed for the entire plan:

```bash
npm install js-yaml
npm install -D @types/js-yaml
```

This is used in `agent-config.ts` to parse `agent.yaml` files. No other new dependencies.

---

## Repository structure after implementation

```
claudeclaw/
├── agents/
│   ├── _template/
│   │   ├── agent.yaml.example      # Copy, rename, fill in
│   │   └── CLAUDE.md               # Minimal starter personality
│   │
│   ├── comms/
│   │   ├── agent.yaml.example      # Communications agent config
│   │   └── CLAUDE.md               # Email, Slack, WhatsApp, YouTube comments, Skool, LinkedIn DMs
│   │
│   ├── content/
│   │   ├── agent.yaml.example      # Content creation agent config
│   │   └── CLAUDE.md               # YouTube scripts, LinkedIn posts, carousels, trend research
│   │
│   ├── ops/
│   │   ├── agent.yaml.example      # Operations agent config
│   │   └── CLAUDE.md               # Calendar, scheduling, billing, Stripe, Gumroad, admin
│   │
│   └── research/
│       ├── agent.yaml.example      # Research agent config
│       └── CLAUDE.md               # Deep web research, academic, competitive intel, analysis
│
├── scripts/
│   ├── agent-create.sh             # Interactive: create new agent from template
│   ├── agent-service.sh            # Install/uninstall launchd/systemd service for an agent
│   └── ... (existing scripts)
│
├── src/
│   ├── agent-config.ts             # NEW: load agent.yaml, resolve paths
│   ├── obsidian.ts                 # NEW: scan Obsidian folders, build context
│   ├── index.ts                    # MODIFIED: parse --agent flag
│   ├── config.ts                   # MODIFIED: load agent-specific bot token
│   ├── agent.ts                    # MODIFIED: accept agentCwd parameter
│   ├── bot.ts                      # MODIFIED: pass agent_id to DB calls
│   ├── db.ts                       # MODIFIED: hive_mind table, agent_id on sessions/tasks/usage
│   ├── scheduler.ts                # MODIFIED: filter tasks by agent_id
│   ├── schedule-cli.ts             # MODIFIED: --agent flag for task creation
│   ├── dashboard.ts                # MODIFIED: new API endpoints for multi-agent
│   ├── dashboard-html.ts           # MODIFIED: agent surveillance panel, hive mind feed
│   ├── memory.ts                   # MODIFIED: call obsidian context builder
│   └── ... (all other files unchanged)
│
├── CLAUDE.md                       # Main bot personality (UNCHANGED)
├── .env                            # Shared secrets + per-agent bot tokens
├── MULTI-AGENT-PLAN.md             # This file
└── README.md                       # Updated with Agents section
```

---

## Phase 1: Infrastructure (no new agents yet, main bot still works identically)

### 1.1 -- Parse `--agent` flag in `index.ts`

**File:** `src/index.ts`
**Lines changed:** ~25

Read `process.argv` for `--agent <name>`. If present, set a global `AGENT_ID` and load agent config. If absent, everything works as before.

```typescript
// At top of main()
const agentFlagIndex = process.argv.indexOf('--agent');
const AGENT_ID = agentFlagIndex !== -1 ? process.argv[agentFlagIndex + 1] : 'main';

if (AGENT_ID !== 'main') {
  const agentConfig = loadAgentConfig(AGENT_ID);
  // Override bot token, cwd, etc. from agent config
}
```

When `AGENT_ID !== 'main'`:
- Skip `showBanner()` (or show a one-liner instead)
- Skip `startDashboard()` (only main bot serves the dashboard)
- Pass `AGENT_ID` to `initScheduler()` so it only fires agent-scoped tasks
- Pass agent's `cwd` to `runAgent()` so Claude loads the agent's CLAUDE.md
- Log the agent name on startup: `"ClaudeClaw agent [comms] online: @yourname_comms_bot"`

### 1.2 -- Create `agent-config.ts`

**File:** `src/agent-config.ts` (NEW, ~60 lines)

Loads and validates `agents/{name}/agent.yaml`. Returns a typed config object.

```typescript
export interface AgentConfig {
  name: string;              // "Comms"
  description: string;       // "Email, Slack, WhatsApp, YouTube comments..."
  botTokenEnv: string;       // "COMMS_BOT_TOKEN" -- key name in .env
  model?: string;            // "claude-sonnet-4-6" -- default model override
  obsidian?: {
    vault: string;           // absolute path to Obsidian vault
    folders: string[];       // read/write folders
    readOnly?: string[];     // reference-only folders
  };
  skillsHint?: string[];     // documentation only, not enforced
}

export function loadAgentConfig(agentId: string): AgentConfig {
  const configPath = path.join(PROJECT_ROOT, 'agents', agentId, 'agent.yaml');
  // Parse YAML, validate required fields, resolve paths
  // Read bot token from .env using the botTokenEnv key name
}
```

**Dependency:** Add `js-yaml` to dependencies (`npm install js-yaml @types/js-yaml`).

### 1.3 -- Modify `config.ts` for agent-aware token loading

**File:** `src/config.ts`
**Lines changed:** ~15

When running as an agent, read the bot token from a different env var (e.g., `COMMS_BOT_TOKEN` instead of `TELEGRAM_BOT_TOKEN`). The `ALLOWED_CHAT_ID` stays the same -- all bots talk to the same user.

Export a mutable `agentCwd` that defaults to `PROJECT_ROOT` and gets overridden when `--agent` is set. This is what `runAgent()` uses as `cwd`.

### 1.4 -- Modify `agent.ts` to accept `agentCwd`

**File:** `src/agent.ts`
**Lines changed:** ~5

```typescript
// Current
options: { cwd: PROJECT_ROOT, ... }

// New
options: { cwd: agentCwd ?? PROJECT_ROOT, ... }
```

The `agentCwd` points to `agents/{name}/` so Claude loads that agent's CLAUDE.md. If not set (main bot), defaults to project root as before.

Also pass the agent's default model (from agent.yaml) as a fallback when no `/model` override is active.

### 1.5 -- Database migrations

**File:** `src/db.ts`
**Lines changed:** ~50

#### New table: `hive_mind`

```sql
CREATE TABLE IF NOT EXISTS hive_mind (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  artifacts   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hive_mind_agent ON hive_mind(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hive_mind_time ON hive_mind(created_at DESC);
```

#### Migration: add `agent_id` to existing tables

```sql
-- In runMigrations():
ALTER TABLE sessions ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE scheduled_tasks ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE token_usage ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE conversation_log ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
```

#### New DB functions

```typescript
export function getHiveMindEntries(limit?: number, agentId?: string): HiveMindEntry[];
export function logToHiveMind(agentId: string, chatId: string, action: string, summary: string, artifacts?: string): void;
export function getAgentTokenStats(agentId: string): { todayCost: number; todayTurns: number; allTimeCost: number };
```

#### Modified DB functions

All session/task/usage functions that currently take `chatId` should also accept `agentId` and filter by it:

```typescript
// Current
export function getSession(chatId: string): string | undefined;
// New
export function getSession(chatId: string, agentId?: string): string | undefined;

// Current
export function getDueTasks(): ScheduledTask[];
// New
export function getDueTasks(agentId?: string): ScheduledTask[];
```

Default `agentId` to `'main'` everywhere so existing code paths don't break.

### 1.6 -- Agent-scoped scheduler

**File:** `src/scheduler.ts`
**Lines changed:** ~10

```typescript
// Current
export function initScheduler(send: Sender): void {

// New
export function initScheduler(send: Sender, agentId = 'main'): void {
```

Inside `runDueTasks()`, change `getDueTasks()` to `getDueTasks(agentId)`.

### 1.7 -- Agent-scoped schedule CLI

**File:** `src/schedule-cli.ts`
**Lines changed:** ~15

Add `--agent <name>` flag. Defaults to `'main'`. Passes `agentId` to `createScheduledTask()`.

```bash
# Main bot (unchanged)
node dist/schedule-cli.js create "summarize AI news" "0 9 * * 1"

# Specific agent
node dist/schedule-cli.js create "check youtube comments" "0 */4 * * *" --agent comms

# List tasks for an agent
node dist/schedule-cli.js list --agent comms
```

### 1.8 -- Pass `agent_id` through bot.ts

**File:** `src/bot.ts`
**Lines changed:** ~15

Import the current `AGENT_ID` from config. Pass it to:
- `setSession(chatIdStr, sessionId, AGENT_ID)`
- `saveTokenUsage(chatIdStr, ..., AGENT_ID)`
- `logConversationTurn(chatIdStr, ..., AGENT_ID)`
- `saveConversationTurn(chatIdStr, ..., AGENT_ID)` (in memory.ts)

The main bot path is unchanged because `AGENT_ID` defaults to `'main'`.

### 1.9 -- Build and test

```bash
npm run build   # must compile clean
npm test         # all 108+ tests must pass
npm start        # main bot works identically (no --agent flag)
```

**Checkpoint: Phase 1 complete.** Main bot works exactly as before. The `--agent` flag exists but no agents are created yet. Database has new columns and hive_mind table. All existing tests pass.

---

## Phase 2: Obsidian context injection

### 2.1 -- Create `obsidian.ts`

**File:** `src/obsidian.ts` (NEW, ~80 lines)

```typescript
import fs from 'fs';
import path from 'path';

export interface ObsidianConfig {
  vault: string;
  folders: string[];
  readOnly?: string[];
}

interface ObsidianNote {
  title: string;
  folder: string;
  priority?: string;
  openTasks: string[];
  created?: string;
}

// Cache: refresh every 5 minutes, not on every message
let _cache: ObsidianNote[] = [];
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function buildObsidianContext(config: ObsidianConfig | undefined): string {
  if (!config) return '';

  const now = Date.now();
  if (now - _cacheTime > CACHE_TTL_MS) {
    _cache = scanFolders(config);
    _cacheTime = now;
  }

  if (_cache.length === 0) return '';

  // Group by folder, show titles + open tasks
  // Keep it compact: ~200-500 tokens max
  // Format:
  //   [Obsidian context -- Projects/]
  //   Open: Send Webflow Contacts Export to Asad (high)
  //   Open: Hire Short-Form Video Editor
  //   [End Obsidian context]
}

function scanFolders(config: ObsidianConfig): ObsidianNote[] {
  // For each folder in config.folders + config.readOnly:
  //   List .md files (non-recursive for speed, or 1 level deep)
  //   Read frontmatter (first 20 lines) for priority/status/date
  //   Scan for unchecked tasks: lines matching /^- \[ \]/
  //   Skip notes tagged status/done
  //   Return array of ObsidianNote
}
```

### 2.2 -- Wire into memory.ts

**File:** `src/memory.ts`
**Lines changed:** ~10

In `buildMemoryContext()`, after the existing memory search/recency logic, append the Obsidian context if the agent has an Obsidian config.

```typescript
// Existing
const memBlock = formatMemoryBlock(memories);

// New
const obsidianBlock = buildObsidianContext(currentAgentObsidianConfig);
return [memBlock, obsidianBlock].filter(Boolean).join('\n\n');
```

### 2.3 -- Test Obsidian injection

Write a unit test in `src/obsidian.test.ts` following the existing test patterns:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Pattern: create a temp directory with mock .md files
// Some with open tasks (- [ ]), some done (status/done tag), some with priority: high
// Call buildObsidianContext() and verify:
//   - Output includes titles of notes with open tasks
//   - Output excludes notes tagged status/done
//   - Output is under 500 tokens (rough char count check)
//   - Output is empty string when config is undefined
//   - Cache works: calling twice returns same result without re-scanning
```

Look at `src/memory.test.ts` for the pattern of testing context builders. Look at `src/db.test.ts` for the pattern of using temp directories.

---

## Phase 3: Agent templates

### 3.1 -- Create the `_template` agent

**File:** `agents/_template/agent.yaml.example`

```yaml
# Agent configuration
# Copy this folder, rename it, and fill in your values.
#
# Then add your bot token to .env:
#   MYAGENT_BOT_TOKEN=1234567890:AAFxxxxxxx
#
# Start with:
#   npm start -- --agent myagent

name: My Agent
description: What this agent does

# The env var name in .env that holds this agent's Telegram bot token.
# Create a bot via @BotFather in Telegram, paste the token into .env.
telegram_bot_token_env: MYAGENT_BOT_TOKEN

# Default model. Options: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
# Users can override per-chat with /model in Telegram.
model: claude-sonnet-4-6

# Obsidian integration (optional).
# Assign folders from your vault so this agent auto-loads relevant context.
# obsidian:
#   vault: /path/to/your/obsidian/vault
#   folders:
#     - FolderA/
#     - FolderB/
#   read_only:
#     - Daily Notes/
```

**File:** `agents/_template/CLAUDE.md`

```markdown
# [Agent Name]

You are a focused specialist agent running as part of a ClaudeClaw multi-agent system.

## Your role
[Describe what this agent does in 2-3 sentences]

## Your Obsidian folders
[List the vault folders this agent owns -- or remove this section if not using Obsidian]

## Hive mind
After completing any meaningful action (sent an email, created a file, scheduled something, researched a topic), log it to the hive mind so other agents can see what you did:

```bash
sqlite3 store/claudeclaw.db "INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, created_at) VALUES ('[AGENT_ID]', '[CHAT_ID]', '[ACTION]', '[1-2 SENTENCE SUMMARY]', NULL, strftime('%s','now'));"
```

To check what other agents have done:
```bash
sqlite3 store/claudeclaw.db "SELECT agent_id, action, summary, datetime(created_at, 'unixepoch') FROM hive_mind ORDER BY created_at DESC LIMIT 20;"
```

## Rules
- You have access to all global skills in ~/.claude/skills/
- Keep responses tight and actionable
- Use /model opus if a task is too complex for your default model
- Log meaningful actions to the hive mind
```

### 3.2 -- Create the `comms` agent

**File:** `agents/comms/agent.yaml.example`

```yaml
name: Comms
description: All human communication -- email, Slack, WhatsApp, YouTube comments, Skool inbox, LinkedIn DMs

telegram_bot_token_env: COMMS_BOT_TOKEN

model: claude-sonnet-4-6

obsidian:
  vault: /path/to/your/obsidian/vault
  folders:
    - Projects/
    - Inbox/
  read_only:
    - Daily Notes/
```

**File:** `agents/comms/CLAUDE.md`

```markdown
# Comms Agent

You handle all human communication on the user's behalf. This includes:
- Email (Gmail, Outlook)
- Slack messages
- WhatsApp messages
- YouTube comment responses
- Skool community DMs and posts
- LinkedIn DMs
- Calendly and meeting scheduling

Your job is to help triage, draft, send, and follow up on messages across all channels.

## Obsidian folders
You own:
- **Projects/** -- client communication, consulting, agency work
- **Inbox/** -- unprocessed items that may need a response

Before each response, you'll see open tasks from these folders. If a task is communication-related, proactively mention it.

## Hive mind
After completing any meaningful action, log it:
```bash
sqlite3 store/claudeclaw.db "INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, created_at) VALUES ('comms', '[CHAT_ID]', '[ACTION]', '[SUMMARY]', NULL, strftime('%s','now'));"
```

## Style
- Keep responses short. The user reads these on their phone.
- When triaging: show a numbered list, most urgent first.
- When drafting: write in the user's voice (check the emailwriter skill).
- Don't ask for confirmation on reads/triages. Do ask before sending.
```

### 3.3 -- Create the `content` agent

**File:** `agents/content/CLAUDE.md` -- focused on YouTube scripts, LinkedIn posts/carousels, trend research, content calendar. Obsidian folders: `YouTube/`, `Content/`, `Teaching/`.

### 3.4 -- Create the `ops` agent

**File:** `agents/ops/CLAUDE.md` -- focused on calendar, scheduling, billing, Stripe, Gumroad, admin, tasks. Obsidian folders: `Finance/`, `Inbox/`.

### 3.5 -- Create the `research` agent

**File:** `agents/research/CLAUDE.md` -- focused on deep web research, academic sources, competitive intel, trend analysis. No Obsidian folders by default (research is ephemeral).

---

## Phase 4: Telegram bot creation (turnkey setup)

### 4.1 -- Create `scripts/agent-create.sh`

Interactive script that automates the entire agent setup:

```bash
#!/bin/bash
# Usage: npm run agent:create
# Or: bash scripts/agent-create.sh

echo "=== ClaudeClaw Agent Creator ==="
echo ""

# Step 1: Pick a template or start blank
echo "Available templates:"
echo "  1. comms     -- Email, Slack, WhatsApp, YouTube comments, Skool, LinkedIn"
echo "  2. content   -- YouTube, LinkedIn, writing, trend research"
echo "  3. ops       -- Calendar, billing, Stripe, Gumroad, admin"
echo "  4. research  -- Deep research, academic, competitive intel"
echo "  5. blank     -- Start from the _template"
echo ""
read -p "Pick a template (1-5): " TEMPLATE_NUM

# Map number to name
case $TEMPLATE_NUM in
  1) TEMPLATE="comms" ;;
  2) TEMPLATE="content" ;;
  3) TEMPLATE="ops" ;;
  4) TEMPLATE="research" ;;
  5) TEMPLATE="_template" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

# Step 2: Name the agent
read -p "Agent ID (lowercase, no spaces, e.g. 'comms'): " AGENT_ID
AGENT_DIR="agents/$AGENT_ID"

if [ -d "$AGENT_DIR" ] && [ -f "$AGENT_DIR/agent.yaml" ]; then
  echo "Agent '$AGENT_ID' already exists at $AGENT_DIR"
  exit 1
fi

# Step 3: Copy template
mkdir -p "$AGENT_DIR"
if [ "$TEMPLATE" != "$AGENT_ID" ]; then
  cp "agents/$TEMPLATE/CLAUDE.md" "$AGENT_DIR/CLAUDE.md"
  cp "agents/$TEMPLATE/agent.yaml.example" "$AGENT_DIR/agent.yaml.example"
fi

# Step 4: Create Telegram bot
ENV_KEY=$(echo "${AGENT_ID}_BOT_TOKEN" | tr '[:lower:]' '[:upper:]')
echo ""
echo "Now create a Telegram bot for this agent:"
echo ""
echo "  1. Open Telegram and message @BotFather"
echo "  2. Send /newbot"
echo "  3. Name it something like 'YourName Comms' or 'ClaudeClaw Comms'"
echo "  4. Give it a username like 'yourname_comms_bot'"
echo "  5. Copy the token BotFather gives you"
echo ""
read -p "Paste the bot token here: " BOT_TOKEN

if [ -z "$BOT_TOKEN" ]; then
  echo "No token provided. You can add it to .env later as:"
  echo "  $ENV_KEY=your_token_here"
else
  # Append to .env
  echo "" >> .env
  echo "# Agent: $AGENT_ID" >> .env
  echo "$ENV_KEY=$BOT_TOKEN" >> .env
  echo "Token saved to .env as $ENV_KEY"
fi

# Step 5: Create agent.yaml from example
sed "s/telegram_bot_token_env:.*/telegram_bot_token_env: $ENV_KEY/" \
  "$AGENT_DIR/agent.yaml.example" > "$AGENT_DIR/agent.yaml"

# Step 6: Get chat ID (reuse ALLOWED_CHAT_ID from .env)
CHAT_ID=$(grep '^ALLOWED_CHAT_ID=' .env | cut -d'=' -f2-)
echo ""
echo "Using your existing ALLOWED_CHAT_ID: $CHAT_ID"

# Step 7: Build
echo ""
echo "Building..."
npm run build

# Step 8: Test start
echo ""
echo "Starting agent '$AGENT_ID' for a quick test..."
echo "Send a message to your new bot in Telegram to verify it works."
echo "Press Ctrl+C to stop."
echo ""
node dist/index.js --agent "$AGENT_ID"
```

### 4.2 -- Add npm script

In `package.json`:

```json
"scripts": {
  ...
  "agent:create": "bash scripts/agent-create.sh",
  "agent:start": "node dist/index.js --agent"
}
```

Usage:
```bash
npm run agent:create              # interactive wizard
npm run agent:start -- comms      # start the comms agent
```

### 4.3 -- Create `scripts/agent-service.sh`

Installs a launchd plist (macOS) or systemd unit (Linux) for an agent, so it runs on boot alongside the main bot.

```bash
#!/bin/bash
# Usage: bash scripts/agent-service.sh install comms
# Usage: bash scripts/agent-service.sh uninstall comms

ACTION=$1
AGENT_ID=$2

# Generate a plist/service file from template, substituting:
#   - AGENT_ID
#   - Path to node
#   - Path to dist/index.js
#   - --agent flag
# Install to ~/Library/LaunchAgents/ (macOS) or ~/.config/systemd/user/ (Linux)
```

---

## Phase 5: Dashboard upgrade

### 5.1 -- New dashboard API endpoints

**File:** `src/dashboard.ts`

Add these endpoints (all require `?token=`):

```
GET  /api/agents                  List all configured agents (reads agents/ directory)
GET  /api/agents/:id/status       Agent health: PID alive, last activity, session age
GET  /api/agents/:id/tasks        Scheduled tasks for this agent
GET  /api/agents/:id/tokens       Token usage stats for this agent
GET  /api/hive-mind               Recent hive mind entries (all agents)
GET  /api/hive-mind?agent=comms   Filtered by agent
```

**Implementation of `GET /api/agents`:**

```typescript
app.get('/api/agents', (c) => {
  // Scan agents/ directory for folders with agent.yaml
  // For each, read the yaml and check if process is alive
  // Return: [{ id, name, description, model, running, lastActivity }]
});
```

To check if an agent process is alive: each agent process writes its PID to `store/agent-{id}.pid` on startup (same pattern as the main bot's `claudeclaw.pid`). The dashboard reads the PID file and does `kill -0 pid` to check.

### 5.2 -- Dashboard HTML: Agent surveillance panel

**File:** `src/dashboard-html.ts`

**IMPORTANT:** This file is a single function returning a massive HTML template literal (~820 lines). Before modifying it, read the entire file and understand the structure:

1. `<style>` block at the top (CSS classes: `.card`, `.pill-*`, `.stat-val`, `.gauge-bg`, etc.)
2. `<body>` with a grid layout: `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 ...">` containing 4 cards
3. Card 1: Scheduled Tasks (id=`tasks-container`)
4. Card 2: Memory Landscape (id=`mem-container`)
5. Card 3: System Health (id=`health-container`)
6. Card 4: Tokens & Cost (id=`tokens-container`)
7. Drawer overlay for memory drill-down (`.drawer`)
8. Chat overlay (floating button + slide-up panel, added by PR #1)
9. `<script>` block at the bottom (~300 lines of JS):
   - `fetchData()` function that polls all `/api/*` endpoints every 60s
   - `renderTasks()`, `renderMemories()`, `renderHealth()`, `renderTokens()` functions
   - Chart.js instances for cost timeline, memory timeline, cache donut
   - SSE connection for real-time chat
   - Chat overlay JS (send, abort, display messages)

**Where to add the agent panels:**

Add TWO new cards to the grid, BEFORE the existing 4 cards:
- Card 0: Agent Status (grid of agent cards)
- Card 0.5: Hive Mind Feed (scrollable list)

In the `<script>` block, add:
- `fetchAgents()` function that calls `GET /api/agents`
- `fetchHiveMind()` function that calls `GET /api/hive-mind`
- `renderAgents()` and `renderHiveMind()` functions
- Add both to the 60s polling interval

Add a new top-level panel to the dashboard (before the existing panels):

#### Agent Status Cards

```
┌─────────────────────────────────────────────┐
│  AGENTS                                      │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Main    │ │ Comms   │ │ Content │       │
│  │ ● live  │ │ ● live  │ │ ○ off   │       │
│  │ opus    │ │ sonnet  │ │ sonnet  │       │
│  │ 14 turns│ │ 8 turns │ │ --      │       │
│  │ $1.23   │ │ $0.34   │ │ --      │       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                              │
│  ┌─────────┐                                │
│  │ Ops     │                                │
│  │ ● live  │                                │
│  │ haiku   │                                │
│  │ 3 turns │                                │
│  │ $0.08   │                                │
│  └─────────┘                                │
└─────────────────────────────────────────────┘
```

Each card shows:
- Agent name
- Status pill (live/offline)
- Default model
- Today's turns and cost (from `token_usage WHERE agent_id = ?`)
- Click to expand: recent conversation, scheduled tasks, Obsidian folders

#### Hive Mind Feed

```
┌─────────────────────────────────────────────┐
│  HIVE MIND                                   │
│                                              │
│  10:30  comms   sent_email                   │
│         Sent proposal to Acme Corp, $15k/mo  │
│                                              │
│  10:14  ops     scheduled_meeting            │
│         Booked call with John for Thu 2pm    │
│                                              │
│  09:45  content drafted_script               │
│         YouTube script: Claude Code Tricks    │
│                                              │
│  09:30  comms   triaged_inbox                │
│         12 emails, 3 flagged urgent          │
│                                              │
│  [Load more...]                              │
└─────────────────────────────────────────────┘
```

Scrollable feed, newest first. Each entry shows timestamp, agent name (color-coded), action type, and summary. Auto-refreshes with the existing 60s polling.

### 5.3 -- Fix existing dashboard issues

While upgrading, fix these known issues:

1. **Turns counter not updating** -- The health endpoint reads from `getSessionTokenUsage()` which may return stale data if the session ID changed. Fix: also check `conversation_log` count as a fallback.

2. **Cost not updating** -- Same root cause. The `getDashboardTokenStats()` query filters by `chat_id` which is correct, but if the dashboard is opened before any messages are sent in a session, it shows zeros. Fix: ensure the polling interval (`setInterval` in the HTML JS) re-fetches `/api/tokens` on each tick.

3. **Context gauge** -- PR #1 fixed the `||` vs `+` bug. Verify the gauge reflects the fix correctly. The gauge should show `lastContextTokens` (the actual input_tokens from the last API call), not a sum.

### 5.4 -- Mobile-friendly layout for agents

The current dashboard is already responsive (single column on mobile, two columns on desktop). The agent panel should follow the same pattern:

- **Mobile:** Agent cards stack vertically, one per row. Hive mind feed is full-width below.
- **Desktop:** Agent cards in a flex row (up to 4 per row). Hive mind in a sidebar or below.

Use the existing Tailwind CDN and card styling (`bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl`).

### 5.5 -- SSE events for agent activity

**File:** `src/state.ts`

Extend the existing SSE event system to include agent-specific events:

```typescript
export interface ChatEvent {
  type: 'user_message' | 'assistant_message' | 'processing' | 'progress' | 'error' | 'hive_mind';
  chatId: string;
  agentId?: string;    // NEW
  content?: string;
  // ... existing fields
}
```

When an agent logs to the hive mind (via the DB function, not the CLI), emit an SSE event so the dashboard updates in real-time without waiting for the 60s poll.

---

## Phase 6: Telegram bot creation (exact steps)

These are the exact BotFather interactions the executing agent should perform. The user will need to do these in Telegram manually, but the agent should guide them step by step and pause for input.

### Bots to create

| Agent ID | Suggested bot name | Suggested username | Env var |
|----------|-------------------|-------------------|---------|
| comms | YourName Comms | yourname_comms_bot | COMMS_BOT_TOKEN |
| content | YourName Content | yourname_content_bot | CONTENT_BOT_TOKEN |
| ops | YourName Ops | yourname_ops_bot | OPS_BOT_TOKEN |
| research | YourName Research | yourname_research_bot | RESEARCH_BOT_TOKEN |

The executing agent should:

1. Tell the user to open Telegram and message @BotFather
2. For each bot:
   a. User sends `/newbot` to BotFather
   b. User enters the bot name (e.g., "YourName Comms")
   c. User enters the username (e.g., "yourname_comms_bot")
   d. User copies the token and pastes it back
   e. Agent appends the token to `.env` as the correct env var
3. After all tokens are collected, agent runs `npm run build`
4. Agent starts each agent process to verify it connects
5. Agent registers commands for each bot via the Telegram API (same `setMyCommands` pattern as the main bot, but with agent-appropriate commands)

### Commands to register per agent

Each agent bot should register these commands via `setMyCommands`:

```
/start    - Start this agent
/help     - What this agent can do
/stop     - Cancel current processing
/model    - Switch model (opus/sonnet/haiku)
/newchat  - Fresh session
/respin   - Reload recent context
/hive     - Show recent hive mind activity
/tasks    - Show this agent's scheduled tasks
```

The `/hive` and `/tasks` commands are new and agent-specific. They query the shared DB filtered by `agent_id`.

---

## Phase 7: Integration testing

### Test matrix

| Test | Expected result |
|------|----------------|
| `npm start` (no flag) | Main bot starts, works identically to before |
| `npm start -- --agent comms` | Comms agent starts with its own bot token |
| Send message to main bot | Works as before, `agent_id='main'` in DB |
| Send message to comms bot | Comms CLAUDE.md loaded, `agent_id='comms'` in DB |
| `/model haiku` in comms chat | Comms switches to Haiku |
| Create cron via comms chat | Task saved with `agent_id='comms'` |
| Cron fires in comms agent | Only comms tasks fire, not main's |
| Main bot: "what have my agents done?" | Queries hive_mind, returns cross-agent summary |
| Dashboard `/api/agents` | Returns all 4 agents with status |
| Dashboard `/api/hive-mind` | Returns recent entries from all agents |
| Both main + comms running simultaneously | No SQLite lock contention (WAL mode) |
| Kill comms agent, main bot unaffected | Separate processes, independent |

### Load test for SQLite concurrency

With all agents running simultaneously (5 processes), verify no `SQLITE_BUSY` errors. SQLite in WAL mode supports concurrent readers and one writer. With 5 bots at human-speed messaging, this should never be an issue. But test by sending messages to all bots simultaneously and checking logs for DB errors.

---

## Phase 8: Documentation

### README additions

Add a new `## Agents (optional)` section after the Dashboard section:

- What agents are and why you'd use them
- Quick start: `npm run agent:create`
- How to start an agent: `npm start -- --agent comms`
- How to run as a background service
- How to create your own agent from the template
- How cron jobs work with agents
- How the hive mind works

### Agent README

Each agent template folder should have a brief `README.md` explaining what the agent does and how to customize its CLAUDE.md.

---

## Execution order summary

```
Phase 1: Infrastructure                    ~150 lines changed
  1.1  --agent flag in index.ts
  1.2  agent-config.ts (new)
  1.3  config.ts agent-aware token
  1.4  agent.ts agentCwd parameter
  1.5  DB migrations (hive_mind + agent_id columns)
  1.6  Agent-scoped scheduler
  1.7  Agent-scoped schedule CLI
  1.8  Pass agent_id through bot.ts
  1.9  Build + test (all existing tests pass)

Phase 2: Obsidian context                  ~100 lines new
  2.1  obsidian.ts (new)
  2.2  Wire into memory.ts
  2.3  Unit tests

Phase 3: Agent templates                   ~5 folders, ~20 files
  3.1  _template agent
  3.2  comms agent
  3.3  content agent
  3.4  ops agent
  3.5  research agent

Phase 4: Telegram bot creation             ~2 scripts
  4.1  agent-create.sh (interactive wizard)
  4.2  npm script
  4.3  agent-service.sh (launchd/systemd)

Phase 5: Dashboard upgrade                 ~300 lines changed
  5.1  New API endpoints
  5.2  Agent surveillance panel (HTML)
  5.3  Fix existing dashboard issues
  5.4  Mobile-friendly agent layout
  5.5  SSE events for hive mind

Phase 6: Telegram bot creation             User interaction required
  - Create 4 bots via BotFather
  - Collect tokens
  - Register commands

Phase 7: Integration testing               Manual + automated
  - Full test matrix
  - SQLite concurrency check

Phase 8: Documentation                     README + per-agent docs
```

---

## Important notes for the executing agent

1. **Do not modify the main bot's CLAUDE.md.** It stays at project root, unchanged.

2. **Do not break existing tests.** All 108+ tests must pass after every phase. The `--agent` code path is additive only.

3. **SQLite WAL mode is already enabled** (`db.pragma('journal_mode = WAL')` in `db.ts`). This handles concurrent access from multiple processes. Do not add additional locking.

4. **The `.env` file is shared.** Agent bot tokens are added as separate env vars (`COMMS_BOT_TOKEN`, etc.), not replacing `TELEGRAM_BOT_TOKEN`. The main bot token stays as-is.

5. **The `ALLOWED_CHAT_ID` is shared.** All bots talk to the same Telegram user. Each bot just uses a different bot token.

6. **Global skills load for every agent.** The `settingSources: ['project', 'user']` in `agent.ts` ensures `~/.claude/skills/` is always loaded. The agent's CLAUDE.md comes from `cwd` which points to `agents/{id}/`.

7. **Agent CLAUDE.md files should be concise.** Under 50 lines. Smaller system prompt = fewer tokens per turn = cheaper. The whole point is focus.

8. **The dashboard only runs in the main bot process.** Agent processes skip `startDashboard()`. The dashboard queries the shared DB to show all agents' data.

9. **When creating Telegram bots**, the user must interact with @BotFather manually. The script should pause and prompt for the token after each bot creation. Usernames must be globally unique on Telegram, so suggest patterns like `{name}_comms_bot` but let the user choose.

10. **For the Obsidian vault path**, read it from the agent's `agent.yaml`. For a typical setup, the vault is at `/path/to/your/obsidian/vault`. For other users, the path will be different. The `agent.yaml.example` should have a placeholder that the setup wizard fills in.

11. **The hive mind logging pattern (sqlite3 CLI in CLAUDE.md) is intentional.** Each agent runs Claude Code as a subprocess with full Bash access. When the CLAUDE.md tells Claude to `sqlite3 store/claudeclaw.db "INSERT INTO hive_mind ..."`, Claude executes that via the Bash tool. This works because `runAgent()` sets `cwd` to the project directory (or agent directory, which is a subdirectory), and `store/` is relative to project root. For agent subdirectories, the CLAUDE.md should use an absolute path or `../store/claudeclaw.db`. Alternatively, add a `logToHiveMind()` DB function that the Bash-based notify hook calls -- but the sqlite3 approach is simpler and works today.

12. **Session uniqueness across agents.** Currently `sessions` has `chat_id TEXT PRIMARY KEY`. Since all agents share the same user (same chat_id), you need to change the primary key to `(chat_id, agent_id)` or add agent_id and update queries. The cleanest approach: `PRIMARY KEY (chat_id, agent_id)` with a migration that adds the column and recreates the index. Alternatively, keep `chat_id` as PK but prepend agent_id: `getSession(chatId)` becomes `getSession(chatId + ':' + agentId)`. The prepend approach requires zero schema changes but is less clean. Decide based on what's simpler to implement without breaking the 108+ existing tests.

13. **Running all agents simultaneously.** On a Mac with 16GB RAM, 5 Node.js processes (main + 4 agents) will use ~500MB total at idle. Each `runAgent()` call spawns a separate Claude Code subprocess that exits when done. The steady-state is 5 Node processes polling Telegram + SQLite. This is lightweight.

14. **The `scripts/agent-create.sh` must be idempotent.** If someone runs it twice for the same agent, it should detect the existing `agents/{id}/agent.yaml` and ask whether to overwrite, not silently duplicate tokens in `.env`.
