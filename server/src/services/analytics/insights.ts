import type { Store } from '../../db/store.js';
import type {
  ActivityBucket,
  SentimentBucket,
} from '../../../../shared/src/types.js';

/** Bucket size in minutes for activity/sentiment charts. */
export const BUCKET_MINUTES = 5;

export function bucketStart(iso: string, bucketMinutes = BUCKET_MINUTES): string {
  const d = new Date(iso);
  const minutes = Math.floor(d.getUTCMinutes() / bucketMinutes) * bucketMinutes;
  d.setUTCMinutes(minutes, 0, 0);
  return d.toISOString();
}

export function buildActivityBuckets(
  store: Store,
  sinceIso: string,
  untilIso: string,
  bucketMinutes = BUCKET_MINUTES,
): ActivityBucket[] {
  const messages = store.messagesInWindow(sinceIso, untilIso);
  const buckets = new Map<string, { count: number; users: Set<string>; flagged: number }>();
  for (const m of messages) {
    const key = bucketStart(m.createdAt, bucketMinutes);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, users: new Set(), flagged: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.users.add(m.username);
    const analysis = store.getAnalysis(m.id);
    if (analysis && analysis.riskCategory !== 'clean') bucket.flagged += 1;
  }
  // Fill empty buckets so charts render a continuous window.
  const filled: ActivityBucket[] = [];
  const cursor = new Date(bucketStart(sinceIso, bucketMinutes));
  const end = new Date(untilIso);
  while (cursor <= end) {
    const key = cursor.toISOString();
    const bucket = buckets.get(key);
    filled.push({
      bucketStart: key,
      messageCount: bucket?.count ?? 0,
      uniqueParticipants: bucket?.users.size ?? 0,
      flaggedCount: bucket?.flagged ?? 0,
    });
    cursor.setUTCMinutes(cursor.getUTCMinutes() + bucketMinutes);
  }
  return filled;
}

export function buildSentimentBuckets(
  store: Store,
  sinceIso: string,
  untilIso: string,
  bucketMinutes = BUCKET_MINUTES,
): SentimentBucket[] {
  const messages = store.messagesInWindow(sinceIso, untilIso);
  const buckets = new Map<string, { positive: number; neutral: number; negative: number; uncertain: number }>();
  for (const m of messages) {
    const key = bucketStart(m.createdAt, bucketMinutes);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { positive: 0, neutral: 0, negative: 0, uncertain: 0 };
      buckets.set(key, bucket);
    }
    bucket[m.sentiment] += 1;
  }
  const filled: SentimentBucket[] = [];
  const cursor = new Date(bucketStart(sinceIso, bucketMinutes));
  const end = new Date(untilIso);
  while (cursor <= end) {
    const key = cursor.toISOString();
    const bucket = buckets.get(key) ?? { positive: 0, neutral: 0, negative: 0, uncertain: 0 };
    filled.push({
      bucketStart: key,
      ...bucket,
      total: bucket.positive + bucket.neutral + bucket.negative + bucket.uncertain,
    });
    cursor.setUTCMinutes(cursor.getUTCMinutes() + bucketMinutes);
  }
  return filled;
}

export interface CopilotSummary {
  headline: string;
  bullets: string[];
  unansweredQuestions: number;
  openAlerts: number;
  flaggedInWindow: number;
  windowMinutes: number;
  generatedAt: string;
  engineNote: string;
}

/**
 * Deterministic copilot summary built from stored data only. No model call.
 * Figures are labelled with their window and sample counts; sentiment is
 * described as an estimate, never as a fact about every viewer.
 */
export function buildCopilotSummary(
  store: Store,
  windowMinutes: number,
  aiAvailable: boolean,
): CopilotSummary {
  const now = new Date();
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const until = now.toISOString();
  const messages = store.messagesInWindow(since, until);
  const total = messages.length;
  const positive = messages.filter((m) => m.sentiment === 'positive').length;
  const negative = messages.filter((m) => m.sentiment === 'negative').length;
  const questions = store.listQuestionGroups('open');
  const openAlerts = store.countOpenAlerts();
  const flagged = store.countFlagged(since);

  const sentimentWord =
    total === 0
      ? 'no chat activity'
      : positive > negative * 1.5
        ? 'mostly positive'
        : negative > positive * 1.5
          ? 'mostly negative'
          : 'mixed';
  const bullets: string[] = [];
  bullets.push(
    `${total} messages in the last ${windowMinutes} minutes from ${new Set(messages.map((m) => m.username)).size} participants. Estimated sentiment: ${sentimentWord} (${positive} positive, ${negative} negative of ${total} analysed).`,
  );
  if (flagged > 0) {
    bullets.push(
      `${flagged} message${flagged === 1 ? '' : 's'} flagged by the moderation engine in this window. ${openAlerts} alert${openAlerts === 1 ? '' : 's'} still awaiting a moderator decision.`,
    );
  } else {
    bullets.push('No messages were flagged in this window.');
  }
  if (questions.length > 0) {
    const top = questions.slice(0, 3).map((q) => `"${q.representativeText}" (x${q.count})`);
    bullets.push(`${questions.length} unanswered question group${questions.length === 1 ? '' : 's'}. Most repeated: ${top.join('; ')}.`);
  } else {
    bullets.push('No unanswered questions are open right now.');
  }
  const topChatter = messages.length
    ? [...messages.reduce((acc, m) => acc.set(m.username, (acc.get(m.username) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]
    : null;
  if (topChatter) {
    bullets.push(`Most active participant: ${topChatter[0]} (${topChatter[1]} messages).`);
  }

  return {
    headline:
      total === 0
        ? 'Chat is quiet right now.'
        : `Chat is ${sentimentWord} with ${openAlerts} open alert${openAlerts === 1 ? '' : 's'}.`,
    bullets,
    unansweredQuestions: questions.length,
    openAlerts,
    flaggedInWindow: flagged,
    windowMinutes,
    generatedAt: until,
    engineNote: aiAvailable
      ? 'Summary generated deterministically from stored events. AI-assisted summaries are available when OPENAI_API_KEY is set, with the same data.'
      : 'Summary generated deterministically from stored events. No AI call was made (OPENAI_API_KEY not set).',
  };
}
