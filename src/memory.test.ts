import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  searchMemories: vi.fn(),
  getRecentMemories: vi.fn(),
  touchMemory: vi.fn(),
  saveMemory: vi.fn(),
  decayMemories: vi.fn(),
  logConversationTurn: vi.fn(),
  pruneConversationLog: vi.fn(),
}));

import {
  buildMemoryContext,
  saveConversationTurn,
  runDecaySweep,
} from './memory.js';

import {
  searchMemories,
  getRecentMemories,
  touchMemory,
  saveMemory,
  decayMemories,
} from './db.js';

const mockSearchMemories = vi.mocked(searchMemories);
const mockGetRecentMemories = vi.mocked(getRecentMemories);
const mockTouchMemory = vi.mocked(touchMemory);
const mockSaveMemory = vi.mocked(saveMemory);
const mockDecayMemories = vi.mocked(decayMemories);

describe('buildMemoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty string when no memories found', async () => {
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentMemories.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'hello');
    expect(result).toBe('');
  });

  it('returns formatted string when FTS results exist', async () => {
    mockSearchMemories.mockReturnValue([
      {
        id: 1,
        chat_id: 'chat1',
        topic_key: null,
        content: 'I like pizza',
        sector: 'semantic',
        salience: 1.0,
        created_at: 100,
        accessed_at: 100,
      },
    ]);
    mockGetRecentMemories.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'pizza');
    expect(result).toContain('[Memory context]');
    expect(result).toContain('I like pizza');
    expect(result).toContain('semantic');
    expect(result).toContain('[End memory context]');
  });

  it('returns formatted string when recent memories exist', async () => {
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentMemories.mockReturnValue([
      {
        id: 2,
        chat_id: 'chat1',
        topic_key: null,
        content: 'Recent thought',
        sector: 'episodic',
        salience: 1.0,
        created_at: 100,
        accessed_at: 200,
      },
    ]);

    const result = await buildMemoryContext('chat1', 'anything');
    expect(result).toContain('Recent thought');
    expect(result).toContain('episodic');
  });

  it('deduplicates between FTS and recent results', async () => {
    const sharedMemory = {
      id: 1,
      chat_id: 'chat1',
      topic_key: null,
      content: 'shared memory',
      sector: 'semantic',
      salience: 1.0,
      created_at: 100,
      accessed_at: 100,
    };

    mockSearchMemories.mockReturnValue([sharedMemory]);
    mockGetRecentMemories.mockReturnValue([sharedMemory]);

    const result = await buildMemoryContext('chat1', 'shared');
    // Should only appear once
    const occurrences = result.split('shared memory').length - 1;
    expect(occurrences).toBe(1);
  });

  it('touches (boosts salience of) returned memories', async () => {
    mockSearchMemories.mockReturnValue([
      {
        id: 10,
        chat_id: 'chat1',
        topic_key: null,
        content: 'mem1',
        sector: 'semantic',
        salience: 1.0,
        created_at: 100,
        accessed_at: 100,
      },
    ]);
    mockGetRecentMemories.mockReturnValue([
      {
        id: 20,
        chat_id: 'chat1',
        topic_key: null,
        content: 'mem2',
        sector: 'episodic',
        salience: 1.0,
        created_at: 100,
        accessed_at: 200,
      },
    ]);

    await buildMemoryContext('chat1', 'test');
    expect(mockTouchMemory).toHaveBeenCalledWith(10);
    expect(mockTouchMemory).toHaveBeenCalledWith(20);
    expect(mockTouchMemory).toHaveBeenCalledTimes(2);
  });

  it('handles empty user message gracefully', async () => {
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentMemories.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', '');
    expect(result).toBe('');
  });

  it('handles short user message gracefully', async () => {
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentMemories.mockReturnValue([]);

    const result = await buildMemoryContext('chat1', 'hi');
    expect(result).toBe('');
  });
});

describe('saveConversationTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves semantic memory for messages containing "I prefer"', () => {
    saveConversationTurn('chat1', 'I prefer TypeScript over JavaScript always', 'Noted.');
    expect(mockSaveMemory).toHaveBeenCalledWith(
      'chat1',
      'I prefer TypeScript over JavaScript always',
      'semantic',
    );
  });

  it('saves semantic memory for messages containing "remember"', () => {
    saveConversationTurn('chat1', 'Please remember that I like dark mode', 'Sure thing.');
    expect(mockSaveMemory).toHaveBeenCalledWith(
      'chat1',
      'Please remember that I like dark mode',
      'semantic',
    );
  });

  it('saves semantic memory for messages containing "always"', () => {
    saveConversationTurn('chat1', 'I always use vim for editing', 'Got it.');
    expect(mockSaveMemory).toHaveBeenCalledWith(
      'chat1',
      'I always use vim for editing',
      'semantic',
    );
  });

  it('saves episodic memory for regular messages', () => {
    saveConversationTurn('chat1', 'Can you help me refactor this code please?', 'Sure.');
    expect(mockSaveMemory).toHaveBeenCalledWith(
      'chat1',
      'Can you help me refactor this code please?',
      'episodic',
    );
  });

  it('does NOT save very short messages (<=20 chars)', () => {
    saveConversationTurn('chat1', 'short msg', 'ok');
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('does NOT save messages exactly 20 chars', () => {
    saveConversationTurn('chat1', '12345678901234567890', 'ok');
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('saves messages that are 21 chars', () => {
    saveConversationTurn('chat1', '123456789012345678901', 'ok');
    expect(mockSaveMemory).toHaveBeenCalled();
  });

  it('does NOT save messages starting with /', () => {
    saveConversationTurn('chat1', '/command with a long argument that is over 20 chars', 'done');
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });
});

describe('runDecaySweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls decayMemories once', () => {
    runDecaySweep();
    expect(mockDecayMemories).toHaveBeenCalledOnce();
  });
});
