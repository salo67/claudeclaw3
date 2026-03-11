/**
 * Autopilot Wave System — enriches projects with features/waves,
 * then executes feature-by-feature with clean context per call.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { API_PORT } from './config.js';
import {
  enqueueAutopilotTask,
  isTaskEnqueued,
  getNextPendingTask,
  countRunningTasks,
  markAutopilotTaskRunning,
  markAutopilotTaskDone,
  markAutopilotTaskFailed,
  getRunningProjectIds,
  getNextPendingTaskExcludingProjects,
  resetOrphanedRunningTasks,
  getAutopilotState,
  upsertAutopilotState,
  setAutopilotStatus,
  setEnrichedPlan,
  getClarificationContext,
  appendClarificationQA,
  markProjectReady,
} from './db.js';
import { logger } from './logger.js';

const API_BASE = `http://127.0.0.1:${API_PORT}/api`;
const HEARTBEAT_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_PARALLEL_FEATURES = 3;
const DAILY_BUDGET_USD = 15.0;
const CLI_TIMEOUT_MS = 30 * 60 * 1000; // 30 min per feature
const PROJECTS_ROOT = 'C:\\Users\\salomon.DC0\\Documents\\Python';
const CLAUDE_CMD = 'C:\\Users\\salomon.DC0\\AppData\\Roaming\\npm\\claude.cmd';

type NotifyFn = (text: string) => Promise<void>;
let _notify: NotifyFn = async () => {};
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// Callback for handling clarification flow from bot
type ClarificationHandler = (projectId: string, projectName: string, questions: string[]) => Promise<void>;
let _onClarificationNeeded: ClarificationHandler = async () => {};

type EnrichmentHandler = (projectId: string, projectName: string, plan: string) => Promise<void>;
let _onEnrichmentReady: EnrichmentHandler = async () => {};

// ── API helpers ──────────────────────────────────────────────

interface ApiProject {
  id: string;
  name: string;
  description: string;
  autopilot: boolean;
  paused: boolean;
}

interface ApiFeature {
  id: string;
  project_id: string;
  description: string;
  objective: string;
  acceptance_criteria: string;
  phase: string;
  wave: number;
}

async function apiGet<T>(urlPath: string): Promise<T> {
  const res = await fetch(`${API_BASE}${urlPath}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPatch(urlPath: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API PATCH ${res.status}`);
}

async function apiPost<T>(urlPath: string, data: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API POST ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Claude CLI execution ────────────────────────────────────

function getProjectFolder(projectName: string): string {
  // Try exact name first (e.g. "claudeclaw"), then with "Proyecto " prefix
  const exact = path.join(PROJECTS_ROOT, projectName);
  if (fs.existsSync(exact)) return exact;
  const folderName = projectName.startsWith('Proyecto ') ? projectName : `Proyecto ${projectName}`;
  return path.join(PROJECTS_ROOT, folderName);
}

function runClaudeCli(prompt: string, cwd: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_CMD, ['-p', '--output-format', 'text'], {
      cwd,
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        CLAUDECODE: undefined,
        ComSpec: process.env.ComSpec || 'C:\\WINDOWS\\system32\\cmd.exe',
        SystemRoot: process.env.SystemRoot || 'C:\\WINDOWS',
        PATH: process.env.PATH || process.env.Path || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on('close', (code) => {
      resolve({ output: stdout || stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      resolve({ output: err.message, exitCode: 1 });
    });

    setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve({ output: 'Timeout after 30 minutes', exitCode: 1 });
    }, CLI_TIMEOUT_MS);
  });
}

function stripMarkdownFences(text: string): string {
  let raw = text.trim();
  if (raw.startsWith('```')) {
    raw = raw.split('\n').slice(1).join('\n');
    if (raw.endsWith('```')) raw = raw.slice(0, -3).trim();
  }
  return raw;
}

// ── Budget tracking ─────────────────────────────────────────

async function checkBudget(): Promise<boolean> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${API_BASE}/autopilot/budget?date=${today}`);
    if (!res.ok) return true; // if endpoint not ready, allow execution
    const data = await res.json() as { total_cost_usd: number };
    if (data.total_cost_usd >= DAILY_BUDGET_USD) {
      logger.warn({ spent: data.total_cost_usd, limit: DAILY_BUDGET_USD }, 'Daily budget exceeded');
      return false;
    }
    return true;
  } catch {
    return true; // allow if budget tracking unavailable
  }
}

async function recordCost(projectId: string, estimatedCost: number): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/autopilot/budget', { project_id: projectId, date: today, cost_usd: estimatedCost });
  } catch (err) {
    logger.warn({ err }, 'Failed to record autopilot cost');
  }
}

// ── Clarification phase ─────────────────────────────────────

async function startClarification(project: ApiProject): Promise<void> {
  logger.info({ projectId: project.id, name: project.name }, 'Starting clarification for project');

  upsertAutopilotState(project.id, 'clarifying');

  const prompt = `You are a software architect about to plan a project. Before creating the plan, you need to clarify key decisions with the developer.

Project: ${project.name}
Description: ${project.description || 'No description provided'}

Generate 3-5 short, specific questions that will help you create a better implementation plan. Focus on:
- Tech stack / framework preferences
- Scope boundaries (what's in vs out)
- External dependencies (APIs, DBs, services)
- Priority trade-offs (speed vs quality, MVP vs complete)
- Any existing code or patterns to follow

Respond ONLY with JSON, no markdown:
{"questions": ["Question 1?", "Question 2?", ...]}`;

  const folder = getProjectFolder(project.name);
  const { output, exitCode } = await runClaudeCli(prompt, folder);

  if (exitCode !== 0) {
    logger.error({ projectId: project.id, output: output.slice(0, 300) }, 'Clarification generation failed');
    setAutopilotStatus(project.id, 'new'); // retry on next heartbeat
    return;
  }

  try {
    const raw = stripMarkdownFences(output);
    const parsed = JSON.parse(raw);
    const questions: string[] = parsed.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      logger.error({ projectId: project.id }, 'No questions generated');
      setAutopilotStatus(project.id, 'new');
      return;
    }

    // Store questions in qa_context (answers will be filled by bot)
    for (const q of questions) {
      appendClarificationQA(project.id, q, '');
    }

    // Notify via callback so bot can send questions to Telegram
    await _onClarificationNeeded(project.id, project.name, questions);

    logger.info({ projectId: project.id, questionCount: questions.length }, 'Clarification questions sent');
  } catch (err) {
    logger.error({ err, projectId: project.id }, 'Failed to parse clarification questions');
    setAutopilotStatus(project.id, 'new');
  }
}

// ── Enrichment phase ────────────────────────────────────────

export async function enrichProject(projectId: string): Promise<void> {
  try {
    const project = await apiGet<ApiProject>(`/projects/${projectId}`);
    const qaContext = getClarificationContext(projectId);
    const existingFeatures = await apiGet<ApiFeature[]>(`/features?project_id=${projectId}`);
    const folder = getProjectFolder(project.name);

    const qaSection = qaContext
      .filter((qa) => qa.a) // only answered questions
      .map((qa) => `Q: ${qa.q}\nA: ${qa.a}`)
      .join('\n\n');

    const existingSection = existingFeatures.length > 0
      ? `\nExisting features (incorporate and assign waves, don't duplicate):\n${existingFeatures.map((f) => `- ${f.description} (objective: ${f.objective})`).join('\n')}`
      : '';

    const prompt = `You are a software architect planning the implementation of a project.

Project: ${project.name}
Description: ${project.description || 'No description provided'}
Working directory: ${folder}
${existingSection}

Clarification context (Q&A with the developer):
${qaSection || 'No clarification provided'}

Break the project into 4-8 well-scoped features. Each feature should be implementable in a single focused coding session (30-60 min).

Assign wave numbers based on dependencies:
- Wave 1: foundational (models, config, core infrastructure)
- Wave 2: core functionality building on wave 1
- Wave 3: integration, UI, secondary features
- Wave 4+: polish, optimization, docs

Features in the same wave MUST have NO dependencies on each other.

Respond ONLY with valid JSON, no markdown, no explanations:
{"features": [{"description":"...","objective":"...","acceptance_criteria":"...","wave":1,"priority":"high"}]}`;

    logger.info({ projectId }, 'Running enrichment CLI call');
    const { output, exitCode } = await runClaudeCli(prompt, folder);

    if (exitCode !== 0) {
      logger.error({ projectId, output: output.slice(0, 300) }, 'Enrichment failed');
      await _notify(`Enrichment failed for ${project.name}: ${output.slice(0, 200)}`);
      return;
    }

    const raw = stripMarkdownFences(output);
    const parsed = JSON.parse(raw);
    const features: Array<{ description: string; objective: string; acceptance_criteria: string; wave: number; priority: string }> = parsed.features;

    if (!Array.isArray(features) || features.length === 0) {
      logger.error({ projectId }, 'Enrichment returned no features');
      return;
    }

    // Delete existing features if any (re-enrichment)
    for (const ef of existingFeatures) {
      await fetch(`${API_BASE}/features/${ef.id}`, { method: 'DELETE' });
    }

    // Create new features via API
    for (const f of features) {
      await apiPost('/features', {
        project_id: projectId,
        description: f.description,
        objective: f.objective || '',
        acceptance_criteria: f.acceptance_criteria || '',
        wave: f.wave,
        priority: f.priority || 'medium',
        phase: 'backlog',
      });
    }

    // Build plan summary for user confirmation
    const waveMap = new Map<number, string[]>();
    for (const f of features) {
      if (!waveMap.has(f.wave)) waveMap.set(f.wave, []);
      waveMap.get(f.wave)!.push(f.description);
    }

    const planLines: string[] = [`Plan for ${project.name}:\n`];
    for (const [wave, descs] of [...waveMap.entries()].sort((a, b) => a[0] - b[0])) {
      planLines.push(`Wave ${wave}:`);
      for (const d of descs) {
        planLines.push(`  - ${d}`);
      }
    }
    planLines.push(`\nTotal: ${features.length} features in ${waveMap.size} waves`);
    planLines.push('\nResponde "ok" o "go" para confirmar y empezar la ejecucion.');

    const planText = planLines.join('\n');

    setEnrichedPlan(projectId, planText);
    await apiPatch(`/projects/${projectId}`, { phase: 'in_progress' });

    // Notify user with the plan for confirmation
    await _onEnrichmentReady(projectId, project.name, planText);

    logger.info({ projectId, featureCount: features.length, waves: waveMap.size }, 'Project enriched, waiting for confirmation');
    recordCost(projectId, 0.50); // estimate enrichment cost
  } catch (err) {
    logger.error({ err, projectId }, 'Enrichment error');
  }
}

// ── Wave execution ──────────────────────────────────────────

function getActiveWave(features: ApiFeature[]): number {
  const incompleteWaves = features
    .filter((f) => f.phase !== 'done')
    .map((f) => f.wave)
    .filter((w) => w > 0);

  if (incompleteWaves.length === 0) return 0;
  return Math.min(...incompleteWaves);
}

async function executeFeature(item: ReturnType<typeof getNextPendingTask> & {}): Promise<void> {
  markAutopilotTaskRunning(item.id);

  const folder = getProjectFolder(item.project_name);

  if (!fs.existsSync(folder)) {
    const msg = `Project folder not found: ${folder}`;
    logger.error({ queueId: item.id, folder }, msg);
    markAutopilotTaskFailed(item.id, msg);
    await _notify(`Autopilot skipped (folder missing):\n${item.task_desc}\n${folder}`);
    return;
  }

  logger.info({ queueId: item.id, feature: item.task_desc, folder }, 'Autopilot executing feature');

  await _notify(`Autopilot executing:\n${item.task_desc}\nProject: ${item.project_name}`);

  try {
    // Fetch feature details for the prompt
    let objective = '';
    let criteria = '';
    try {
      const feature = await apiGet<ApiFeature>(`/features/${item.feature_id}`);
      objective = feature.objective || '';
      criteria = feature.acceptance_criteria || '';
      // Mark feature as in_progress
      await apiPatch(`/features/${item.feature_id}`, { phase: 'in_progress' });
    } catch { /* proceed without details */ }

    const prompt = `Implement this feature for the ${item.project_name} project.

Feature: ${item.task_desc}
${objective ? `Objective: ${objective}` : ''}
${criteria ? `Acceptance Criteria: ${criteria}` : ''}

Instructions:
1. Read the codebase to understand current state
2. Implement the feature completely
3. Write/update tests for the acceptance criteria
4. Run tests to verify nothing is broken
5. Commit with message: "feat: ${item.task_desc.slice(0, 60)}"

VERIFY before finishing: confirm each acceptance criterion is met. If not, fix it.
Do NOT over-engineer. Implement exactly what is described.`;

    const { output, exitCode } = await runClaudeCli(prompt, folder);

    if (exitCode === 0) {
      const shaMatch = output.match(/\b([0-9a-f]{7,40})\b/);
      const sha = shaMatch?.[1] ?? '';

      markAutopilotTaskDone(item.id, output, sha, 'passed');

      try {
        await apiPatch(`/features/${item.feature_id}`, { phase: 'done', completed: true });
      } catch (err) {
        logger.error({ err }, 'Failed to mark feature as done');
      }

      const summary = output.length > 300 ? output.slice(0, 300) + '...' : output;
      await _notify(`Feature done:\n${item.task_desc}\n${sha ? `Commit: ${sha}\n` : ''}${summary}`);
      logger.info({ queueId: item.id, sha }, 'Feature completed');

      // Check if wave is complete, advance
      await tryAdvanceWave(item.project_id, item.project_name);

      recordCost(item.project_id, 1.00); // estimate per-feature cost
    } else {
      markAutopilotTaskFailed(item.id, output.slice(0, 2000));
      await _notify(`Feature failed:\n${item.task_desc}\n${output.slice(0, 200)}`);
      logger.error({ queueId: item.id, output: output.slice(0, 500) }, 'Feature execution failed');
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    markAutopilotTaskFailed(item.id, errMsg);
    await _notify(`Feature error:\n${item.task_desc}\n${errMsg}`);
    logger.error({ err }, 'Feature execution error');
  }

  // Try to launch another worker
  setTimeout(() => void launchWorkers(), 2000);
}

