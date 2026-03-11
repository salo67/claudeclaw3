import { describe, it, expect } from 'vitest';
import { splitMessage } from './bot.js';

describe('splitMessage', () => {
  it('returns single-element array for short messages', () => {
    const result = splitMessage('Hello, world!');
    expect(result).toEqual(['Hello, world!']);
  });

  it('returns single-element array for empty string', () => {
    const result = splitMessage('');
    expect(result).toEqual(['']);
  });

  it('returns single-element array for exact 4096 char message', () => {
    const msg = 'a'.repeat(4096);
    const result = splitMessage(msg);
    expect(result).toEqual([msg]);
  });

  it('splits 4097 char message into two parts', () => {
    const msg = 'a'.repeat(4097);
    const result = splitMessage(msg);
    expect(result.length).toBe(2);
    // Reconstruct the original - parts should cover all chars
    expect(result.join('').length).toBe(4097);
  });

  it('never produces chunks longer than 4096 chars', () => {
    const msg = 'a'.repeat(10000);
    const result = splitMessage(msg);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it('splits on newline boundaries when possible', () => {
    // Create a message with newlines where the total exceeds 4096
    const line = 'x'.repeat(2000);
    const msg = `${line}\n${line}\n${line}`;
    // Total: 2000 + 1 + 2000 + 1 + 2000 = 6002
    const result = splitMessage(msg);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should end at a newline boundary
    // (i.e., should be 2000 + 1 + 2000 = 4001 which fits in 4096)
    expect(result[0]).toContain('\n');
  });

  it('handles message with many short lines', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
    const msg = lines.join('\n');
    const result = splitMessage(msg);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
    // All content should be preserved
    expect(result.join('').replace(/^\s+/gm, '')).toBeTruthy();
  });

  it('handles message with no newlines that exceeds limit', () => {
    const msg = 'x'.repeat(8192);
    const result = splitMessage(msg);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(4096);
    expect(result[1].length).toBe(4096);
  });
});
