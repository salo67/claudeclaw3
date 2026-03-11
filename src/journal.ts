/**
 * Journal API client — CRUD for daily journal entries via FastAPI.
 * Formatting helpers for Telegram display.
 */

import { API_PORT } from './config.js';

const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

// ── Types ────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  date: string;
  content: string;
  mood: string;
  tags: string;
  bot_prompts: string;
  created_at: number;
  updated_at: number;
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

/** Get today's date as YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** Get or create today's journal entry */
export async function getTodayEntry(): Promise<JournalEntry | null> {
  try {
    return await api<JournalEntry>(`/journal/${todayStr()}`);
  } catch {
    return null;
  }
}

/** Upsert (create or append) a journal entry for today */
export async function addJournalEntry(
  text: string,
  mood?: string,
): Promise<JournalEntry> {
  const date = todayStr();
  const existing = await getTodayEntry();

  let content: string;
  if (existing && existing.content) {
    // Append with timestamp
    const time = new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    content = `${existing.content}\n\n[${time}] ${text}`;
  } else {
    const time = new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    content = `[${time}] ${text}`;
  }

  const body: Record<string, string> = { content };
  if (mood) body.mood = mood;

  return api<JournalEntry>(`/journal/${date}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Get recent entries for display */
export async function getRecentEntries(limit = 5): Promise<JournalEntry[]> {
  return api<JournalEntry[]>(`/journal?limit=${limit}`);
}

// ── Telegram formatting ──────────────────────────────────────

const MOOD_EMOJI: Record<string, string> = {
  great: '🔥',
  good: '😊',
  neutral: '😐',
  stressed: '😤',
  bad: '😞',
};

export function formatEntry(entry: JournalEntry): string {
  const moodEmoji = MOOD_EMOJI[entry.mood] || '';
  const mood = entry.mood ? ` ${moodEmoji} ${entry.mood}` : '';
  const tags = entry.tags ? `\nTags: ${entry.tags}` : '';
  return `📓 ${entry.date}${mood}${tags}\n\n${entry.content}`;
}

export function formatEntryList(entries: JournalEntry[]): string {
  if (entries.length === 0) return 'No hay entradas en el journal.';
  return entries
    .map((e) => {
      const moodEmoji = MOOD_EMOJI[e.mood] || '';
      const preview = e.content.slice(0, 80).replace(/\n/g, ' ');
      return `${e.date} ${moodEmoji} ${preview}...`;
    })
    .join('\n');
}
