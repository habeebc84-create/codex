import { describe, expect, it } from 'vitest';
import { chatMessageSchema, socketChatSchema, statusSchema } from '../src/lib/schemas';

/**
 * Client payload validation: the UI only renders server data that passes
 * Zod. Malformed or hostile payloads are dropped, never rendered.
 */

const validMessage = {
  id: 'm1',
  channel: 'demo',
  username: 'viewer_one',
  userId: null,
  text: 'hello <script>alert(1)</script>',
  source: 'demo',
  createdAt: new Date().toISOString(),
  sentiment: 'neutral',
  sentimentScore: 0,
  isQuestion: false,
};

const validAnalysis = {
  messageId: 'm1',
  riskCategory: 'clean',
  severity: 'low',
  confidence: 0.1,
  explanation: 'No signals.',
  reasons: [],
  recommendedAction: 'none',
  needsHumanReview: false,
  engine: 'deterministic',
  createdAt: new Date().toISOString(),
};

describe('chat payload schemas', () => {
  it('accepts a valid chat:message payload, including markup-like text (rendered as text)', () => {
    const parsed = socketChatSchema.safeParse({ message: validMessage, analysis: validAnalysis });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message.text).toContain('<script>');
    }
  });

  it('rejects a message missing required fields', () => {
    expect(chatMessageSchema.safeParse({ ...validMessage, text: undefined }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ ...validMessage, source: 'hacker' }).success).toBe(false);
  });

  it('rejects an unknown sentiment value', () => {
    expect(chatMessageSchema.safeParse({ ...validMessage, sentiment: 'angry' }).success).toBe(false);
  });

  it('rejects an analysis with an out-of-range severity', () => {
    expect(
      socketChatSchema.safeParse({
        message: validMessage,
        analysis: { ...validAnalysis, severity: 'extreme' },
      }).success,
    ).toBe(false);
  });

  it('rejects a payload with the wrong shape entirely', () => {
    expect(socketChatSchema.safeParse({ nope: true }).success).toBe(false);
    expect(socketChatSchema.safeParse(null).success).toBe(false);
  });
});

describe('status payload schema', () => {
  const validStatus = {
    mode: 'demo',
    twitch: {
      state: 'disconnected',
      login: null,
      channel: null,
      lastError: null,
      scopes: ['user:read:chat'],
    },
    ai: { available: false, engine: 'deterministic', note: 'No key configured' },
    simulator: { running: false, speed: 1, emitted: 0 },
    serverTime: new Date().toISOString(),
  };

  it('accepts a valid status payload', () => {
    expect(statusSchema.safeParse(validStatus).success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(statusSchema.safeParse({ ...validStatus, mode: 'prod' }).success).toBe(false);
  });
});
