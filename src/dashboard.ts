import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';

import fs from 'fs';
import path from 'path';
import { AGENT_ID, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, PROJECT_ROOT, STORE_DIR, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT, agentDefaultModel } from './config.js';
import {
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getDashboardMemoriesBySector,
  getSession,
  getSessionTokenUsage,
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
  // ── New CRUD imports ──
  createProject, getProject, listProjects, updateProject, deleteProject,
  createFeature, getFeature, listFeatures, updateFeature, deleteFeature,
  createKanbanTask, listKanbanTasks, updateKanbanTask, deleteKanbanTask,
  createDocument, listDocuments, deleteDocument,
  createNote, getNote, listNotes, updateNote, deleteNote,
  getJournalEntry, listJournalEntries, listJournalDates, upsertJournalEntry, deleteJournalEntry,
  createAlert, listAlerts, dismissAlert, executeAlert, deleteAlert,
  listPulseModules, createPulseModule, updatePulseModule, deletePulseModule, reorderPulseModules, getLatestPulse, listDailyPulses, insertDailyPulse,
  getAutopilotQueue, retryAutopilotTask, deleteAutopilotTask,
  getSchedulerLogs,
} from './db.js';
import { listAgentIds, loadAgentConfig } from './agent-config.js';
import { processMessageFromDashboard } from './bot.js';
import { getDashboardHtml } from './dashboard-html.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';

