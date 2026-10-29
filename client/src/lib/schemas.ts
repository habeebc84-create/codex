import { z } from 'zod';

/**
 * Client-side validation of everything the server sends over Socket.IO
 * and REST. Payloads that fail validation are dropped and logged, never
 * rendered. Chat text is rendered as plain text only (React escapes it).
 */

export const chatMessageSchema = z.object({
  id: z.string(),
  channel: z.string(),
  username: z.string(),
  userId: z.string().nullable(),
  text: z.string(),
  source: z.enum(['demo', 'twitch']),
  createdAt: z.string(),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'uncertain']),
  sentimentScore: z.number(),
  isQuestion: z.boolean(),
});

export const analysisSchema = z.object({
  messageId: z.string(),
  riskCategory: z.enum(['clean', 'spam', 'harassment', 'suspicious_link', 'coordinated', 'uncertain']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number(),
  explanation: z.string(),
  reasons: z.array(z.string()),
  recommendedAction: z.enum(['none', 'monitor', 'review', 'timeout_suggested', 'ban_suggested']),
  needsHumanReview: z.boolean(),
  engine: z.enum(['deterministic', 'openai']),
  createdAt: z.string(),
});

export const socketChatSchema = z.object({
  message: chatMessageSchema,
  analysis: analysisSchema,
});

/** moderation:alert carries the same { message, analysis } pair. */
export const socketAlertSchema = socketChatSchema;

export const alertItemSchema = z.object({
  message: chatMessageSchema,
  analysis: analysisSchema,
  decision: z
    .object({
      id: z.string(),
      messageId: z.string(),
      action: z.enum(['dismiss', 'false_positive', 'approve']),
      moderator: z.string(),
      note: z.string().nullable(),
      submittedToTwitch: z.boolean(),
      submitDetail: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  source: z.string(),
});

export const statusSchema = z.object({
  mode: z.enum(['demo', 'live']),
  twitch: z.object({
    state: z.enum(['disconnected', 'connecting', 'connected', 'error']),
    login: z.string().nullable(),
    channel: z.string().nullable(),
    lastError: z.string().nullable(),
    scopes: z.array(z.string()),
  }),
  ai: z.object({
    available: z.boolean(),
    engine: z.enum(['deterministic', 'openai']),
    note: z.string(),
  }),
  simulator: z.object({
    running: z.boolean(),
    speed: z.number(),
    emitted: z.number(),
  }),
  serverTime: z.string(),
});

export type StatusPayload = z.infer<typeof statusSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type MessageAnalysis = z.infer<typeof analysisSchema>;