// ── Wave advancement ────────────────────────────────────────

async function tryAdvanceWave(projectId: string, projectName: string): Promise<void> {
  try {
    const features = await apiGet<ApiFeature[]>(`/features?project_id=${projectId}`);
    const activeWave = getActiveWave(features);

    if (activeWave === 0) {
      // All waves complete
      await _notify(`All waves complete for ${projectName}. Finalizing...`);
      await tryFinalizeProject(projectId, projectName);
      return;
    }

    const waveFeatures = features.filter((f) => f.wave === activeWave);
    const allDone = waveFeatures.every((f) => f.phase === 'done');

    if (allDone) {
      const nextWave = getActiveWave(features.filter((f) => f.wave !== activeWave));
      logger.info({ projectId, completedWave: activeWave, nextWave }, 'Wave complete, advancing');
      await _notify(`Wave ${activeWave} complete for ${projectName}. Next: Wave ${nextWave || 'none'}`);
    }
  } catch (err) {
    logger.error({ err, projectId }, 'Failed to check/advance wave');
  }
}

async function tryFinalizeProject(projectId: string, projectName: string): Promise<void> {
  try {
    logger.info({ projectId, projectName }, 'All features done, finalizing project');
    await _notify(`All features complete for ${projectName}! Running final checks...`);

    const folder = getProjectFolder(projectName);

    const prompt = 'Run the test suite (pytest or npm test). Fix any failing tests. If there is no README.md, create one. If there is one, review and update it. Include: what the project does, how to install, how to run, environment variables needed, how to test, and architecture overview. Write in Spanish. Commit changes.';
    await runClaudeCli(prompt, folder);

    await apiPatch(`/projects/${projectId}`, { completed: true, phase: 'done' });
    await _notify(`Project "${projectName}" finalized! Tests run, README updated, marked as completed.`);
    logger.info({ projectId, projectName }, 'Project finalized');

    recordCost(projectId, 0.50);
  } catch (err) {
    logger.error({ err, projectId }, 'Project finalization failed');
  }
}

