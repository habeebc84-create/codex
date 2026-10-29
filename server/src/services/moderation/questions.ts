import { normalizeText } from './analysis.js';

/**
 * Question detection and grouping.
 * A message counts as a question when it asks something — a "?" or a
 * question word aimed at the streamer. Short greetings and rhetorical
 * remarks are not questions. Similar questions are grouped by token
 * overlap so the streamer sees one entry per topic, not twenty repeats.
 */

const QUESTION_STARTERS =
  /^(who|what|when|where|why|how|which|whose|can|could|would|should|is|are|was|were|do|does|did|will|have|has|any|anyone|anybody)\b/i;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'to',
  'of', 'in', 'on', 'for', 'with', 'you', 'your', 'this', 'that', 'it',
  'and', 'or', 'but', 'so', 'we', 'i', 'me', 'my', 'please', 'just',
  'can', 'could', 'would', 'should', 'will', 'how', 'what', 'when',
  'where', 'why', 'who', 'which',
  // Generic chat filler: dropping these keeps question groups topical
  // ("what game are you playing right now?" groups with "what game is this?").
  'right', 'now', 'really', 'actually', 'playing', 'play', 'going',
  'today', 'tonight', 'stream', 'streaming', 'gonna', 'yeah', 'hey', 'hi',
]);

export interface QuestionDetection {
  isQuestion: boolean;
  relevance: number;
  groupKey: string;
}

export function detectQuestion(text: string): QuestionDetection {
  const trimmed = text.trim();
  const hasQuestionMark = trimmed.includes('?');
  const startsWithQuestionWord = QUESTION_STARTERS.test(trimmed);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  const isQuestion =
    wordCount >= 3 && (hasQuestionMark || (startsWithQuestionWord && wordCount >= 4));

  if (!isQuestion) {
    return { isQuestion: false, relevance: 0, groupKey: '' };
  }

  // Relevance: question marks, question words, and length all help.
  // Genuine questions about the stream/game score higher than fragments.
  let relevance = 0.5;
  if (hasQuestionMark) relevance += 0.2;
  if (startsWithQuestionWord) relevance += 0.15;
  if (wordCount >= 6) relevance += 0.1;
  if (/\b(stream|game|setup|schedule|discord|song|music|settings|build|rank|next)\b/i.test(text)) {
    relevance += 0.05;
  }
  relevance = Math.min(1, Math.round(relevance * 100) / 100);

  return { isQuestion: true, relevance, groupKey: questionGroupKey(text) };
}

export function questionGroupKey(text: string): string {
  const tokens = normalizeText(text)
    .split(' ')
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const unique = [...new Set(tokens)].sort();
  return unique.slice(0, 6).join(' ');
}

/** Jaccard similarity between two token sets. */
export function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Find the best-matching open group key, or null when nothing is close. */
export function findMatchingGroup(
  groupKey: string,
  existingKeys: string[],
  threshold = 0.45,
): string | null {
  let best: string | null = null;
  let bestScore = threshold;
  for (const key of existingKeys) {
    const score = tokenOverlap(groupKey, key);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}
