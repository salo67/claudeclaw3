import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(),
}));

import { voiceCapabilities, UPLOADS_DIR } from './voice.js';
import { readEnvFile } from './env.js';

const mockReadEnvFile = vi.mocked(readEnvFile);

describe('voiceCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { stt: false, tts: false } when no env vars set', () => {
    mockReadEnvFile.mockReturnValue({});
    const result = voiceCapabilities();
    expect(result).toEqual({ stt: false, tts: false });
  });

  it('returns { stt: true, tts: false } when only GROQ_API_KEY is set', () => {
    mockReadEnvFile.mockReturnValue({ GROQ_API_KEY: 'gsk_test123' });
    const result = voiceCapabilities();
    expect(result).toEqual({ stt: true, tts: false });
  });

  it('returns { stt: false, tts: false } when only ELEVENLABS_API_KEY is set (missing voice ID)', () => {
    mockReadEnvFile.mockReturnValue({ ELEVENLABS_API_KEY: 'el_test123' });
    const result = voiceCapabilities();
    expect(result).toEqual({ stt: false, tts: false });
  });

  it('returns { stt: false, tts: true } when both ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID set', () => {
    mockReadEnvFile.mockReturnValue({
      ELEVENLABS_API_KEY: 'el_test123',
      ELEVENLABS_VOICE_ID: 'voice_abc',
    });
    const result = voiceCapabilities();
    expect(result).toEqual({ stt: false, tts: true });
  });

  it('returns { stt: true, tts: true } when all three set', () => {
    mockReadEnvFile.mockReturnValue({
      GROQ_API_KEY: 'gsk_test123',
      ELEVENLABS_API_KEY: 'el_test123',
      ELEVENLABS_VOICE_ID: 'voice_abc',
    });
    const result = voiceCapabilities();
    expect(result).toEqual({ stt: true, tts: true });
  });
});

describe('UPLOADS_DIR', () => {
  it('is an absolute path', () => {
    expect(path.isAbsolute(UPLOADS_DIR)).toBe(true);
  });

  it('ends with workspace/uploads', () => {
    expect(UPLOADS_DIR).toMatch(/workspace[/\\]uploads$/);
  });
});