// ── Heartbeat scan ──────────────────────────────────────────

async function scanAndEnqueue(): Promise<void> {
  try {
    const projects = await apiGet<ApiProject[]>('/projects');
    const autopilotProjects = projects.filter((p) => p.autopilot && !p.paused);

    for (const project of autopilotProjects) {
      const state = getAutopilotState(project.id);

      if (!state || state.status === 'new') {
        await startClarification(project);
        continue;
      }

      if (state.status === 'clarifying') {
        continue; // waiting for user replies
      }

      if (state.status === 'enriched') {
        continue; // waiting for user confirmation
      }

      // status === 'ready' -- execute waves
      if (!(await checkBudget())) {
        await _notify(`Budget exceeded ($${DAILY_BUDGET_USD}/day). Pausing autopilot.`);
        await apiPatch(`/projects/${project.id}`, { paused: true });
        continue;
      }

      const features = await apiGet<ApiFeature[]>(`/features?project_id=${project.id}`);
      const activeWave = getActiveWave(features);

      if (activeWave === 0) {
        await tryFinalizeProject(project.id, project.name);
        continue;
      }

      // Enqueue features from active wave that aren't done or already queued
      const waveFeatures = features.filter((f) => f.wave === activeWave && f.phase !== 'done');

      for (const feature of waveFeatures) {
        if (!isTaskEnqueued(feature.id)) {
          enqueueAutopilotTask(feature.id, feature.id, project.id, feature.description, project.name);
          logger.info({ featureId: feature.id, wave: activeWave, project: project.name }, 'Enqueued feature for execution');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Autopilot scan failed');
  }
}

// ── Launch parallel workers ─────────────────────────────────

async function launchWorkers(): Promise<void> {
  const running = countRunningTasks();
  const slotsAvailable = MAX_PARALLEL_FEATURES - running;
  if (slotsAvailable <= 0) return;

  // One feature per project at a time to avoid git conflicts
  const busyProjectIds = getRunningProjectIds();

  for (let i = 0; i < slotsAvailable; i++) {
    const item = getNextPendingTaskExcludingProjects(busyProjectIds);
    if (!item) break;

    busyProjectIds.push(item.project_id);
    void executeFeature(item);
  }
}

// ── Heartbeat ───────────────────────────────────────────────

async function heartbeat(): Promise<void> {
  logger.info('Autopilot heartbeat tick');
  try {
    await scanAndEnqueue();
    await launchWorkers();
  } catch (err) {
    logger.error({ err }, 'Heartbeat error');
  }
}

// ── Public API ──────────────────────────────────────────────

export function initAutopilot(
  notify: NotifyFn,
  onClarification?: ClarificationHandler,
  onEnrichment?: EnrichmentHandler,
): void {
  _notify = notify;
  if (onClarification) _onClarificationNeeded = onClarification;
  if (onEnrichment) _onEnrichmentReady = onEnrichment;

  const orphaned = resetOrphanedRunningTasks();
  if (orphaned > 0) {
    logger.info({ count: orphaned }, 'Reset orphaned running tasks to pending');
  }

  logger.info('Autopilot initialized (heartbeat every 20 min)');

  // First heartbeat after 30 seconds
  setTimeout(() => void heartbeat(), 30_000);
  _heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
}

export function stopAutopilot(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

/**
 * Called by the bot when user replies to a clarification question.
 * Collects answers and triggers enrichment when all questions are answered.
 */
export async function handleClarificationReply(projectId: string, answer: string): Promise<void> {
  const qa = getClarificationContext(projectId);
  // Find next unanswered question
  const unanswered = qa.findIndex((item) => !item.a);
  if (unanswered === -1) return; // all answered already

  // Update the answer for the current question
  appendClarificationQA(projectId, qa[unanswered].q, answer);

  // Re-read to check if there are more unanswered
  const updated = getClarificationContext(projectId);
  const nextUnanswered = updated.findIndex((item) => !item.a);

  if (nextUnanswered === -1 || answer.toLowerCase().match(/^(go|listo|ok|dale|start)$/)) {
    // All answered or user wants to proceed
    await enrichProject(projectId);
  } else {
    // Send next question
    await _notify(updated[nextUnanswered].q);
  }
}

/**
 * Called by the bot when user confirms an enrichment plan.
 */
export function handleEnrichmentConfirmation(projectId: string): void {
  markProjectReady(projectId);
  logger.info({ projectId }, 'Enrichment confirmed by user, project ready for execution');
}
