/**
 * Advisor SSE client — sends messages to the Gemini Flash CEO Advisor
 * via the FastAPI endpoint and accumulates the streamed response.
 */

import { API_PORT } from './config.js';
import { logger } from './logger.js';

const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

export interface AdvisorThread {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_message: string;
}

/**
 * Create a new advisor thread via the API.
 */
export async function createAdvisorThread(title?: string): Promise<AdvisorThread> {
  const res = await fetch(`${API_BASE}/advisor/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || '' }),
  });
  if (!res.ok) throw new Error(`Create thread failed: ${res.status}`);
  return res.json() as Promise<AdvisorThread>;
}

/**
 * Get the most recent advisor thread, or create one if none exists.
 * This lets Telegram resume the same thread that the web dashboard uses.
 */
export async function getOrCreateAdvisorThread(): Promise<AdvisorThread> {
  const res = await fetch(`${API_BASE}/advisor/threads`);
  if (res.ok) {
    const threads = (await res.json()) as AdvisorThread[];
    if (threads.length > 0) {
      // Threads come sorted by updated_at DESC, so first is most recent
      return threads[0];
    }
  }
  return createAdvisorThread();
}

/**
 * Send a message to the advisor and read the SSE stream until done.
 * Returns the full accumulated response text.
 */
export async function sendAdvisorMessage(threadId: string, content: string, source: string = 'telegram'): Promise<string> {
  const res = await fetch(`${API_BASE}/advisor/threads/${threadId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, source }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Advisor send failed (${res.status}): ${errText}`);
  }

  if (!res.body) throw new Error('No response body from advisor');

  // Read SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.text) {
            fullResponse += data.text;
          }
          if (data.error) {
            logger.error({ error: data.error }, 'Advisor SSE error');
            throw new Error(`Advisor error: ${data.error}`);
          }
          if (data.content) {
            // "done" event — use the full content from server
            fullResponse = data.content;
          }
        } catch (parseErr) {
          // Ignore unparseable lines
          if (parseErr instanceof SyntaxError) continue;
          throw parseErr;
        }
      }
    }
  }

  return fullResponse;
}
