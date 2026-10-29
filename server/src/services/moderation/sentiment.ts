import type { SentimentLabel } from '../../../../shared/src/types.js';

/**
 * Lexicon-based sentiment estimate.
 * This is a heuristic over chat text, NOT an objective fact about viewers.
 * Low-signal messages are labelled "uncertain" rather than forced into a
 * polarity. Counts and windows are always shown next to sentiment figures.
 */

const POSITIVE = new Set([
  'love', 'loved', 'amazing', 'awesome', 'great', 'fantastic', 'incredible',
  'beautiful', 'brilliant', 'cool', 'fun', 'funny', 'hilarious', 'happy',
  'excited', 'hype', 'lets go', "let's go", 'w', 'gg', 'pog', 'poggers',
  'best', 'perfect', 'nice', 'sweet', 'dope', 'fire', 'lit', 'wow',
  'thank', 'thanks', 'appreciate', 'enjoyed', 'enjoy', 'good', 'glad',
  'win', 'winning', 'clutch', 'clean', 'smooth', 'banger', 'legend',
  'wholesome', 'support', 'proud', 'yay', 'yes', 'yess', 'goat',
]);

const NEGATIVE = new Set([
  'hate', 'hated', 'awful', 'terrible', 'bad', 'worst', 'boring', 'sucks',
  'suck', 'trash', 'garbage', 'annoying', 'angry', 'mad', 'sad', 'upset',
  'disappointed', 'disappointing', 'cringe', 'lame', 'rigged', 'unfair',
  'broken', 'buggy', 'lag', 'laggy', 'crash', 'dead', 'boring', 'mid',
  'overrated', 'toxic', 'rude', 'mean', 'dumb', 'stupid', 'idiot',
  'shame', 'embarrassing', 'fail', 'failed', 'lose', 'losing', 'loss',
  'scam', 'fake', 'clickbait', 'booo', 'boo',
]);

const NEGATORS = new Set(['not', 'no', 'never', "don't", 'dont', 'isnt', "isn't", 'cant', "can't", 'wont', "won't", 'aint']);

export interface SentimentResult {
  label: SentimentLabel;
  score: number;
  positiveHits: number;
  negativeHits: number;
}

export function analyzeSentiment(text: string): SentimentResult {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let positiveHits = 0;
  let negativeHits = 0;
  let negated = false;
  for (const token of tokens) {
    if (NEGATORS.has(token)) {
      negated = true;
      continue;
    }
    if (POSITIVE.has(token)) {
      if (negated) negativeHits += 1;
      else positiveHits += 1;
      negated = false;
    } else if (NEGATIVE.has(token)) {
      if (negated) positiveHits += 1;
      else negativeHits += 1;
      negated = false;
    }
  }
  const score = positiveHits - negativeHits;
  const total = positiveHits + negativeHits;
  if (total === 0) {
    return { label: 'uncertain', score: 0, positiveHits, negativeHits };
  }
  if (score > 0) return { label: 'positive', score, positiveHits, negativeHits };
  if (score < 0) return { label: 'negative', score, positiveHits, negativeHits };
  // Equal opposing signals — genuinely ambiguous.
  return { label: 'neutral', score: 0, positiveHits, negativeHits };
}
