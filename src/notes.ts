/**
 * Notes API client — CRUD for knowledge-base notes via FastAPI.
 * Formatting helpers for Telegram display.
 */

import { API_PORT } from './config.js';

const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

// ── Types ────────────────────────────────────────────────────

export interface NoteResponse {
  id: string;
  title: string;
  content: string;
  tags: string;
  project_id: string | null;
  pinned: boolean;
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

/** Create a new note */
export async function createNote(
  title: string,
  content: string,
  tags?: string,
): Promise<NoteResponse> {
  const body: Record<string, string> = { title, content };
  if (tags) body.tags = tags;
  return api<NoteResponse>('/notes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Get recent notes (ordered by updated_at desc) */
export async function getRecentNotes(limit = 5): Promise<NoteResponse[]> {
  const notes = await api<NoteResponse[]>('/notes');
  return notes.slice(0, limit);
}

// ── Telegram formatting ──────────────────────────────────────

export function formatNote(note: NoteResponse): string {
  const pin = note.pinned ? '📌 ' : '';
  const tags = note.tags ? `\nTags: ${note.tags}` : '';
  const preview = note.content.length > 200
    ? note.content.slice(0, 200) + '…'
    : note.content;
  return `📝 ${pin}${note.title}${tags}\n\n${preview}`;
}

export function formatNoteList(notes: NoteResponse[]): string {
  if (notes.length === 0) return 'No hay notas guardadas.';
  return notes
    .map((n) => {
      const pin = n.pinned ? '📌 ' : '';
      const preview = n.content.slice(0, 80).replace(/\n/g, ' ');
      return `${pin}📝 ${n.title} — ${preview}...`;
    })
    .join('\n');
}