export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = new Hono();

  // CORS headers for cross-origin access (Cloudflare tunnel, mobile browsers)
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Global error handler — prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Token auth middleware
  app.use('*', async (c, next) => {
    const token = c.req.query('token');
    if (!DASHBOARD_TOKEN || !token || token !== DASHBOARD_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // Serve dashboard HTML
  app.get('/', (c) => {
    const chatId = c.req.query('chatId') || '';
    return c.html(getDashboardHtml(DASHBOARD_TOKEN, chatId));
  });

  // Kanban tasks (used by KanbanPage / ProjectDetailPage)
  app.get('/api/tasks', (c) => {
    const params: { project_id?: string; feature_id?: string } = {};
    if (c.req.query('project_id')) params.project_id = c.req.query('project_id');
    if (c.req.query('feature_id')) params.feature_id = c.req.query('feature_id');
    return c.json(listKanbanTasks(params));
  });
  app.post('/api/tasks', async (c) => c.json(createKanbanTask(await c.req.json())));
  app.patch('/api/tasks/:id', async (c) => {
    updateKanbanTask(c.req.param('id'), await c.req.json());
    return c.body(null, 204);
  });
  app.delete('/api/tasks/:id', (c) => {
    deleteKanbanTask(c.req.param('id'));
    return c.body(null, 204);
  });

  // Memory stats
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    return c.json({ stats, fading, topAccessed, timeline });
  });

  // Memory list by sector (for drill-down)
  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || '';
    const sector = c.req.query('sector') || 'semantic';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const result = getDashboardMemoriesBySector(chatId, sector, limit, offset);
    return c.json(result);
  });

  // System health
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        const contextTokens = (summary.lastContextTokens || 0) + (summary.lastCacheRead || 0);
        contextPct = contextTokens > 0 ? Math.round((contextTokens / CONTEXT_LIMIT) * 100) : 0;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    return c.json({
      contextPct,
      turns,
      compactions,
      sessionAge,
      model: agentDefaultModel || 'sonnet-4-6',
      telegramConnected: getTelegramConnected(),
      waConnected: WHATSAPP_ENABLED,
      slackConnected: !!SLACK_USER_TOKEN,
    });
  });

  // Token / cost stats
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', (c) => {
    const chatId = c.req.query('chatId') || '';
    const info = getBotInfo();
    return c.json({
      botName: info.name || 'ClaudeClaw',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: chatId || null,
    });
  });

  // ── Agent endpoints ──────────────────────────────────────────────────

  // List all configured agents with status
  app.get('/api/agents', (c) => {
    const agentIds = listAgentIds();
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file
        const pidFile = path.join(STORE_DIR, `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 0); // signal 0 = check if alive
            running = true;
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        return {
          id,
          name: config.name,
          description: config.description,
          model: config.model ?? 'claude-opus-4-6',
          running,
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
        };
      } catch {
        return { id, name: id, description: '', model: 'unknown', running: false, todayTurns: 0, todayCost: 0 };
      }
    });

    // Include main bot too
    const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
    let mainRunning = false;
    if (fs.existsSync(mainPidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        mainRunning = true;
      } catch { /* not running */ }
    }
    const mainStats = getAgentTokenStats('main');
    const allAgents = [
      { id: 'main', name: 'Main', description: 'Primary ClaudeClaw bot', model: 'claude-opus-4-6', running: mainRunning, todayTurns: mainStats.todayTurns, todayCost: mainStats.todayCost },
      ...agents,
    ];

    return c.json({ agents: allAgents });
  });

  // Agent-specific recent conversation
  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (!chatId) return c.json({ error: 'chatId required' }, 400);
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Send message from dashboard
  app.post('/api/chat/send', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    const body = await c.req.json<{ message?: string }>();
    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);

    // Fire-and-forget: response comes via SSE
    void processMessageFromDashboard(botApi, message);
    return c.json({ ok: true });
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });

  // ── Projects ────────────────────────────────────────────
  app.get('/api/projects', (c) => c.json(listProjects()));
  app.get('/api/projects/:id', (c) => {
    const p = getProject(c.req.param('id'));
    return p ? c.json(p) : c.json({ error: 'Not found' }, 404);
  });
  app.post('/api/projects', async (c) => c.json(createProject(await c.req.json())));
  app.patch('/api/projects/:id', async (c) => {
    updateProject(c.req.param('id'), await c.req.json());
    const p = getProject(c.req.param('id'));
    return p ? c.json(p) : c.json({ error: 'Not found' }, 404);
  });
  app.delete('/api/projects/:id', (c) => {
    deleteProject(c.req.param('id'));
    return c.body(null, 204);
  });

  // ── Features ────────────────────────────────────────────
  app.get('/api/features', (c) => c.json(listFeatures(c.req.query('project_id') || undefined)));
  app.get('/api/features/:id', (c) => {
    const f = getFeature(c.req.param('id'));
    return f ? c.json(f) : c.json({ error: 'Not found' }, 404);
  });
  app.post('/api/features', async (c) => c.json(createFeature(await c.req.json())));
  app.patch('/api/features/:id', async (c) => {
    updateFeature(c.req.param('id'), await c.req.json());
    return c.body(null, 204);
  });
  app.delete('/api/features/:id', (c) => {
    deleteFeature(c.req.param('id'));
    return c.body(null, 204);
  });

  // ── Documents ───────────────────────────────────────────
  app.get('/api/documents', (c) => c.json(listDocuments(c.req.query('project_id') || '')));
  app.post('/api/documents', async (c) => c.json(createDocument(await c.req.json())));
  app.delete('/api/documents/:id', (c) => {
    deleteDocument(c.req.param('id'));
    return c.body(null, 204);
  });

  // ── Notes ───────────────────────────────────────────────
  app.get('/api/notes', (c) => {
    const params: Record<string, string> = {};
    for (const k of ['search', 'tags', 'project_id', 'pinned']) {
      const v = c.req.query(k);
      if (v) params[k] = v;
    }
    return c.json(listNotes(params));
  });
  app.get('/api/notes/:id', (c) => {
    const n = getNote(c.req.param('id'));
    return n ? c.json(n) : c.json({ error: 'Not found' }, 404);
  });
  app.post('/api/notes', async (c) => c.json(createNote(await c.req.json())));
  app.patch('/api/notes/:id', async (c) => {
    const n = updateNote(c.req.param('id'), await c.req.json());
    return n ? c.json(n) : c.json({ error: 'Not found' }, 404);
  });
  app.delete('/api/notes/:id', (c) => {
    deleteNote(c.req.param('id'));
    return c.body(null, 204);
  });

  // ── Journal ─────────────────────────────────────────────
  app.get('/api/journal', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    return c.json(listJournalEntries(limit, offset));
  });
  app.get('/api/journal/dates', (c) => {
    const year = c.req.query('year') ? parseInt(c.req.query('year')!, 10) : undefined;
    const month = c.req.query('month') ? parseInt(c.req.query('month')!, 10) : undefined;
    return c.json(listJournalDates(year, month));
  });
  app.get('/api/journal/:date', (c) => {
    const entry = getJournalEntry(c.req.param('date'));
    return entry ? c.json(entry) : c.json({ error: 'Not found' }, 404);
  });
  app.put('/api/journal/:date', async (c) => {
    const data = await c.req.json();
    return c.json(upsertJournalEntry(c.req.param('date'), data));
  });
  app.delete('/api/journal/:date', (c) => {
    deleteJournalEntry(c.req.param('date'));
    return c.body(null, 204);
  });

  // ── Alerts ──────────────────────────────────────────────
  app.get('/api/alerts', (c) => {
    const dismissed = c.req.query('dismissed') === 'true';
    return c.json(listAlerts(dismissed));
  });
  app.post('/api/alerts', async (c) => c.json(createAlert(await c.req.json())));
  app.patch('/api/alerts/:id/dismiss', (c) => {
    const a = dismissAlert(c.req.param('id'));
    return a ? c.json(a) : c.json({ error: 'Not found' }, 404);
  });
  app.patch('/api/alerts/:id/execute', (c) => {
    const a = executeAlert(c.req.param('id'));
    return a ? c.json(a) : c.json({ error: 'Not found' }, 404);
  });
  app.delete('/api/alerts/:id', (c) => {
    deleteAlert(c.req.param('id'));
    return c.body(null, 204);
  });

  // ── Pulse Modules ───────────────────────────────────────
  app.get('/api/pulse/modules', (c) => c.json(listPulseModules()));
  app.post('/api/pulse/modules', async (c) => c.json(createPulseModule(await c.req.json())));
  app.put('/api/pulse/modules/:id', async (c) => {
    updatePulseModule(c.req.param('id'), await c.req.json());
    return c.json({ ok: true });
  });
  app.delete('/api/pulse/modules/:id', (c) => {
    deletePulseModule(c.req.param('id'));
    return c.body(null, 204);
  });
  app.post('/api/pulse/modules/reorder', async (c) => {
    const { ids } = await c.req.json() as { ids: string[] };
    reorderPulseModules(ids);
    return c.json({ ok: true });
  });

  // ── Pulse Dashboard Data ─────────────────────────────────
  app.get('/api/pulse/latest', (c) => {
    const pulse = getLatestPulse();
    if (!pulse) return c.json({ pulse: null });
    return c.json({ pulse: { ...pulse, snapshot: JSON.parse(pulse.snapshot || '{}') } });
  });
  app.get('/api/pulse/history', (c) => {
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = parseInt(c.req.query('page_size') || '10', 10);
    const result = listDailyPulses(page, pageSize);
    return c.json({
      items: result.items.map(p => ({ ...p, snapshot: JSON.parse(p.snapshot || '{}') })),
      total: result.total,
      page, page_size: pageSize,
    });
  });
  app.get('/api/pulse/advisors-overnight', (c) => c.json([]));
  app.get('/api/pulse/briefing', (c) => {
    const pulse = getLatestPulse();
    if (!pulse) return c.json({ date: new Date().toISOString().slice(0, 10), sections: [] });
    const snapshot = JSON.parse(pulse.snapshot || '{}');
    return c.json({ date: pulse.date, generated_at: pulse.generated_at, snapshot });
  });
  app.post('/api/pulse/generate', async (c) => {
    const HUB_URL = 'http://localhost:8000';
    const TIMEOUT = 8000;

    async function fetchJson(url: string): Promise<any> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`${r.status}`);
        return await r.json();
      } finally { clearTimeout(timer); }
    }

    async function section(name: string, urls: Record<string, string>): Promise<any> {
      try {
        const data: Record<string, any> = {};
        for (const [key, url] of Object.entries(urls)) {
          data[key] = await fetchJson(url);
        }
        return { status: 'ok', data };
      } catch (exc: any) {
        return { status: 'error', error: String(exc?.message || exc) };
      }
    }

    function hubSection(name: string, paths: Record<string, string>) {
      const urls: Record<string, string> = {};
      for (const [k, p] of Object.entries(paths)) urls[k] = `${HUB_URL}${p}`;
      return section(name, urls);
    }

    try {
      const [
        margin_health, forecast_alerts, supply_chain, sales_summary,
        inventory_health, hd_performance, debt_analysis, exchange_rate,
        stockouts, kpis_hd, cashflow, pending_approvals, email_stats,
      ] = await Promise.all([
        hubSection('margin_health', {
          summary: '/api/v1/margenes/margins/summary',
          deteriorating: '/api/v1/margenes/trends/deteriorating',
          blocked: '/api/v1/margenes/stockout/blocked',
          recommendations: '/api/v1/margenes/trends/recommendations',
        }),
        hubSection('forecast_alerts', {
          summary: '/api/v1/forecast/alerts/summary',
          abc: '/api/v1/forecast/abc/summary',
        }),
        hubSection('supply_chain', {
          dashboard: '/api/v1/supply-tracker/dashboard',
          overdue: '/api/v1/supply-tracker/payments/overdue',
          arrivals: '/api/v1/supply-tracker/arrivals',
          orders: '/api/v1/supply-tracker/orders',
        }),
        hubSection('sales_summary', {
          summary: '/api/v1/hq/lloyd-sales/summary',
        }),
        hubSection('inventory_health', {
          transit_stock: '/api/v1/forecast/transit-stock',
          inventory_days: '/api/v1/forecast/inventory',
        }),
        hubSection('hd_performance', {
          fill_rate: '/api/v1/fill-rate',
        }),
        hubSection('debt_analysis', {
          debt: '/api/v1/supply-tracker/debt-analysis',
        }),
        (async () => {
          try {
            const r = await fetchJson('https://open.er-api.com/v6/latest/USD');
            return { status: 'ok', data: { usd_mxn: r?.rates?.MXN, source: 'open.er-api.com' } };
          } catch (e: any) { return { status: 'error', error: String(e?.message || e) }; }
        })(),
        // Stockouts from port 8002
        section('stockouts', { stockouts: 'http://localhost:8002/api/stockouts' }),
        // KPIs HD from port 8002
        section('kpis_hd', { kpis: 'http://localhost:8002/api/kpis' }),
        // Cashflow from port 8310
        section('cashflow', {
          balance: 'http://localhost:8310/api/cashflow/balance',
          pending: 'http://localhost:8310/api/cashflow/pending',
        }),
        // Pending approvals from port 8310
        section('pending_approvals', {
          approvals: 'http://localhost:8310/api/cxp-management/approvals/pending',
        }),
        // Email stats from port 8055
        section('email_stats', { stats: 'http://localhost:8055/api/emails/stats' }),
      ]);

      const generated_at = new Date().toISOString();
      const snapshot: Record<string, any> = {
        generated_at, margin_health, forecast_alerts, supply_chain,
        sales_summary, inventory_health, hd_performance, debt_analysis,
        exchange_rate, stockouts, kpis_hd, cashflow, pending_approvals, email_stats,
        cc_alerts: { status: 'ok', data: { alerts: [], total: 0, critical: 0, warning: 0 } },
      };

      const id = Math.random().toString(36).slice(2, 14);
      const date = generated_at.slice(0, 10);
      insertDailyPulse({ id, date, snapshot: JSON.stringify(snapshot), generated_at });

      return c.json({ ok: true, id, date, generated_at, snapshot });
    } catch (err: any) {
      return c.json({ ok: false, error: String(err?.message || err) }, 500);
    }
  });

  // ── Status ──────────────────────────────────────────────
  app.get('/api/status', (c) => {
    const chatId = ALLOWED_CHAT_ID;
    const tokenStats = getDashboardTokenStats(chatId);
    const tasks = getAllScheduledTasks();
    const session = getSession(chatId);
    const sessionTokens = session ? getSessionTokenUsage(session) : null;
    return c.json({
      telegram_connected: getTelegramConnected(),
      bot_info: getBotInfo(),
      token_usage_today: sessionTokens ? {
        turns: sessionTokens.turns,
        total_input: sessionTokens.totalInputTokens,
        total_output: sessionTokens.totalOutputTokens,
        peak_cache_read: sessionTokens.lastCacheRead,
        total_cost: sessionTokens.totalCostUsd,
        compactions: sessionTokens.compactions,
      } : { turns: tokenStats.todayTurns, total_input: tokenStats.todayInput, total_output: tokenStats.todayOutput, peak_cache_read: 0, total_cost: tokenStats.todayCost, compactions: 0 },
      scheduled_tasks: tasks.length,
      uptime: process.uptime(),
    });
  });

  // ── Autopilot Queue ─────────────────────────────────────
  app.get('/api/autopilot/queue', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json(getAutopilotQueue(status));
  });
  app.post('/api/autopilot/queue/:id/retry', (c) => {
    retryAutopilotTask(parseInt(c.req.param('id'), 10));
    return c.json({ ok: true });
  });
  app.delete('/api/autopilot/queue/:id', (c) => {
    deleteAutopilotTask(parseInt(c.req.param('id'), 10));
    return c.body(null, 204);
  });

  // ── Scheduler Logs ──────────────────────────────────────
  app.get('/api/scheduler/logs', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    return c.json(getSchedulerLogs(limit));
  });
  app.get('/api/scheduler/tasks', (c) => c.json(getAllScheduledTasks()));
  app.post('/api/scheduler/tasks/:id/pause', (c) => {
    pauseScheduledTask(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/api/scheduler/tasks/:id/resume', (c) => {
    resumeScheduledTask(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.delete('/api/scheduler/tasks/:id', (c) => {
    deleteScheduledTask(c.req.param('id'));
    return c.json({ ok: true });
  });

  // ── Newsletter Config ──
  const newsletterConfigPath = path.join(STORE_DIR, 'newsletter-config.json');

  function readNewsletterConfig() {
    try {
      return JSON.parse(fs.readFileSync(newsletterConfigPath, 'utf-8'));
    } catch {
      return {
        sections: {
          portada: { enabled: true, order: 1 },
          economia: { enabled: true, order: 2 },
          negocios: { enabled: true, order: 3 },
          opinion: { enabled: true, order: 4 },
          internacional: { enabled: true, order: 5 },
        },
        columns: {},
      };
    }
  }

  app.get('/api/newsletter/config', (c) => {
    return c.json(readNewsletterConfig());
  });

  app.put('/api/newsletter/config', async (c) => {
    const body = await c.req.json();
    const json = JSON.stringify(body, null, 2);
    fs.writeFileSync(newsletterConfigPath, json);
    // Sync to the Newsletter project so generation picks up changes
    try {
      const newsletterProjectConfig = path.resolve(STORE_DIR, '../../Proyecto Newsletter/newsletter_config.json');
      fs.writeFileSync(newsletterProjectConfig, json);
    } catch { /* Newsletter project may not exist */ }
    return c.json({ ok: true });
  });

  // ── Newsletter Latest & Generate ──
  const newsletterOutputDir = path.resolve(STORE_DIR, '../../Proyecto Newsletter/output');
  const newsletterProjectDir = path.resolve(STORE_DIR, '../../Proyecto Newsletter');

  app.get('/api/newsletter/latest', (c) => {
    try {
      const files = fs.readdirSync(newsletterOutputDir)
        .filter((f: string) => f.match(/^newsletter_\d{8}\.html$/))
        .sort()
        .reverse();
      if (files.length === 0) return c.json({ html: null, date: null });
      const latest = files[0];
      const date = latest.match(/(\d{8})/)?.[1] || '';
      const html = fs.readFileSync(path.join(newsletterOutputDir, latest), 'utf-8');
      // Check for stats
      const statsFile = latest.replace('.html', '_stats.json');
      let stats = null;
      try { stats = JSON.parse(fs.readFileSync(path.join(newsletterOutputDir, statsFile), 'utf-8')); } catch {}
      return c.json({ html, date, filename: latest, stats });
    } catch { return c.json({ html: null, date: null }); }
  });

  app.get('/api/newsletter/list', (c) => {
    try {
      const files = fs.readdirSync(newsletterOutputDir)
        .filter((f: string) => f.match(/^newsletter_\d{8}\.html$/))
        .sort()
        .reverse();
      return c.json(files.map((f: string) => ({
        filename: f,
        date: f.match(/(\d{8})/)?.[1] || '',
      })));
    } catch { return c.json([]); }
  });

  app.get('/api/newsletter/html/:filename', (c) => {
    const filename = c.req.param('filename');
    if (!/^newsletter_\d{8}\.html$/.test(filename)) return c.json({ error: 'invalid' }, 400);
    try {
      const html = fs.readFileSync(path.join(newsletterOutputDir, filename), 'utf-8');
      return c.html(html);
    } catch { return c.text('Not found', 404); }
  });

  let newsletterGenerating = false;
  app.post('/api/newsletter/generate', async (c) => {
    if (newsletterGenerating) return c.json({ error: 'Already generating' }, 409);
    newsletterGenerating = true;
    try {
      const { execSync } = await import('child_process');
      // Load .env from Newsletter project for API keys
      const nlEnv: Record<string, string> = { ...process.env } as any;
      try {
        const envContent = fs.readFileSync(path.join(newsletterProjectDir, '.env'), 'utf-8');
        for (const line of envContent.split('\n')) {
          const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
          if (m) nlEnv[m[1]] = m[2].trim();
        }
      } catch { /* no .env */ }
      execSync('python -m newsletter', { cwd: newsletterProjectDir, timeout: 300000, env: nlEnv });
      newsletterGenerating = false;
      return c.json({ ok: true });
    } catch (e: any) {
      newsletterGenerating = false;
      return c.json({ error: e.stderr?.toString() || e.message }, 500);
    }
  });

  // ── Newsletter Sources (proxy to newsletter-8060) ──
  const NEWSLETTER_API = 'http://127.0.0.1:8060';

  app.get('/api/newsletter/sources', async (c) => {
    try {
      const res = await fetch(`${NEWSLETTER_API}/sources`);
      return c.json(await res.json());
    } catch { return c.json([], 502); }
  });

  app.post('/api/newsletter/sources', async (c) => {
    try {
      const body = await c.req.json();
      const res = await fetch(`${NEWSLETTER_API}/sources`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return c.json(await res.json(), res.status);
    } catch (e: any) { return c.json({ error: e.message }, 502); }
  });

  app.put('/api/newsletter/sources/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json();
      const res = await fetch(`${NEWSLETTER_API}/sources/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return c.json(await res.json(), res.status);
    } catch (e: any) { return c.json({ error: e.message }, 502); }
  });

  app.delete('/api/newsletter/sources/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const res = await fetch(`${NEWSLETTER_API}/sources/${id}`, { method: 'DELETE' });
      return c.json(await res.json(), res.status);
    } catch (e: any) { return c.json({ error: e.message }, 502); }
  });

  serve({ fetch: app.fetch, port: DASHBOARD_PORT }, () => {
    logger.info({ port: DASHBOARD_PORT }, 'Dashboard server running');
  });
}
