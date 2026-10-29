import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../../db/store.js';
import { analyzeMessage, normalizeText } from '../moderation/analysis.js';
import { analyzeSentiment } from '../moderation/sentiment.js';
import { detectQuestion, findMatchingGroup } from '../moderation/questions.js';
import { classifyWithAI, mergeAiClassification } from '../ai/openai.js';
import type {
  ChatMessage,
  Incident,
  MessageAnalysis,
  QuestionGroup,
  Severity,
} from '../../../../shared/src/types.js';

/**
 * Incoming event → validation → normalization → analysis → storage →
 * broadcast. Every event, demo or live, flows through this one function.
 * Chat text is validated and stored as data only; it is never executed,
 * interpolated into prompts, or rendered as HTML.
 */

export const incomingEventSchema = z.object({
  username: z.string().trim().min(1).max(25),
  text: z.string().trim().min(1).max(500),
  channel: z.string().trim().min(1).max(50),
  source: z.enum(['demo', 'twitch']),
  messageId: z.string().min(1).max(100).optional(),
  userId: z.string().max(50).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export type IncomingEvent = z.infer<typeof incomingEventSchema>;

export type BroadcastFn = (event: string, payload: unknown) => void;

const ANALYSIS_WINDOW_MS = 60_000;
const SPAM_BURST_THRESHOLD = 4;

export interface PipelineContext {
  store: Store;
  broadcast: BroadcastFn;
  /** When false, AI classification is skipped even if a key is configured. */
  aiEnabled: boolean;
  onIncident?: (incident: Incident) => void;
}

export async function processIncomingEvent(
  raw: unknown,
  ctx: PipelineContext,
): Promise<{ message: ChatMessage; analysis: MessageAnalysis }> {
  const parsed = incomingEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid chat event: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  const event = parsed.data;
  const now = event.timestamp ?? new Date().toISOString();
  const windowStart = new Date(new Date(now).getTime() - ANALYSIS_WINDOW_MS).toISOString();

  const sentiment = analyzeSentiment(event.text);
  const question = detectQuestion(event.text);

  const message: ChatMessage = {
    id: event.messageId ?? randomUUID(),
    channel: event.channel,
    username: event.username,
    userId: event.userId ?? null,
    text: event.text,
    source: event.source,
    createdAt: now,
    sentiment: sentiment.label,
    sentimentScore: sentiment.score,
    isQuestion: question.isQuestion,
  };

  // Context windows for repetition / rate / coordination checks.
  const recentByUser = ctx.store
    .recentByUser(event.username, windowStart)
    .filter((m) => m.createdAt < now)
    .map((m) => ({ text: m.text, createdAt: m.createdAt }));
  const recentGlobal = ctx.store
    .messagesInWindow(windowStart, now)
    .filter((m) => m.username !== event.username)
    .map((m) => ({ username: m.username, text: m.text, createdAt: m.createdAt }));

  let analysis = analyzeMessage(
    { messageId: message.id, username: event.username, text: event.text, createdAt: now },
    { recentByUser, recentGlobal, nowIso: now },
  );

  if (ctx.aiEnabled) {
    const ai = await classifyWithAI({
      messageId: message.id,
      username: event.username,
      text: event.text,
      recentCount: recentByUser.length,
    });
    analysis = mergeAiClassification(analysis, ai);
  }

  ctx.store.insertMessage(message);
  ctx.store.insertAnalysis(analysis);

  // Question grouping.
  if (question.isQuestion) {
    const openGroups = ctx.store.listQuestionGroups('open');
    const matchKey = findMatchingGroup(
      question.groupKey,
      openGroups.map((g) => g.groupKey),
    );
    const existing = matchKey
      ? openGroups.find((g) => g.groupKey === matchKey)
      : undefined;
    if (existing) {
      const updated: QuestionGroup = {
        ...existing,
        count: existing.count + 1,
        relevance: Math.max(existing.relevance, question.relevance),
        lastSeenAt: now,
      };
      ctx.store.upsertQuestionGroup(updated);
    } else {
      ctx.store.upsertQuestionGroup({
        id: randomUUID(),
        groupKey: question.groupKey,
        representativeText: event.text,
        username: event.username,
        messageId: message.id,
        count: 1,
        relevance: question.relevance,
        status: 'open',
        createdAt: now,
        lastSeenAt: now,
      });
    }
  }

  // Incident detection: spam burst in the window. The window query is
  // inclusive on its upper bound, so the just-stored message is counted.
  const windowMessages = ctx.store.messagesInWindow(windowStart, now);
  const flaggedInWindow = windowMessages.filter((m) => {
    const a = ctx.store.getAnalysis(m.id);
    return a && a.riskCategory !== 'clean';
  });
  const flaggedCount = flaggedInWindow.length;
  const recentIncidents = ctx.store.listIncidents(1, 'spam_burst');
  const lastBurst = recentIncidents[0];
  const burstCooldownPassed =
    !lastBurst || new Date(now).getTime() - new Date(lastBurst.createdAt).getTime() > ANALYSIS_WINDOW_MS;
  if (flaggedCount >= SPAM_BURST_THRESHOLD && burstCooldownPassed) {
    const incident: Incident = {
      id: randomUUID(),
      type: 'spam_burst',
      title: `Spam burst: ${flaggedCount} flagged messages in the last minute`,
      detail: `Flagged senders in the window: ${[...new Set([...flaggedInWindow.map((m) => m.username), event.username])].join(', ')}. Latest: "${event.text.slice(0, 120)}"`,
      severity: 'high',
      status: 'open',
      messageId: message.id,
      username: event.username,
      createdAt: now,
    };
    ctx.store.insertIncident(incident);
    ctx.onIncident?.(incident);
    ctx.broadcast('incident:new', { incident });
  }

  // Flagged-message incident for high/critical verdicts.
  if (analysis.severity === 'high' || analysis.severity === 'critical') {
    const incident: Incident = {
      id: randomUUID(),
      type: 'flagged_message',
      title: `${analysis.riskCategory.replace('_', ' ')} flagged (${analysis.severity})`,
      detail: analysis.explanation,
      severity: analysis.severity as Severity,
      status: 'open',
      messageId: message.id,
      username: event.username,
      createdAt: now,
    };
    ctx.store.insertIncident(incident);
    ctx.onIncident?.(incident);
    ctx.broadcast('incident:new', { incident });
  }

  ctx.broadcast('chat:message', { message, analysis });
  if (analysis.needsHumanReview) {
    ctx.broadcast('moderation:alert', { message, analysis });
  }
  ctx.broadcast('insights:update', {
    flaggedCount: ctx.store.countFlagged(windowStart),
    openAlerts: ctx.store.countOpenAlerts(),
  });

  return { message, analysis };
}

export { normalizeText };
